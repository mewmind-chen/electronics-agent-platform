# Phase 8 evidence — official Harness on the business path

## Gap closed

`DeepSeekHarnessRuntime` now implements:

- `runImport()`
- `runPartResearch()`
- `runCompanyResearch()`
- `startPartResearch()` / `startCompanyResearch()` (task wrappers)

`POST /v1/import/extract`, `/v1/parts/research`, `/v1/companies/research` go through this runtime. They no longer call core as the only path.

## Routing

| Input | Path |
|---|---|
| Import table + mapping, or `rawRows` | `import-core.extractImport` (`viaHarness: false`) |
| Unstructured text / image / table without mapping | official import tools (`import_classify` → `import_normalize_text` / `import_table_preview` → `import_validate_rows` / `import_apply_mapping`) |
| Part/Company default | `part-intelligence-core` / `company-intelligence-core` |
| Part/Company `viaAgent: true` | official `part_research` / `company_research` |

With `DEEPSEEK_API_KEY` (or `ELECTRONICS_USE_OFFICIAL_HARNESS=1`) the agent path is `DeepSeekHarness.run` against `runtime/jsonrpc.cordis.yml`. Tests set `ELECTRONICS_HARNESS_STUB=1` and still execute the same `defineTool` objects from `dsh-import` / `dsh-part` / `dsh-company`.

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
