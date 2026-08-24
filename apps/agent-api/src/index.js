/**
 * Agent API — stable HTTP surface.
 * Import / part / company go through DeepSeekHarnessRuntime.
 * Deterministic fast path stays in core. Agent path uses official Harness.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  parseAgentRequest,
  parseBusinessContext,
  parseCompanyResearchRequest,
  parseImportRequest,
  parsePartResearchRequest,
  parseTaskCreateRequest,
} from "@electronics/contracts";
import { createRuntime } from "./runtime.js";
import { createResearchHandlers, listTaskRoutes, requestCtx } from "./research.js";
import { createTaskStore } from "./task-store.js";
import { ApiRequestError, createApiGuard, withRequestDeadline } from "./http-guard.js";
import { sourceReadiness } from "@electronics/market-sources";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
mkdirSync(join(root, ".dsh-platform/sessions"), { recursive: true });
mkdirSync(join(root, ".dsh-platform/workspace"), { recursive: true });

const HOST = process.env.AGENT_API_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_API_PORT || 8787);
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();
const TASK_STALE_MS = Number.isSafeInteger(Number(process.env.TASK_STALE_MS))
  && Number(process.env.TASK_STALE_MS) >= 15_000
  ? Number(process.env.TASK_STALE_MS)
  : 30_000;
const SSE_MAX_CONNECTIONS = Number.isSafeInteger(Number(process.env.SSE_MAX_CONNECTIONS))
  && Number(process.env.SSE_MAX_CONNECTIONS) > 0
  ? Number(process.env.SSE_MAX_CONNECTIONS)
  : 100;
let activeSseConnections = 0;
const apiGuard = createApiGuard({ token: TOKEN });
const runtime = createRuntime();
const taskStore = createTaskStore({
  path: process.env.TASK_STORE_PATH || join(root, ".dsh-platform/tasks.sqlite"),
  ttlMs: Number(process.env.TASK_TTL_MS || 7 * 24 * 60 * 60 * 1000),
});
const interruptedTasks = taskStore.recoverInterrupted({ olderThanMs: TASK_STALE_MS });
if (interruptedTasks) {
  process.stderr.write(`[agent-api] marked ${interruptedTasks} interrupted task(s) as failed after restart\n`);
}
const research = createResearchHandlers(runtime, { store: taskStore });
const recoveryTimer = setInterval(() => {
  taskStore.recoverInterrupted({ olderThanMs: TASK_STALE_MS });
}, Math.max(5_000, Math.floor(TASK_STALE_MS / 2)));
recoveryTimer.unref();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req) {
  return apiGuard.authorized(req);
}

function routeError(res, err, fallbackCode, fallbackStatus = 500) {
  if (err instanceof ApiRequestError) {
    return json(res, err.status, { ok: false, error: err.code });
  }
  if (err instanceof SyntaxError) return json(res, 400, { ok: false, error: "invalid_json" });
  return json(res, fallbackStatus, { ok: false, error: fallbackCode });
}

function contractError(res, errors) {
  json(res, 422, { ok: false, error: "contract_error", errors });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function taskRequestHash(task) {
  return createHash("sha256").update(JSON.stringify(stableValue(task))).digest("hex");
}

function writeTaskEvent(res, event) {
  res.write(`id: ${event.id}\n`);
  res.write("event: task\n");
  return res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeTaskEvents(req, res, taskId, after) {
  if (activeSseConnections >= SSE_MAX_CONNECTIONS) {
    res.setHeader("retry-after", "5");
    return json(res, 503, { ok: false, error: "sse_capacity_exceeded" });
  }
  activeSseConnections += 1;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": task event stream\n\n");

  let closed = false;
  let heartbeat;
  let poller;
  let paused = false;
  let lastSent = after;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poller);
    unsubscribe();
    activeSseConnections = Math.max(0, activeSseConnections - 1);
  };
  const finishIfTerminal = () => {
    const status = research.getTask(taskId)?.status;
    const backlogDrained = !paused && research.listEvents(taskId, lastSent, 1).length === 0;
    if (["done", "failed", "cancelled"].includes(status) && backlogDrained) {
      cleanup();
      res.end();
      return true;
    }
    return false;
  };

  // Subscription and backlog lookup are both synchronous. Registering first
  // closes the tiny race where a task could finish between replay and listen.
  const emit = (event) => {
    if (closed || paused || event.id <= lastSent) return;
    lastSent = event.id;
    paused = !writeTaskEvent(res, event);
    if (paused) {
      res.once("drain", () => {
        paused = false;
        poll();
      });
    }
  };
  const poll = () => {
    if (closed || paused) return;
    for (const event of research.listEvents(taskId, lastSent)) emit(event);
    finishIfTerminal();
  };
  unsubscribe = research.subscribeEvents(taskId, (event) => {
    emit(event);
    finishIfTerminal();
  });
  for (const event of research.listEvents(taskId, after)) {
    emit(event);
  }
  if (finishIfTerminal()) return;
  // SQLite polling supplies cross-process delivery when a deployment has more
  // than one reader. The local subscription keeps same-process latency low.
  poller = setInterval(poll, 1_000);
  poller.unref();
  heartbeat = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();
  req.once("close", cleanup);
  res.once("close", cleanup);
}

function parseResearchRequest(body, type) {
  const request = type === "company_research" ? parseCompanyResearchRequest(body) : parsePartResearchRequest(body);
  if (!request.ok) return request;
  const context = parseBusinessContext(body.context);
  if (!context.ok) return context;
  return {
    ok: true,
    value: {
      ...body,
      ...request.value,
      context: context.value,
    },
  };
}

function parseTaskRequest(body) {
  const task = parseTaskCreateRequest(body);
  if (!task.ok) return task;
  const research = parseResearchRequest(body.input || {}, task.value.type);
  if (!research.ok) return research;
  return {
    ok: true,
    value: {
      type: task.value.type,
      input: research.value,
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  apiGuard.track(req, res, url.pathname);
  if (req.method === "GET" && url.pathname === "/health") {
    const agentReady = runtime.isAgentAvailable();
    json(res, 200, {
      ok: true,
      service: "electronics-agent-api",
      platform: "ready",
      phase: 9.4,
      contractVersion: CONTRACT_VERSION,
      routes: listTaskRoutes(),
      agent: {
        ready: agentReady,
        available: agentReady,
        modeDefault: "auto",
        policy: {
          provider: runtime.modelPolicy?.provider || "unresolved",
          model: runtime.modelPolicy?.model || "unresolved",
        },
      },
      sources: sourceReadiness(),
    });
    return;
  }

  const protectedResource = url.pathname.startsWith("/v1/") || url.pathname === "/metrics";
  if (protectedResource && !authorized(req)) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }
  if (protectedResource) {
    const limited = apiGuard.rate(req);
    res.setHeader("x-ratelimit-remaining", limited.remaining == null ? "unlimited" : String(limited.remaining));
    if (!limited.ok) {
      res.setHeader("retry-after", String(limited.retryAfterSeconds));
      return json(res, 429, { ok: false, error: "rate_limited" });
    }
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    return json(res, 200, {
      ok: true,
      service: "electronics-agent-api",
      generatedAt: new Date().toISOString(),
      http: apiGuard.snapshot(),
      tasks: {
        ...taskStore.stats(),
        ...research.stats(),
        activeSseConnections,
        maxSseConnections: SSE_MAX_CONNECTIONS,
      },
      runtime: { harnessStarts: runtime.harnessStarts, routerCalls: runtime.routerCalls },
    });
  }

  const readJsonBody = () => apiGuard.readJsonBody(req);
  const withinDeadline = (work) => withRequestDeadline(work, { onDeadline: apiGuard.markDeadline });

  if (req.method === "POST" && url.pathname === "/v1/import/extract") {
    try {
      const body = await readJsonBody();
      const parsed = parseImportRequest(body);
      if (!parsed.ok) return contractError(res, parsed.errors);
      const result = await withinDeadline((signal) => runtime.runImport({ ...body, ...parsed.value }, { signal }));
      if (!result.ok) {
        json(res, 422, result);
        return;
      }
      json(res, 200, {
        candidates: result.candidates,
        mapping: result.mapping ?? null,
        usedAi: Boolean(result.usedAi),
        needsAgent: Boolean(result.needsAgent),
        viaHarness: Boolean(result.viaHarness),
        route: result.route,
        mode: result.mode,
        error: result.error,
        toolsCalled: result.toolsCalled || [],
        reason: result.reason,
        preview: result.preview,
        textPreview: result.textPreview,
        modelRoute: result.modelRoute || null,
      });
    } catch (err) {
      routeError(res, err, "extract_failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    try {
      const body = await readJsonBody();
      const agent = parseAgentRequest(body);
      if (!agent.ok) return contractError(res, agent.errors);
      const context = parseBusinessContext(body.context);
      if (!context.ok) return contractError(res, context.errors);
      const parsed = { ...body, ...agent.value, context: context.value };
      json(res, 200, await withinDeadline((signal) => runtime.runChat(parsed, requestCtx(req, { ...parsed, signal }))));
    } catch (err) {
      routeError(res, err, "chat_failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/parts/research") {
    try {
      const body = await readJsonBody();
      const parsed = parseResearchRequest(body, "part_research");
      if (!parsed.ok) return contractError(res, parsed.errors);
      json(res, 200, await withinDeadline((signal) => research.handlePartResearch(parsed.value, req, { signal })));
    } catch (err) {
      routeError(res, err, "part_research_failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/companies/research") {
    try {
      const body = await readJsonBody();
      const parsed = parseResearchRequest(body, "company_research");
      if (!parsed.ok) return contractError(res, parsed.errors);
      json(res, 200, await withinDeadline((signal) => research.handleCompanyResearch(parsed.value, req, { signal })));
    } catch (err) {
      routeError(res, err, "company_research_failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/tasks") {
    try {
      const body = await readJsonBody();
      const parsed = parseTaskRequest(body);
      if (!parsed.ok) return contractError(res, parsed.errors);
      const created = research.createTask({
        taskId: `task-${randomUUID()}`,
        type: parsed.value.type,
        input: parsed.value.input,
        requestHash: taskRequestHash(parsed.value),
        idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
      });
      if (created.overloaded) {
        res.setHeader("retry-after", "5");
        return json(res, 503, { ok: false, error: "task_capacity_exceeded" });
      }
      if (created.conflict) return json(res, 409, { ok: false, error: "idempotency_conflict", taskId: created.task.taskId });
      if (created.created) research.runTask(created.task.taskId, req).catch(() => {});
      json(res, created.created ? 202 : 200, {
        taskId: created.task.taskId,
        type: created.task.type,
        status: created.task.status,
        idempotent: !created.created,
      });
    } catch (err) {
      routeError(res, err, "invalid_task", 400);
    }
    return;
  }

  if (req.method === "POST" && /^\/v1\/tasks\/[^/]+\/cancel$/.test(url.pathname)) {
    const taskId = url.pathname.slice("/v1/tasks/".length, -"/cancel".length);
    const cancelled = research.cancelTask(taskId);
    if (!cancelled.task) return json(res, 404, { ok: false, error: "task not found" });
    return json(res, cancelled.cancelled ? 200 : 409, {
      taskId,
      status: cancelled.task.status,
      cancelled: cancelled.cancelled,
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
    const rest = url.pathname.slice("/v1/tasks/".length);
    const [id, tail] = rest.split("/");
    const task = research.getTask(id);
    if (!task) return json(res, 404, { ok: false, error: "task not found" });
    if (tail === "events") {
      const rawAfter = req.headers["last-event-id"] || url.searchParams.get("after") || 0;
      const after = Number(rawAfter);
      if (!Number.isSafeInteger(after) || after < 0) {
        return json(res, 400, { ok: false, error: "invalid_event_cursor" });
      }
      const limit = Number(url.searchParams.get("limit") || 500);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        return json(res, 400, { ok: false, error: "invalid_event_limit" });
      }
      const events = research.listEvents(id, after, limit);
      if (String(req.headers.accept || "").includes("text/event-stream")) return writeTaskEvents(req, res, id, after);
      return json(res, 200, { taskId: id, events, nextEventId: events.at(-1)?.id || after });
    }
    if (tail === "result") return json(res, 200, { taskId: id, status: task.status, result: task.result });
    return json(res, 200, { taskId: id, type: task.type, status: task.status, error: task.error });
  }

  if (req.method !== "POST" || url.pathname !== "/v1/hello") {
    json(res, 404, { ok: false, error: "not found" });
    return;
  }
  try {
    const parsed = await readJsonBody();
    const token = String(parsed.token ?? "").trim();
    if (!token) {
      json(res, 400, { ok: false, error: "token required" });
      return;
    }
    json(res, 200, await withinDeadline((signal) => runtime.ping(token, { signal })));
  } catch (err) {
    routeError(res, err, "runtime_failed", 502);
  }
});

if (process.env.ELECTRONICS_AGENT_API_NO_LISTEN !== "1") {
  server.listen(PORT, HOST, () => {
    process.stderr.write(`[agent-api] listening on http://${HOST}:${PORT}\n`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[agent-api] ${signal} received; draining tasks\n`);
    clearInterval(recoveryTimer);
    server.close();
    const graceMs = Number.isSafeInteger(Number(process.env.AGENT_SHUTDOWN_GRACE_MS))
      && Number(process.env.AGENT_SHUTDOWN_GRACE_MS) > 0
      ? Number(process.env.AGENT_SHUTDOWN_GRACE_MS)
      : 10_000;
    let graceTimer;
    await Promise.race([
      research.shutdown(),
      new Promise((resolve) => {
        graceTimer = setTimeout(resolve, graceMs);
        graceTimer.unref();
      }),
    ]);
    clearTimeout(graceTimer);
    server.closeAllConnections();
    taskStore.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

export { server, runtime, taskStore };
