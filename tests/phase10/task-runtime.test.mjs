import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "../../apps/agent-api/src/task-store.js";
import { createResearchHandlers } from "../../apps/agent-api/src/research.js";

function deferredResearch() {
  let aborted = false;
  return {
    get aborted() {
      return aborted;
    },
    runtime: {
      runPartResearch(_input, ctx) {
        return new Promise((resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            reject(ctx.signal.reason);
          }, { once: true });
        });
      },
      runCompanyResearch() {
        throw new Error("not used");
      },
    },
  };
}

function task(handlers, id) {
  return handlers.createTask({
    taskId: id,
    type: "part_research",
    input: { mpn: "NE555P", mode: "agent", context: { inventory: { source: "radar", onHand: 1 } } },
    requestHash: id,
    idempotencyKey: id,
  });
}

test("cancelling a running task aborts its request and cannot be overwritten by a late result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-runtime-"));
  try {
    const store = createTaskStore({ path: join(dir, "tasks.sqlite") });
    const fake = deferredResearch();
    const handlers = createResearchHandlers(fake.runtime, { store, deadlineMs: 1_000 });
    task(handlers, "task-cancel");
    const running = handlers.runTask("task-cancel", { headers: {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(handlers.cancelTask("task-cancel").cancelled, true);
    await running;
    const saved = store.get("task-cancel");
    assert.equal(fake.aborted, true);
    assert.equal(saved.status, "cancelled");
    assert.equal(saved.result, null);
    assert.ok(store.listEvents("task-cancel").some((event) => event.name === "cancelled"));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deadline aborts the request and records a failed timeout without context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-runtime-"));
  try {
    const store = createTaskStore({ path: join(dir, "tasks.sqlite") });
    const fake = deferredResearch();
    const handlers = createResearchHandlers(fake.runtime, { store, deadlineMs: 5 });
    task(handlers, "task-deadline");
    await handlers.runTask("task-deadline", { headers: {} });
    const saved = store.get("task-deadline");
    assert.equal(fake.aborted, true);
    assert.equal(saved.status, "failed");
    assert.match(saved.error, /deadline_exceeded/);
    assert.equal(JSON.stringify(saved).includes("inventory"), false);
    assert.ok(store.listEvents("task-deadline").some((event) => event.name === "deadline"));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task concurrency and queue capacity are bounded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-capacity-"));
  try {
    let active = 0;
    let maxActive = 0;
    const resolvers = [];
    const runtime = {
      runPartResearch() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise((resolve) => resolvers.push(() => {
          active -= 1;
          resolve({ ok: true, mpn: "NE555P", viaHarness: false });
        }));
      },
      runCompanyResearch() {
        throw new Error("not used");
      },
    };
    const store = createTaskStore({ path: join(dir, "tasks.sqlite") });
    const handlers = createResearchHandlers(runtime, { store, deadlineMs: 1_000, maxConcurrent: 1, maxQueued: 1 });
    assert.equal(task(handlers, "task-cap-1").created, true);
    assert.equal(task(handlers, "task-cap-2").created, true);
    assert.equal(task(handlers, "task-cap-3").overloaded, true);
    const first = handlers.runTask("task-cap-1", { headers: {} });
    const second = handlers.runTask("task-cap-2", { headers: {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(active, 1);
    resolvers.shift()();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(active, 1);
    assert.equal(maxActive, 1);
    resolvers.shift()();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(store.get("task-cap-1").status, "done");
    assert.equal(store.get("task-cap-2").status, "done");
    await handlers.shutdown();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
