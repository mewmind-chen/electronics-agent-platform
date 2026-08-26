/**
 * Durable task metadata/event store. Request inputs remain process-local: task
 * context can contain business facts and must not be written to SQLite.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SENSITIVE_KEYS = new Set([
  "context",
  "businessContext",
  "advice",
  "inventory",
  "quotation",
  "customer",
  "snapshots",
  "previousLcscPrice",
  "firecrawlKey",
  "anysearchKey",
  "icnetCookie",
  "mouserKey",
  "authorization",
  "token",
  "recommendation",
].map((key) => key.toLowerCase()));

const PUBLIC_RESULT_KEYS = new Set([
  "ok", "mpn", "company", "identity", "offers", "evidence", "verdict",
  "dossier", "analysis", "supply", "cards", "positioning", "steps",
  "sourceRuntime",
  "companies", "shopRows", "profile", "mode", "viaHarness", "usedAi",
  "route", "fallbackFrom", "modelRoute", "premiumReviewUnavailable",
  "error", "errors", "reason", "needsAgent", "mapping", "candidates",
]);

const EVENT_PAYLOAD_KEYS = new Set([
  "ok", "viaHarness", "timeout", "cancelled", "retryable", "errorCode",
  "queued", "running",
]);

function nowIso(now) {
  return new Date(now()).toISOString();
}

function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalized = key.toLowerCase();
        return !SENSITIVE_KEYS.has(normalized) && !/(api.?key|secret|credential|authorization|cookie|access.?token|refresh.?token)/i.test(key);
      })
      .map(([key, item]) => [key, safeValue(item)]),
  );
}

function safeTaskResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_result" };
  return safeValue(Object.fromEntries(Object.entries(value).filter(([key]) => PUBLIC_RESULT_KEYS.has(key))));
}

function safeEventPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return safeValue(Object.fromEntries(Object.entries(value).filter(([key]) => EVENT_PAYLOAD_KEYS.has(key))));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function decodeTask(row) {
  if (!row) return null;
  return {
    taskId: row.task_id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error || "",
  };
}

function decodeEvent(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    phase: row.phase,
    name: row.name,
    payload: row.payload_json ? JSON.parse(row.payload_json) : {},
    createdAt: row.created_at,
  };
}

export function createTaskStore({ path, ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now } = {}) {
  if (!path) throw new Error("TaskStore path is required");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const subscribers = new Map();
  const retentionMs = positiveInteger(ttlMs, 7 * 24 * 60 * 60 * 1000);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      result_json TEXT,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS task_events_task_id_id ON task_events(task_id, id);
    CREATE INDEX IF NOT EXISTS tasks_updated_at ON tasks(updated_at);
  `);

  const statements = {
    byId: db.prepare("SELECT * FROM tasks WHERE task_id = ?"),
    byKey: db.prepare("SELECT * FROM tasks WHERE idempotency_key = ?"),
    insert: db.prepare(
      "INSERT INTO tasks (task_id, type, status, request_hash, idempotency_key, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)",
    ),
    updateStatus: db.prepare("UPDATE tasks SET status = ?, updated_at = ?, error = ? WHERE task_id = ? AND status = 'queued'"),
    complete: db.prepare(
      "UPDATE tasks SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running')",
    ),
    cancel: db.prepare("UPDATE tasks SET status = 'cancelled', error = ?, updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running')"),
    insertEvent: db.prepare("INSERT INTO task_events (task_id, phase, name, payload_json, created_at) VALUES (?, ?, ?, ?, ?)"),
    events: db.prepare("SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?"),
    pruneEvents: db.prepare("DELETE FROM task_events WHERE task_id IN (SELECT task_id FROM tasks WHERE updated_at < ?)"),
    pruneTasks: db.prepare("DELETE FROM tasks WHERE updated_at < ? AND status IN ('done', 'failed', 'cancelled')"),
    interrupted: db.prepare("SELECT task_id FROM tasks WHERE status IN ('queued', 'running') ORDER BY created_at ASC"),
    recover: db.prepare(
      "UPDATE tasks SET status = 'failed', result_json = ?, error = 'service_restarted', updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running')",
    ),
    touchRunning: db.prepare("UPDATE tasks SET updated_at = ? WHERE task_id = ? AND status = 'running'"),
    touchActive: db.prepare("UPDATE tasks SET updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running')"),
    interruptedBefore: db.prepare(
      "SELECT task_id FROM tasks WHERE status IN ('queued', 'running') AND updated_at <= ? ORDER BY created_at ASC",
    ),
    stats: db.prepare("SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY status ASC"),
  };

  function prune() {
    const cutoff = new Date(now() - retentionMs).toISOString();
    statements.pruneEvents.run(cutoff);
    return statements.pruneTasks.run(cutoff).changes;
  }

  function get(taskId) {
    prune();
    return decodeTask(statements.byId.get(taskId));
  }

  function publish(event) {
    for (const listener of subscribers.get(event.taskId) || []) {
      try {
        listener(event);
      } catch {
        // A disconnected SSE client must not affect task state persistence.
      }
    }
  }

  function appendEvent(taskId, { phase, name = "", payload = {} }) {
    const timestamp = nowIso(now);
    const safePayload = safeEventPayload(payload);
    const encoded = JSON.stringify(safePayload);
    const out = statements.insertEvent.run(taskId, phase, name, encoded, timestamp);
    const event = decodeEvent({
      id: Number(out.lastInsertRowid),
      task_id: taskId,
      phase,
      name,
      payload_json: encoded,
      created_at: timestamp,
    });
    publish(event);
    return event;
  }

  return {
    lookupIdempotency(idempotencyKey, requestHash) {
      if (!idempotencyKey) return null;
      const raw = statements.byKey.get(idempotencyKey);
      if (!raw) return null;
      const task = decodeTask(raw);
      return raw.request_hash === requestHash
        ? { created: false, task }
        : { conflict: true, task };
    },
    create({ taskId, type, requestHash, idempotencyKey = "" }) {
      prune();
      if (idempotencyKey) {
        const existing = decodeTask(statements.byKey.get(idempotencyKey));
        if (existing) {
          const raw = statements.byKey.get(idempotencyKey);
          if (raw.request_hash !== requestHash) return { conflict: true, task: existing };
          return { created: false, task: existing };
        }
      }
      const timestamp = nowIso(now);
      try {
        statements.insert.run(taskId, type, requestHash, idempotencyKey || null, timestamp, timestamp);
      } catch (err) {
        // Two API processes may race after both observe a missing key. SQLite's
        // unique constraint is the final arbiter; re-read and return stable
        // idempotency semantics instead of leaking a storage error.
        if (idempotencyKey) {
          const raw = statements.byKey.get(idempotencyKey);
          if (raw) {
            const existing = decodeTask(raw);
            if (raw.request_hash !== requestHash) return { conflict: true, task: existing };
            return { created: false, task: existing };
          }
        }
        throw err;
      }
      return { created: true, task: get(taskId) };
    },
    get,
    listEvents(taskId, afterId = 0, limit = 500) {
      prune();
      const cursor = Number(afterId);
      const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
      const safeLimit = Math.min(500, positiveInteger(limit, 500));
      return statements.events.all(taskId, safeCursor, safeLimit).map(decodeEvent);
    },
    appendEvent,
    subscribe(taskId, listener) {
      const listeners = subscribers.get(taskId) || new Set();
      listeners.add(listener);
      subscribers.set(taskId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) subscribers.delete(taskId);
      };
    },
    setRunning(taskId) {
      const timestamp = nowIso(now);
      statements.updateStatus.run("running", timestamp, "", taskId);
      return get(taskId);
    },
    touchRunning(taskId) {
      return Boolean(statements.touchRunning.run(nowIso(now), taskId).changes);
    },
    touchActive(taskId) {
      return Boolean(statements.touchActive.run(nowIso(now), taskId).changes);
    },
    complete(taskId, result) {
      const safeResult = safeTaskResult(result);
      const timestamp = nowIso(now);
      const status = safeResult?.ok ? "done" : "failed";
      const error = safeResult?.ok ? "" : JSON.stringify(safeResult?.errors || safeResult?.error || "failed");
      const changed = statements.complete.run(status, JSON.stringify(safeResult), error, timestamp, taskId).changes;
      return { updated: Boolean(changed), task: get(taskId) };
    },
    fail(taskId, error) {
      const result = { ok: false, error: String(error || "failed") };
      const safeResult = safeTaskResult(result);
      const timestamp = nowIso(now);
      const changed = statements.complete.run(
        "failed",
        JSON.stringify(safeResult),
        safeResult.error,
        timestamp,
        taskId,
      ).changes;
      return { updated: Boolean(changed), task: get(taskId) };
    },
    cancel(taskId, reason = "cancelled") {
      const changed = statements.cancel.run(String(reason), nowIso(now), taskId).changes;
      const task = get(taskId);
      if (changed) appendEvent(taskId, { phase: "decision", name: "cancelled", payload: { cancelled: true } });
      return { cancelled: Boolean(changed), task };
    },
    recoverInterrupted({ olderThanMs = 0 } = {}) {
      const delay = Number.isFinite(Number(olderThanMs)) && Number(olderThanMs) >= 0 ? Number(olderThanMs) : 0;
      const cutoff = new Date(now() - delay).toISOString();
      const interrupted = (delay === 0 ? statements.interrupted.all() : statements.interruptedBefore.all(cutoff))
        .map((row) => row.task_id);
      let recovered = 0;
      for (const taskId of interrupted) {
        const timestamp = nowIso(now);
        const result = { ok: false, error: "service_restarted" };
        const changed = statements.recover.run(JSON.stringify(result), timestamp, taskId).changes;
        if (changed) {
          recovered += 1;
          appendEvent(taskId, {
            phase: "degrade",
            name: "service_restarted",
            payload: { retryable: true },
          });
        }
      }
      return recovered;
    },
    stats() {
      prune();
      const byStatus = Object.fromEntries(statements.stats.all().map((row) => [row.status, Number(row.count)]));
      return {
        byStatus,
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        queued: byStatus.queued || 0,
        running: byStatus.running || 0,
      };
    },
    prune,
    close() {
      subscribers.clear();
      db.close();
    },
  };
}
