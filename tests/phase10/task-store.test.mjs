import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "../../apps/agent-api/src/task-store.js";

test("TaskStore persists task state/events, deduplicates safely, and excludes request context", () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-store-"));
  const path = join(dir, "tasks.sqlite");
  try {
    const first = createTaskStore({ path, ttlMs: 1_000 });
    const created = first.create({
      taskId: "task-one",
      type: "part_research",
      requestHash: "hash-one",
      idempotencyKey: "idem-one",
    });
    assert.equal(created.created, true);
    first.appendEvent("task-one", { phase: "tool_call", name: "part_research", payload: { context: "must-not-persist" } });
    first.complete("task-one", { ok: true, businessContext: { inventory: { onHand: 2 } }, advice: { internalView: "2" } });
    first.close();

    const restarted = createTaskStore({ path, ttlMs: 1_000 });
    const task = restarted.get("task-one");
    assert.equal(task.status, "done");
    assert.equal(task.result.ok, true);
    assert.equal(JSON.stringify(task).includes("businessContext"), false);
    assert.equal(JSON.stringify(restarted.listEvents("task-one")).includes("must-not-persist"), false);
    assert.equal(restarted.create({ taskId: "other", type: "part_research", requestHash: "hash-one", idempotencyKey: "idem-one" }).created, false);
    assert.equal(restarted.create({ taskId: "other", type: "part_research", requestHash: "different", idempotencyKey: "idem-one" }).conflict, true);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TaskStore removes terminal tasks after the configured TTL", () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-ttl-"));
  let clock = Date.parse("2026-01-01T00:00:00.000Z");
  try {
    const store = createTaskStore({ path: join(dir, "tasks.sqlite"), ttlMs: 10, now: () => clock });
    store.create({ taskId: "task-expired", type: "part_research", requestHash: "expired" });
    store.complete("task-expired", { ok: true });
    clock += 11;
    assert.equal(store.get("task-expired"), null);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TaskStore publishes safe live events and recovers interrupted work", () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-task-recovery-"));
  const path = join(dir, "tasks.sqlite");
  try {
    const first = createTaskStore({ path });
    first.create({ taskId: "task-running", type: "part_research", requestHash: "running" });
    first.setRunning("task-running");
    const received = [];
    const unsubscribe = first.subscribe("task-running", (event) => received.push(event));
    first.appendEvent("task-running", {
      phase: "observation",
      name: "live",
      payload: { context: { inventory: { onHand: 4 } }, ok: true },
    });
    unsubscribe();
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.ok, true);
    assert.equal(JSON.stringify(received).includes("inventory"), false);
    first.close();

    const restarted = createTaskStore({ path });
    assert.equal(restarted.recoverInterrupted(), 1);
    assert.equal(restarted.get("task-running").status, "failed");
    assert.match(restarted.get("task-running").error, /service_restarted/);
    assert.equal(restarted.listEvents("task-running").at(-1).name, "service_restarted");
    assert.equal(restarted.recoverInterrupted(), 0);
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
