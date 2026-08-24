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
  queued/running rows whose heartbeat is stale become retryable
  `service_restarted` failures instead of remaining permanently in progress.
  Active task heartbeats prevent a second reader from killing healthy work.
  The Compose named volume keeps task metadata across container replacement.

## Production resource boundaries and observability

- `AGENT_MAX_BODY_BYTES` bounds streamed JSON before parsing (default 12 MiB),
  returning `413 payload_too_large` without invoking Runtime.
- `AGENT_RATE_LIMIT_PER_MINUTE` and `AGENT_RATE_WINDOW_MS` bound authenticated
  calls by a one-way token/IP fingerprint. Raw credentials are never logged.
- `AGENT_REQUEST_DEADLINE_MS` bounds synchronous Import, Chat, Part, Company
  and Hello calls. Request abort signals reach Harness and HTTP connectors.
- `TASK_MAX_CONCURRENT`, `TASK_MAX_QUEUED` and `SSE_MAX_CONNECTIONS` protect
  Harness processes, the local queue and streaming connections. Cursor replay
  is capped at 500 events, and slow SSE clients use Node backpressure.
- Every response carries a safe `X-Request-ID`; logs contain only request id,
  method, path, status and duration. Authenticated `GET /metrics` exposes
  request counters, deadlines, task status/capacity and Runtime start counts.
- SIGTERM/SIGINT stops acceptance, fails queued work as retryable, aborts active
  request-owned Harness instances, waits for the configured grace period, then
  closes HTTP connections and SQLite.

SQLite is the durable single-writer baseline. Cross-process SSE readers poll
the database as well as using same-process notifications, and idempotent create
uses the database unique constraint as the race arbiter. Horizontal task
workers remain a later Postgres/queue deployment option, not an implicit
property of this Compose file.

## Verification

`tests/phase10/task-store.test.mjs`, `task-runtime.test.mjs`, and
`task-http.test.mjs` cover SQLite restart durability, TTL cleanup, idempotency,
JSON/SSE replay (including an external SQLite writer), cancellation, deadline
aborts, capacity, HTTP limits, metrics and context redaction. Node 22
currently prints the expected experimental `node:sqlite` warning during these
tests.
