# Phase 9.4 — Agent API Production Boundary

## Authentication

When `AGENT_API_TOKEN` is configured, every task resource requires a matching
`Authorization: Bearer <token>` header:

- `POST /v1/tasks`
- `GET /v1/tasks/:taskId`
- `GET /v1/tasks/:taskId/events`
- `GET /v1/tasks/:taskId/result`

Authentication runs before task lookup, so an unauthenticated request cannot
discover whether a task exists or inspect its events/result.

`GET /health` is deliberately public for local orchestrators and load probes. It
does not run a model turn and may expose only service status, contract version,
route names, and non-secret model availability/policy identifiers. It must never
return tokens, request context, task data, database credentials, or model API
keys.

## Contract Gate

Before Platform creates a task or asks the Runtime to research, the HTTP API
uses the shared `@electronics/contracts` parsers:

- part request: `parsePartResearchRequest`
- company request: `parseCompanyResearchRequest`
- import request: `parseImportRequest`
- chat request: `parseAgentRequest`
- task request: `parseTaskCreateRequest`, then the matching research parser
- caller context: `parseBusinessContext`

Invalid types, missing MPN/company, write/SQL semantics, invalid modes, and
invalid business context receive one stable response shape:

```json
{ "ok": false, "error": "contract_error", "errors": [{ "path": "...", "message": "..." }] }
```

with HTTP `422`. The gate runs before `createTask`, `runTask`, or any Harness
call. A valid Phase 9.4 caller-supplied Context is canonicalized and forwarded
unchanged in meaning to the request-scoped Runtime context.

## Evidence

`tests/phase9/api-boundary.test.mjs` verifies the public health policy, task
authentication on all task resource variants, rejected contract shapes, and an
accepted Radar + Workbench Phase 9.4 Context.
