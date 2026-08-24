# Phase 11 — Electronics Agent Plugin MVP

Radar / Workbench / Contract / Runtime / Model Policy unchanged.

## Verdict

A user-side DeepSeek Harness plugin can call electronics-agent-platform over HTTP. Internal `dsh-import` / `dsh-part` / `dsh-company` / `dsh-hello` were not published.

Live prompt `分析 TPS54560DDAR` (2026-08-24):

```text
DeepSeek Harness
  → electronics-agent plugin
  → part_research
  → POST /v1/parts/research
  → electronics-agent-platform
  → PartResearchResult mpn=TPS54560DDAR
```

Evidence file: `tests/phase11/live-results.json` (`ok=true`, `viaHarness=true`, `toolsCalled=["part_research"]`).

## Package

`electronics-agent-plugin/`

| Path | Role |
|---|---|
| `manifest.json` | Name, tools, `/v1` endpoint, permissions (no DB, no secrets on disk) |
| `src/index.js` | Official `apply(ctx)` + `defineTool` |
| `tools/*/index.js` | HTTP adapters only |
| `skills/*.md` | User-invocable Harness skills |
| `cordis.patch.yml` | Profile bundle insert |
| `jsonrpc.cordis.yml` | Verification composition (not Platform Runtime) |

## Automated checks

`tests/phase11/*.test.mjs`

1. Plugin loads (`name=electronics-agent`, three tools).
2. Skills are `user-invocable` and forbid writing a business database.
3. Tools POST to a real Agent API process: part / csv import / company succeed.
4. Explicit errors: `unauthorized`, image → `vision_unavailable`, pdf → `ok:false` with reason.
5. Plugin composition does not load `@electronics/dsh-*`.

## Security

- Token: `ELECTRONICS_AGENT_PLATFORM_TOKEN` from the environment only.
- No Core / Radar / Workbench imports in the plugin.
- No `confirmImport` tool.

## Next

1. Install into a desktop profile: `dsh plugin --profile desktop add file:./electronics-agent-plugin` and use it without the verification `jsonrpc.cordis.yml`.
2. Point `AGENT_API_URL` at a long-running Platform (same host first).
3. Do not publish internal `dsh-*`. Do not add Supervisor / Multi-Agent. Do not change Contract 0.3.1.
