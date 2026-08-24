# Phase 1 evidence

Collected 2026-08-24. No secrets. Two business repos were not modified.

## dsh version

```text
0.1.0-rc.6
```

CLI: `/opt/homebrew/bin/dsh` → `@deepseek-ai/dsh`.

## Official packages locked in this repo

| package | version | role |
|---|---|---|
| `@deepseek-ai/dsh-tools` | 0.1.1-rc.2 | `defineTool` |
| `@deepseek-ai/dsh-sdk-client` | 0.1.1-rc.2 | TS JSON-RPC client |
| `@deepseek-ai/dsh-sdk-jsonrpc-demo` | 0.1.1-rc.2 | `dsh-jsonrpc-agent` bin |
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | 0.1.1-rc.2 | official stdio JSON-RPC plugin |

## dump-config excerpt (hello plugin id/name)

Command:

```sh
dsh --profile headless --patch ./runtime/hello.cordis.yml --dump-config
```

Exit 0. Tail of composed tree:

```yaml
# == /Users/ylf/Documents/ChatGPT/工作台研究/electronics-agent-platform/runtime/hello.cordis.yml
- id: electronics-hello
  name: >-
    /Users/ylf/Documents/ChatGPT/工作台研究/electronics-agent-platform/packages/dsh-hello/src/index.js
```

Negative checks: dump does not contain `serverName: hqb` or `runImportAgent`.

Automated: `node --test tests/phase1/plugin-loads.test.mjs` **pass**.

## Official JSON-RPC process load

```sh
node runtime/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js runtime/jsonrpc.cordis.yml
```

stderr:

```text
[electronics-hello] plugin loaded
```

stdout stayed empty until a client spoke JSON-RPC (protocol purity).

## sdk/jsonrpc command + output

`apps/agent-api/src/runtime.js` launches:

```text
node <dsh-sdk-jsonrpc-demo/lib/bin.js> runtime/jsonrpc.cordis.yml
```

via `new DeepSeekHarness({ launch: { command, args }, ... }).run(...)`.

Direct adapter call `ping("phase1")` returned:

```json
{"ok":true,"token":"phase1","runtime":"deepseek-harness","plugin":"electronics-hello"}
```

Session JSONL (ids only):

- `hello-1787539936864` — hits: `hello_ping`, `electronics-hello`, `skill_content`, `"name":"hello"`
- `hello-1787539960059` — same hits

That is the official Skill tool loading `.dsh/skills/hello.md` and the official Tool `hello_ping`.

## curl /v1/hello output

```sh
curl -sS http://127.0.0.1:18788/health
# {"ok":true,"service":"electronics-agent-api","phase":1,"routes":["/v1/hello"]}

curl -sS http://127.0.0.1:18788/v1/hello \
  -H 'content-type: application/json' \
  -d '{"token":"phase1"}'
# {"ok":true,"token":"phase1","runtime":"deepseek-harness","plugin":"electronics-hello"}
```

Automated health: `node --test tests/phase1/hello-api.test.mjs` **pass**.

## git status of business repos

```text
xinghao-radar:              ## main...origin/main
huaqiangbei-workbench:      ## main...origin/main
```

Zero diffs.

## What Phase 1 did **not** do

- No `heuristicParse` / `OpenAICompatibleProvider` / homemade `/chat/completions` runtime
- No Import / Part / Company migration
- No Workbench MCP `hqb` overlay as the product path
- Desktop `~/.dsh/.credentials.yaml` was not rewritten
