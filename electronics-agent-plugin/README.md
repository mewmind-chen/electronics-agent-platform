# Electronics Agent Plugin

User-side DeepSeek Harness plugin. **v0.1.0 Release Candidate.**

It is the **capability entry**, not the execution layer. It does not write a business database.

## 1. What it is

A DeepSeek Harness bundle that registers three HTTP tools and three user-invocable skills. Each tool POSTs a frozen Agent API contract on **electronics-agent-platform**.

This package is not Radar, Workbench, Domain Core, Model Policy, or the Platform Runtime. Internal `dsh-import` / `dsh-part` / `dsh-company` / `dsh-hello` stay inside the Platform process and are **not** published here.

## 2. Architecture

```text
DeepSeek Harness (user chat)
  → electronics-agent plugin (tools + skills + markdown presentation)
  → HTTP  AGENT_API_URL + Bearer ELECTRONICS_AGENT_PLATFORM_TOKEN
  → electronics-agent-platform  /v1/parts|import|companies
  → Platform Core
```

Presentation is markdown. Tool JSON is not shown to the user.

## 3. Requirements

- DeepSeek Harness CLI (`dsh`) and a profile (`desktop` or `headless`)
- A running electronics-agent-platform Agent API
- Environment (process env only; never stored in this package):

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_API_URL` | yes | Platform base URL, for example `http://127.0.0.1:8787` |
| `ELECTRONICS_AGENT_PLATFORM_TOKEN` | yes | Same value as Platform `AGENT_API_TOKEN` |

There is **no** default localhost URL. Missing URL → `configuration_error`. Missing token → `authentication_configuration_error`.

Peer: `@deepseek-ai/dsh-tools` (provided by Harness, marked optional so `dsh plugin add` does not try to fetch it). Plugin `package.json` does **not** pin a pnpm store or `packageManager`; Desktop/headless store mismatches are a Harness profile issue.

## 4. Install

From the directory that contains this folder (or any checkout of the plugin):

```bash
dsh plugin --profile desktop add file:./electronics-agent-plugin
```

`dsh plugin` forwards to `pnpm` in `~/.dsh/profiles/<name>`. The bundle patch inserts plugin id `electronics-agent` (package name, not a relative `./src` path).

Headless (one-shot CLI) uses the same add command with `--profile headless`.

Then export `AGENT_API_URL` and `ELECTRONICS_AGENT_PLATFORM_TOKEN` in the environment that boots `dsh`.

## 5. Configuration

Allowed sources: **process environment only**.

Forbidden:

- tokens in `manifest.json`, skills, tool arguments, logs, or git
- writing Authorization headers into error text (Bearer values are redacted)
- copying `~/.dsh/.credentials.yaml` into this package

Platform process uses `AGENT_API_TOKEN`. The plugin uses `ELECTRONICS_AGENT_PLATFORM_TOKEN`. Set them to the **same secret**. Do not commit either.

## 6. Usage examples

After Platform is up (`npm run api` in the platform repo, with `AGENT_API_TOKEN` set):

```bash
export AGENT_API_URL=http://127.0.0.1:8787
export ELECTRONICS_AGENT_PLATFORM_TOKEN="$AGENT_API_TOKEN"
```

In Harness chat (or `dsh --profile headless "…"`):

- `分析 TPS54560DDAR` → skill `part-analysis` → `part_research`
- Upload a quote image → skill `import-analysis` → `import_extract` with `sourceType=image`
- `分析供应商 TI` → skill `company-analysis` → `company_research`

## 7. Three tools

| Tool | HTTP | Notes |
|---|---|---|
| `part_research` | `POST /v1/parts/research` | MPN copied verbatim (trim / NFKC only) |
| `import_extract` | `POST /v1/import/extract` | Candidates only. No `confirmImport` |
| `company_research` | `POST /v1/companies/research` | Sourced facts; missing evidence stays unknown |

No `/v1/chat` tool. No Radar / Workbench / Vision-only tool. Image import is `import_extract` + `sourceType=image`.

## 8. Three skills

