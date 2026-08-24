# Phase 10 — Reliable Task Subsystem

## Durable but deliberately narrow

`node:sqlite` persists only task metadata, a SHA-256 request fingerprint,
terminal/public result data and safe event summaries. The database does **not**
store a raw request body, authentication header/token, request-scoped business
context, connector credential, or internal-context advice. `TASK_STORE_PATH`
chooses the database location; `TASK_TTL_MS` removes terminal tasks and their
events after the configured retention window.

The result/event sanitizer protects the persistence boundary even when a caller
injects Phase 9.4 Radar or Workbench context. The direct research API can return
internal advice for its live request, but durable task reads and a restarted
service never reconstruct that context from Platform storage.

## Delivery semantics

- `Idempotency-Key` is matched with a hash of the validated task request.
  Same key + same request returns the original task; same key + different
  request returns `409 idempotency_conflict`.
- `GET /v1/tasks/:id/events` returns a JSON snapshot by default. With
  `Accept: text/event-stream`, it replays prior records and remains connected
  for live records until the task is terminal. `Last-Event-ID` or `?after=`
  resumes after a previously received event id; heartbeats keep proxies from
  silently timing out an idle stream.
- `POST /v1/tasks/:id/cancel` changes queued/running work to `cancelled`.
  An in-memory AbortController is also signalled. Terminal writes use a
  `status != 'cancelled'` guard, so late work cannot overwrite cancellation.
- Task deadlines use `TASK_DEADLINE_MS` (default 120 seconds). On abort, the
  Runtime closes the request's own `DeepSeekHarness` instance; no shared
  Harness process or business database connection exists.
- The provided deployment is intentionally single-writer. On startup, any
  queued/running rows left by a stopped instance become retryable
  `service_restarted` failures instead of remaining permanently in progress.
  The Compose named volume keeps task metadata across container replacement.

## Verification

`tests/phase10/task-store.test.mjs`, `task-runtime.test.mjs`, and
`task-http.test.mjs` cover SQLite restart durability, TTL cleanup, idempotency,
JSON/SSE replay, cancellation, deadline aborts and context redaction. Node 22
currently prints the expected experimental `node:sqlite` warning during these
tests.
