# Phase 4 evidence

Collected 2026-08-24. Market Sources only. No Radar / Workbench edits.

## What landed

`packages/market-sources` (`@electronics/market-sources@0.4.0`)

| file | source |
|---|---|
| `src/md-parse.js` | Workbench `md-parse.ts` (LCSC/ST/HQEW/GYS/Shop) |
| `src/findchips.js` | Workbench `findchips.server.ts` parser |
| `src/icnet.js` | `parseIcnetHtml` only; cookie is an argument |
| `src/anysearch.js` | AnySearch client; key is `ctx.anysearchKey` |
| `src/firecrawl.js` | scrape; key is `ctx.firecrawlKey` |
| `src/authorized.js` | Mouser/DigiKey stubs; `auth_required` without key |
| `src/health.js` | parse-health |
| `src/lookup.js` | `runLookupStep(input, ctx)` |

Zero npm dependencies. No `@deepseek-ai/*`. No `dsh-part` / `dsh-company` package.

## Hard rules proven

- **No `let requestKey`**. Concurrent `scrapeMarkdown` with `key-A` / `key-B` sends the matching `Authorization` header.
- **No `/workspace/...` or `TodoApp-Mac` path probes** in `firecrawl.js`.
- Missing Firecrawl key → that request fails (`查询服务暂不可用`), not a global scramble.
- ICNet without `ctx.icnetCookie` → `auth_required`. Playwright singleton was **not** copied.

## Tests

```sh
node --test packages/market-sources/src/market-sources.test.js
# 7/7 pass

full suite (contracts + import-core + market-sources + phase1 + phase3)
# 27/27 pass
```

## Business repos

```text
xinghao-radar:           ## main...origin/main
huaqiangbei-workbench:   ## main...origin/main
```

## Not done (correct)

- Workbench UI still uses its own `live-lookup.server.ts`
- No Part / Company Skill yet (Phase 5–6)
- ICNet live browser session stays in the business app until Phase 5 wires a request-scoped fetcher
