# Phase 3 evidence

Collected 2026-08-24. Import Pipeline V2 only. No Radar / Workbench edits.

## What landed

| piece | path | role |
|---|---|---|
| domain parsers | `packages/electronics-domain` | qty / price / warehouse / brand; no Harness |
| import-core | `packages/import-core` | readers, validators, mapping executor, extract |
| official plugin | `packages/dsh-import` | `apply(ctx)` + `defineTool` |
| official skill | `.dsh/skills/import.md` | table = mapping then bulk parse; text = AI then validate |
| API | `POST /v1/import/extract` | `ImportCandidate[]` only |

## Pipeline rules proven by tests

- `10K` → 10000; model qty 1000 vs parser 10000 → `qty_conflict` warning
- MPN not rewritten; missing provenance → warning
- Excel/CSV: Agent mapping + program bulk parse (no `headerKey` main path)
- Unstructured text without `rawRows` → `needsAgent: true`, **zero** silent heuristic hits
- Mapped CSV via HTTP returns candidates without `selected` / `duplicate`

## Official runtime

```text
dsh --profile headless --patch ./runtime/hello.cordis.yml --dump-config
# includes electronics-import → packages/dsh-import/src/index.js

node runtime/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js runtime/jsonrpc.cordis.yml
# stderr:
# [electronics-hello] plugin loaded
# [electronics-import] plugin loaded
```

## Tests

```sh
node --test packages/contracts/src/contracts.test.js \
  packages/import-core/src/import-core.test.js \
  tests/phase1/*.test.mjs tests/phase3/*.test.mjs
# 20/20 pass
```

## Business repos

```text
xinghao-radar:           ## main...origin/main
huaqiangbei-workbench:   ## main...origin/main
```

## Not done (correct)

- Radar UI still uses its local `heuristicParse` (fallback stays in the business app)
- No `/v1/parts/research` or company research
- Unstructured extract now continues through official import tools (`needsAgent: false`, `viaHarness: true`) unless the caller already supplies `rawRows`
