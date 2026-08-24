# Phase 8.2 — Live Model Qualification & Provider Binding

Radar / Workbench unchanged. No Bundle / UI / Supervisor.

## Harness Provider Catalog (observed)

| providerId | source | auth | models used this phase |
|---|---|---|---|
| opencode-go | settings `llm-pi-ai.providers.opencode-go` | harness credential ref | deepseek-v4-flash, deepseek-v4-pro, qwen3.7-max, kimi-k3 |
| llm | settings `llm-pi-ai.providers.llm` → LiteLLM `http://127.0.0.1:4000/v1` | harness credential ref | free-fast, free-strong, free-long |
| grok | `dsh-plugin-subscriptions` | OAuth / X Premium | grok-4.6 |
| describe-image | plugin settings backend | plugin settings | glm-4v-flash |
| deepseek-official | `@deepseek-ai/dsh-llm-deepseek` | harness credential ref | present on default model plugin |
| modlens-opencode-go | `agent-default-model` | harness credential ref | alias of opencode-go flash |

Model Policy does not store API keys, OAuth tokens, or baseURLs. Router consumes `{providerId, model, availability, capabilities, verified}`.

## Live Capability Matrix

Path: Model Router identity → official `DeepSeekHarness.run` → skill hello → `hello_ping`.

| model | providerId | json | tools | long | harness | vision | pool |
|---|---|---|---|---|---|---|---|
| deepseek-v4-flash | opencode-go | pass | pass | pass | pass | n/a | **production** |
| free-fast | llm | pass | pass | fail* | pass | n/a | **production** |
| deepseek-v4-pro | opencode-go | pass | pass | pass | pass | n/a | **production** |
| qwen3.7-max | opencode-go | pass | pass | pass | pass | n/a | **production** |
| free-strong | llm | pass | pass | pass | pass | n/a | **production** |
| kimi-k3 | opencode-go | pass | pass | pass | pass | n/a | **production** |
| free-long | llm | pass | pass | pass | pass | n/a | **production** |
| grok-4.6 | grok | fail | fail | fail | fail | n/a | candidate |
| glm-4v-flash | describe-image | fail | fail | fail | fail | unknown | candidate |

\*free-fast Harness+JSON+tool passed; structured-long check is not required for the fast role.

## Failures (not auto-selected)

- **grok-4.6**: JSON-RPC runtime has no `grok` adapter. Desktop has `dsh-plugin-subscriptions` (OAuth). Adding the npm package to this runtime hit peer conflicts (`dsh-agent`). Recorded as `no adapter registered for provider "grok"` / incomplete smoke. Not production.
- **glm-4v-flash**: current `describe-image` backend, not a Harness agent model. Vision role therefore has **zero** production models.

Unverified rows stay `pool=candidate`, `verified=false`, capabilities unknown/fail. Router will not pick them.

## Actual fallback order (after live promotion)

- fast: deepseek-v4-flash → free-fast
- reasoning: deepseek-v4-pro → qwen3.7-max → free-strong
- long: kimi-k3 → free-long
- premium: none (grok candidate only)
- vision: none

## Escalation

- Part/Company: first reasoning result with `verdict.confidence=low`, missing evidenceId, or high+low trust conflict → premium. Caller need not send `lowConfidence`.
- Import: deterministic validator `qty_conflict` / `mpn_provenance` → reasoning. Never default premium.

## Tests

Platform suite includes `tests/phase82/qualification.test.mjs` plus existing mode/router tests.

## Still unverified as Harness agent models

- grok-4.6 (needs subscriptions adapter in this JSON-RPC composition)
- glm-4v-flash (plugin backend only)
