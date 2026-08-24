# Phase 8 evidence — official Harness on the business path

## Gap closed

`DeepSeekHarnessRuntime` now implements:

- `runImport()`
- `runPartResearch()`
- `runCompanyResearch()`
- `startPartResearch()` / `startCompanyResearch()` (task wrappers)

`POST /v1/import/extract`, `/v1/parts/research`, `/v1/companies/research` go through this runtime. They no longer call core as the only path.

## Execution mode

`mode: auto | agent | core` (default `auto`). `viaAgent: true` still maps to `agent`.

| mode | Behavior |
|---|---|
| `auto` | Official Harness if `DEEPSEEK_API_KEY` + runtime bin exist; else Core fallback. Never `viaHarness`/`usedAi`. |
| `agent` | Official `DeepSeekHarness.run` only. Unavailable → `{ error: "agent_unavailable" }`. Never stub, never silent core. |
| `core` | Deterministic cores only. `harnessStarts === 0`. |

`ELECTRONICS_HARNESS_STUB=1` is test-only. Stub results use `route: "stub"` and `viaHarness: false` / `usedAi: false`. Radar / Workbench send `mode: "auto"`.

## Model Policy seam

Execution mode and model selection are layered:

- `resolveExecutionMode()` chooses core / Harness / auto-fallback
- `resolveModelPolicy()` / `isAgentAvailable()` / `resolveAgentRuntime()` choose provider/model and whether the official process can start

`runtime.js` no longer reads `DEEPSEEK_API_KEY` directly. Default policy still uses that env name, but a future Model Router replaces `resolveModelPolicy` / `isAgentAvailable` without changing callers. No multi-model router is implemented.

## Routing

| Input | Path |
|---|---|
| Import table + mapping, or `rawRows` | `import-core.extractImport` (`viaHarness: false`) |
| Unstructured text / image / table without mapping | `auto`/`agent` → official import tools when Harness is live; else core fallback / `agent_unavailable` |
| Part/Company `mode=core` or `auto` without Harness | `part-intelligence-core` / `company-intelligence-core` |
| Part/Company `mode=agent` | official `part_research` / `company_research` or `agent_unavailable` |

## Tests that prove Tool execution, not dump-config

`tests/phase8/harness-execution.test.mjs`

- official plugins register `defineTool` with `.execute`
- unstructured import records `import_classify` + `import_normalize_text` + `import_validate_rows`
- `viaAgent` records `part_research` / `company_research`
- cores still have zero `@deepseek-ai` imports
- HTTP `/v1/import/extract` + `/v1/parts/research` return `viaHarness: true` and `toolsCalled`

Full suite: 38/38.

## Unchanged

- Radar `confirmImport` and Workbench `saveReport` still write their own DBs
- Radar/Workbench still have Agent API + local fallback
- No Supervisor, no homemade `/chat/completions` loop
