# electronics-agent-platform

Independent Agent Platform for electronics-trade capabilities shared by
`xinghao-radar` and `huaqiangbei-workbench`.

> **领域核心不属于 Harness。**
> Harness 只是 Agent Runtime Adapter。
> 业务系统只调用稳定 Agent API。
> Phase 1 的产品是通道，不是电子元器件能力。
> Phase 2 的产品是 contracts，还不是业务 Tool。
> Phase 3 的产品是 Import Pipeline V2：Candidate only，不写库。
> Phase 4 的产品是 Market Sources：request-scoped 连接器，不是 Plugin。

## Current phase

Phase 9.4 connects the two business systems through request-scoped Context
Providers. Radar and Workbench aggregate their own business facts and inject a
minimal `context` document into the stable Agent API. The platform never calls
back into either business database, and internal context never becomes public
Evidence.

## Phase 1 scope

Prove the official DeepSeek Harness path:

1. Official Cordis plugin (`apply(ctx)` + `defineTool` `hello_ping`)
2. Official Skill (`.dsh/skills/hello.md`)
3. Official SDK / JSON-RPC (`@deepseek-ai/dsh-sdk-client` + `dsh-jsonrpc-agent`)
4. `POST /v1/hello`

This repository must **not** contain `heuristicParse`, a homemade
`/chat/completions` agent loop, or any Radar / Workbench business modules.

Phase 3 adds Import Pipeline V2. Do not start `market-sources` / part / company
until extract returns `ImportCandidate[]` without writing a business database.

## Layout

```text
packages/contracts/          Import / Part / Company / Evidence / Task
packages/electronics-domain/ qty / price / mpn / warehouse parsers
packages/import-core/        readers + validators + mapping executor
packages/market-sources/     LCSC/ST/HQEW/GYS/Shop/ICNet/Findchips/AnySearch
packages/dsh-import/         official import tools
packages/dsh-hello/          official Hello plugin + tool
.dsh/skills/import.md        official Import skill
.dsh/skills/hello.md         official Hello skill
runtime/                     official JSON-RPC composition
apps/agent-api/              POST /v1/hello and POST /v1/import/extract
```

## Commands

```bash
npm install
npm run overlays          # write absolute paths into runtime/hello.cordis.yml
npm run dump-config       # official dsh headless + hello plugin
npm run api               # listen on 127.0.0.1:8787
npm test                  # contracts + phase1 health/dump tests
```

`dump-config` uses the machine `dsh` CLI (`@deepseek-ai/dsh`) and the
`headless` profile plus `--patch`. It does not start `dsh web` as a business
API.

`POST /v1/hello` launches `dsh-jsonrpc-agent` with `runtime/jsonrpc.cordis.yml`
through `@deepseek-ai/dsh-sdk-client`. It never scrapes the Web UI and never
calls `https://api.deepseek.com` from Agent API code.

## Credentials

Do not edit `~/.dsh/.credentials.yaml` (Desktop format).

For a live model turn (`/v1/hello`, headless prompt) export:

```bash
export DEEPSEEK_API_KEY=...
```

Optional: `DSH_MODEL` (default `deepseek-chat`).

Session logs for the JSON-RPC runtime go to `.dsh-platform/sessions/` (gitignored).