| Skill | When |
|---|---|
| `part-analysis` | User asks to analyze an MPN |
| `import-analysis` | User uploads BOM / quote (excel, csv, image, pdf, text) |
| `company-analysis` | User asks about a supplier / company |

All are `user-invocable: true`. They tell the model to write a business report and **not** paste full Tool JSON. They forbid writing a business database.

Skills register from `apply()` via `ctx.skills.register`, reading `skills/*.md` next to the package.

## 9. Error behavior

| Condition | Plugin `error` | User-visible |
|---|---|---|
| `AGENT_API_URL` unset | `configuration_error` | 调用失败, not a fake report |
| token unset | `authentication_configuration_error` | 调用失败 |
| bad token | `unauthorized` | explicit |
| image, no Platform Vision | `vision_unavailable` | 导入失败, **zero candidates**, no invented rows |
| PDF / Word (current Platform) | `agent_unavailable` (or equivalent `ok:false`) | 导入失败, no invented rows |

## 10. Security boundaries

- Network: Agent API only
- `permissions.database`: false
- `permissions.secretsOnDisk`: false
- No Domain Core / contracts / internal `dsh-*` imports
- Agent does not INSERT inventory, quotations, or official reports
- Radar owns inventory writes. Workbench owns saved reports. Plugin does not connect to either in v0.1.0

## 11. Known limitations

- **Image import** depends on Platform Vision being available. If Platform returns `vision_unavailable`, the plugin shows that failure and does not OCR locally.
- **PDF / Word** remain Platform `agent_unavailable` (Long Import is out of scope). Report the error; do not invent rows.
- **Desktop `pnpm` store**: `dsh plugin add` uses whatever `pnpm` is on PATH. If the Desktop profile was installed with pnpm store `v11` and PATH has pnpm 10, add fails with `ERR_PNPM_UNEXPECTED_STORE`. That is a Harness/Desktop environment issue. Workaround: run the same `dsh plugin add` with a pnpm major that matches the profile store. Do not put store paths into this plugin.
- **Credentials CLI vs GUI**: GUI-managed `~/.dsh/.credentials.yaml` may include `version` / `refs`. Current `dsh-credentials-local` wants a flat `KEY: string` map. A raw `dsh --profile desktop` boot can fail **after** this plugin has already applied. That is Harness CLI compatibility, not a plugin defect. Do not copy credentials into this repo. Optional local `--patch` to a flattened file is an operator workaround only.
- Desktop default model (for example `grok`) may have no adapter in headless. Select a model the profile actually has (for example `deepseek-official` / `deepseek-v4-flash`).
- A full Desktop profile may include extra search plugins. After a successful
  Platform research tool call they are not part of the formal intelligence
  chain; use them only for an explicitly requested, separately labelled
  `External Supplemental Research` section.

## 12. Uninstall / reinstall

```bash
dsh plugin --profile desktop remove electronics-agent
dsh plugin --profile desktop add file:./electronics-agent-plugin
```

`remove` drops the dependency and bundle layer. `add` must succeed again without leftover source from this package (Harness still owns the profile `node_modules`).

Verify:

```bash
dsh --profile desktop --dump-config | grep electronics-agent
```

Expect an `id: electronics-agent` row after install, and none after remove.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| `configuration_error` | `AGENT_API_URL` exported in the **dsh process** env |
| `authentication_configuration_error` | `ELECTRONICS_AGENT_PLATFORM_TOKEN` set |
| `unauthorized` | Token equals Platform `AGENT_API_TOKEN` |
| `ERR_PNPM_UNEXPECTED_STORE` | pnpm major vs Desktop profile store; see Known limitations |
| `credentials-local: … must be a string` | GUI credentials document vs CLI parser; see Known limitations |
| `NO_ADAPTER: grok` | Profile default model; pick a provider that is installed |
| `vision_unavailable` | Platform Vision pool, not a missing plugin tool |
| Plugin not in dump-config | `dsh.profile.bundles` should list `electronics-agent` after add |

`jsonrpc.cordis.yml` and `scripts/live-harness.mjs` in the git checkout are **developer verification only**. They are not part of the installed RC tarball.
