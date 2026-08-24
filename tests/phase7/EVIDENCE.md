# Phase 5–7 evidence

## Platform

- `POST /v1/parts/research` and `POST /v1/companies/research` return contracts, not SQL.
- Official plugins: `electronics-part`, `electronics-company` appear in `dsh --dump-config`.
- Failed market steps are not treated as evidence.

Tests: `packages/part-intelligence-core/src/part-core.test.js`, `packages/company-intelligence-core/src/company-core.test.js`, `tests/phase5/research-api.test.mjs`.

## Radar

- `src/lib/server/import.ts` calls `extractViaPlatform` first; local `runImportAgent` / heuristic remains fallback.
- `confirmImport` still writes Radar DB only.
- `knowledge.ts` calls `/v1/parts/research` first; Workbench `/api/agent/lookup.full` remains fallback.
- Client has no `@deepseek-ai` types.

Tests: `scripts/agent-platform.test.mjs`, `scripts/agent-api-boundary.test.mjs`.

## Workbench

- `search-panel.tsx` calls `researchViaPlatform` first; `lookupStep` remains fallback.
- Formal reports still saved by Workbench `saveReport`.
- Client posts to `/v1/parts/research` and `/v1/companies/research` only.

Tests: `scripts/agent-platform-boundary.test.mjs`.
