/**
 * Agent API — Phase 1: POST /v1/hello.
 * Phase 3: POST /v1/import/extract returns ImportCandidate[] only.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@electronics/contracts";
import { extractImport } from "@electronics/import-core";
import { createRuntime } from "./runtime.js";
import {
  createTask,
  getTask,
  handleCompanyResearch,
  handlePartResearch,
  listTaskRoutes,
  runTask,
} from "./research.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
mkdirSync(join(root, ".dsh-platform/sessions"), { recursive: true });
mkdirSync(join(root, ".dsh-platform/workspace"), { recursive: true });

const HOST = process.env.AGENT_API_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_API_PORT || 8787);
const TOKEN = String(process.env.AGENT_API_TOKEN || "").trim();
const runtime = createRuntime();

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
      phase: 7,
      contractVersion: CONTRACT_VERSION,
      routes: listTaskRoutes(),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/import/extract") {
    if (!authorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    let raw = "";
    try {
      for await (const chunk of req) raw += chunk;
    } catch {
      json(res, 400, { ok: false, error: "invalid body" });
      return;
    }
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, 400, { ok: false, error: "invalid JSON" });
      return;
    }
    try {
      const result = await extractImport(parsed);
      if (!result.ok) {
        json(res, 422, result);
        return;
      }
      json(res, 200, {
        candidates: result.candidates,
        mapping: result.mapping ?? null,
        usedAi: Boolean(result.usedAi),
        needsAgent: Boolean(result.needsAgent),
        reason: result.reason,
        preview: result.preview,
        textPreview: result.textPreview,
      });
    } catch (err) {
      console.error("[agent-api] extract failed", err);
      json(res, 500, { ok: false, error: "extract failed" });
    }
    return;
  }

  async function readJsonBody() {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  if (req.method === "POST" && url.pathname === "/v1/parts/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      json(res, 200, await handlePartResearch(body, req));
    } catch (err) {
      json(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: "part research failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/companies/research") {
    if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    try {
      const body = await readJsonBody();
      json(res, 200, await handleCompanyResearch(body, req));
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
      const task = createTask(type, body.input || body);
      runTask(task.taskId, req).catch((err) => console.error("[agent-api] task", err));
      json(res, 202, { taskId: task.taskId, type: task.type, status: task.status });
    } catch (err) {
      json(res, 400, { ok: false, error: "invalid task" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
    const rest = url.pathname.slice("/v1/tasks/".length);
    const [id, tail] = rest.split("/");
    const task = getTask(id);
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
  let body = "";
  try {
    for await (const chunk of req) body += chunk;
  } catch {
    json(res, 400, { ok: false, error: "invalid body" });
    return;
  }
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    json(res, 400, { ok: false, error: "invalid JSON" });
    return;
  }
  const token = String(parsed.token ?? "").trim();
  if (!token) {
    json(res, 400, { ok: false, error: "token required" });
    return;
  }
  try {
    const result = await runtime.ping(token);
    json(res, 200, result);
  } catch (err) {
    console.error("[agent-api] ping failed", err);
    json(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : "runtime failed",
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[agent-api] Phase 1 listening on http://${HOST}:${PORT}\n`);
});
