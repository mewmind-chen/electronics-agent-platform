/**
 * Agent API — stable HTTP surface.
 * Import / part / company go through DeepSeekHarnessRuntime.
 * Deterministic fast path stays in core. Agent path uses official Harness.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@electronics/contracts";
import { createRuntime } from "./runtime.js";
import { createResearchHandlers, listTaskRoutes, requestCtx } from "./research.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
mkdirSync(join(root, ".dsh-platform/sessions"), { recursive: true });
mkdirSync(join(root, ".dsh-platform/workspace"), { recursive: true });

const HOST = process.env.AGENT_API_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_API_PORT || 8787);
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();
const runtime = createRuntime();
const research = createResearchHandlers(runtime);

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
      const parsed = await readJsonBody();
      const result = await runtime.runImport(parsed);
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
      json(res, 200, await runtime.runChat(body, requestCtx(req, body)));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "chat failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/parts/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      json(res, 200, await research.handlePartResearch(body, req));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "part research failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/companies/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      json(res, 200, await research.handleCompanyResearch(body, req));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "company research failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/tasks") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      const type = body.type === "company_research" ? "company_research" : "part_research";
      const task = research.createTask(type, body.input || body);
      research.runTask(task.taskId, req).catch((err) => console.error("[agent-api] task", err));
      json(res, 202, { taskId: task.taskId, type: task.type, status: task.status });
    } catch {
      json(res, 400, { ok: false, error: "invalid task" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
    const rest = url.pathname.slice("/v1/tasks/".length);
    const [id, tail] = rest.split("/");
    const task = research.getTask(id);
    if (!task) return json(res, 404, { ok: false, error: "task not found" });
    if (tail === "events") return json(res, 200, { taskId: id, events: task.events });
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

export { server, runtime };
