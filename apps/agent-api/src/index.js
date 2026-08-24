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

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
mkdirSync(join(root, ".dsh-platform/sessions"), { recursive: true });
mkdirSync(join(root, ".dsh-platform/workspace"), { recursive: true });

const HOST = process.env.AGENT_API_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_API_PORT || 8787);
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();
const runtime = createRuntime();
const taskStore = createTaskStore({
  path: process.env.TASK_STORE_PATH || join(root, ".dsh-platform/tasks.sqlite"),
  ttlMs: Number(process.env.TASK_TTL_MS || 7 * 24 * 60 * 60 * 1000),
});
const interruptedTasks = taskStore.recoverInterrupted();
if (interruptedTasks) {
  process.stderr.write(`[agent-api] marked ${interruptedTasks} interrupted task(s) as failed after restart\n`);
}
const research = createResearchHandlers(runtime, { store: taskStore });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req) {
  if (!TOKEN) return true;
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return got === TOKEN;
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
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeTaskEvents(req, res, taskId, after) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": task event stream\n\n");

  let closed = false;
  let heartbeat;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  const finishIfTerminal = () => {
    const status = research.getTask(taskId)?.status;
    if (["done", "failed", "cancelled"].includes(status)) {
      cleanup();
      res.end();
      return true;
    }
    return false;
  };

  // Subscription and backlog lookup are both synchronous. Registering first
  // closes the tiny race where a task could finish between replay and listen.
  unsubscribe = research.subscribeEvents(taskId, (event) => {
    if (closed) return;
    writeTaskEvent(res, event);
    finishIfTerminal();
  });
  for (const event of research.listEvents(taskId, after)) {
    writeTaskEvent(res, event);
  }
  if (finishIfTerminal()) return;
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
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "electronics-agent-api",
      phase: 9.4,
      contractVersion: CONTRACT_VERSION,
      routes: listTaskRoutes(),
      agent: {
        available: runtime.isAgentAvailable(),
        modeDefault: "auto",
        policy: {
          provider: runtime.modelPolicy?.provider || "unresolved",
          model: runtime.modelPolicy?.model || "unresolved",
        },
      },
    });
    return;
  }

  async function readJsonBody() {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  if (req.method === "POST" && url.pathname === "/v1/import/extract") {
    if (!authorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    try {
      const body = await readJsonBody();
      const parsed = parseImportRequest(body);
      if (!parsed.ok) return contractError(res, parsed.errors);
      const result = await runtime.runImport({ ...body, ...parsed.value });
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
      console.error("[agent-api] extract failed", err);
      json(res, 500, { ok: false, error: err instanceof SyntaxError ? "invalid JSON" : "extract failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      const agent = parseAgentRequest(body);
      if (!agent.ok) return contractError(res, agent.errors);
      const context = parseBusinessContext(body.context);
      if (!context.ok) return contractError(res, context.errors);
      const parsed = { ...body, ...agent.value, context: context.value };
      json(res, 200, await runtime.runChat(parsed, requestCtx(req, parsed)));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "chat failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/parts/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      const parsed = parseResearchRequest(body, "part_research");
      if (!parsed.ok) return contractError(res, parsed.errors);
      json(res, 200, await research.handlePartResearch(parsed.value, req));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "part research failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/companies/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      const parsed = parseResearchRequest(body, "company_research");
      if (!parsed.ok) return contractError(res, parsed.errors);
      json(res, 200, await research.handleCompanyResearch(parsed.value, req));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "company research failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/tasks") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
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
      if (created.conflict) return json(res, 409, { ok: false, error: "idempotency_conflict", taskId: created.task.taskId });
      if (created.created) research.runTask(created.task.taskId, req).catch((err) => console.error("[agent-api] task", err));
      json(res, created.created ? 202 : 200, {
        taskId: created.task.taskId,
        type: created.task.type,
        status: created.task.status,
        idempotent: !created.created,
      });
    } catch {
      json(res, 400, { ok: false, error: "invalid task" });
    }
    return;
  }

  if (req.method === "POST" && /^\/v1\/tasks\/[^/]+\/cancel$/.test(url.pathname)) {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
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
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    const rest = url.pathname.slice("/v1/tasks/".length);
    const [id, tail] = rest.split("/");
    const task = research.getTask(id);
    if (!task) return json(res, 404, { ok: false, error: "task not found" });
    if (tail === "events") {
      const after = Number(req.headers["last-event-id"] || url.searchParams.get("after") || 0);
      const events = research.listEvents(id, after);
      if (String(req.headers.accept || "").includes("text/event-stream")) return writeTaskEvents(req, res, id, after);
      return json(res, 200, { taskId: id, events });
    }
    if (tail === "result") return json(res, 200, { taskId: id, status: task.status, result: task.result });
    return json(res, 200, { taskId: id, type: task.type, status: task.status, error: task.error });
  }

  if (req.method !== "POST" || url.pathname !== "/v1/hello") {
    json(res, 404, { ok: false, error: "not found" });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  try {
    const parsed = await readJsonBody();
    const token = String(parsed.token ?? "").trim();
    if (!token) {
      json(res, 400, { ok: false, error: "token required" });
      return;
    }
    json(res, 200, await runtime.ping(token));
  } catch (err) {
    console.error("[agent-api] ping failed", err);
    json(res, err instanceof SyntaxError ? 400 : 502, {
      ok: false,
      error: err instanceof SyntaxError ? "invalid JSON" : err instanceof Error ? err.message : "runtime failed",
    });
  }
});

if (process.env.ELECTRONICS_AGENT_API_NO_LISTEN !== "1") {
  server.listen(PORT, HOST, () => {
    process.stderr.write(`[agent-api] listening on http://${HOST}:${PORT}\n`);
  });
}

export { server, runtime, taskStore };
