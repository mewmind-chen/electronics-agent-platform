import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "../../apps/agent-api/src/task-store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function waitHealth(baseUrl) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Server startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("health timeout");
}

function start(port, token, storePath) {
  return spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_HOST: "127.0.0.1",
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      TASK_STORE_PATH: storePath,
      ELECTRONICS_IGNORE_LIVE: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function call(baseUrl, path, { method = "GET", token, headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

test("tasks are idempotent, survive restart, and replay SSE from Last-Event-ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-http-"));
  const token = "task-http-token";
  const storePath = join(dir, "tasks.sqlite");
  const firstPort = 18810;
  const secondPort = 18811;
  const request = {
    type: "part_research",
    input: {
      mpn: "NE555P",
      mode: "core",
      steps: ["hqew"],
      context: { inventory: { source: "radar", onHand: 2 } },
    },
  };
  let child = start(firstPort, token, storePath);
  try {
    const firstUrl = `http://127.0.0.1:${firstPort}`;
    await waitHealth(firstUrl);
    const deniedCancel = await fetch(`${firstUrl}/v1/tasks/not-a-task/cancel`, { method: "POST" });
    assert.equal(deniedCancel.status, 401);
    const created = await call(firstUrl, "/v1/tasks", { method: "POST", token, headers: { "idempotency-key": "same-key" }, body: request });
    assert.equal(created.res.status, 202, JSON.stringify(created.body));
    const taskId = created.body.taskId;
    const repeated = await call(firstUrl, "/v1/tasks", { method: "POST", token, headers: { "idempotency-key": "same-key" }, body: request });
    assert.equal(repeated.res.status, 200);
    assert.equal(repeated.body.taskId, taskId);
    const conflict = await call(firstUrl, "/v1/tasks", {
      method: "POST", token, headers: { "idempotency-key": "same-key" }, body: { ...request, input: { ...request.input, mpn: "LM358" } },
    });
    assert.equal(conflict.res.status, 409);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = await call(firstUrl, `/v1/tasks/${taskId}/result`, { token });
    assert.equal(result.res.status, 200);
    assert.equal(result.body.status, "done");
    assert.equal(JSON.stringify(result.body).includes("businessContext"), false);
    const snapshot = await call(firstUrl, `/v1/tasks/${taskId}/events`, { token });
    assert.ok(snapshot.body.events.length >= 2);
    const lastId = snapshot.body.events.at(-1).id;
    const sse = await fetch(`${firstUrl}/v1/tasks/${taskId}/events`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream", "last-event-id": String(lastId - 1) },
    });
    assert.equal(sse.status, 200);
    const sseBody = await sse.text();
    assert.match(sse.headers.get("content-type"), /text\/event-stream/);
    assert.match(sseBody, new RegExp(`id: ${lastId}`));
    assert.equal(sseBody.includes("inventory"), false);

    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    child = start(secondPort, token, storePath);
    const secondUrl = `http://127.0.0.1:${secondPort}`;
    await waitHealth(secondUrl);
    const afterRestart = await call(secondUrl, `/v1/tasks/${taskId}/result`, { token });
    assert.equal(afterRestart.body.status, "done");
    const eventsAfterRestart = await call(secondUrl, `/v1/tasks/${taskId}/events`, { token });
    assert.equal(eventsAfterRestart.body.events.at(-1).id, lastId);
  } finally {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SSE polls SQLite so events written by another process are delivered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-cross-process-"));
  const token = "cross-process-token";
  const storePath = join(dir, "tasks.sqlite");
  const port = 18813;
  const writer = createTaskStore({ path: storePath });
  writer.create({ taskId: "task-cross-process", type: "part_research", requestHash: "cross-process" });
  writer.close();
  const child = start(port, token, storePath);
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitHealth(baseUrl);
    const response = await fetch(`${baseUrl}/v1/tasks/task-cross-process/events`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);

    const external = createTaskStore({ path: storePath });
    const event = external.appendEvent("task-cross-process", {
      phase: "observation",
      name: "external_writer",
      payload: { ok: true },
    });
    external.complete("task-cross-process", { ok: true, mpn: "NE555P" });
    external.appendEvent("task-cross-process", {
      phase: "decision",
      name: "external_done",
      payload: { ok: true },
    });
    external.close();

    const body = await response.text();
    assert.match(body, new RegExp(`id: ${event.id}`));
    assert.match(body, /external_done/);
  } finally {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
});
