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
