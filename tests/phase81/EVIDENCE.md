# Phase 8.1 — Model Policy & Router

Framework-neutral package: `packages/model-policy`.
No `@deepseek-ai/*`. No API keys in results or logs.

## Model Registry (production pool)

| id | provider | model | roles | quality | priority | credentialEnv | live smoke |
|---|---|---|---|---|---|---|---|
| opencode-go/deepseek-v4-flash | opencode-go | deepseek-v4-flash | fast | economy | 10 | OPENCODE_GO_API_KEY | **unverified** |
| opencode-go/deepseek-v4-pro | opencode-go | deepseek-v4-pro | reasoning | standard | 10 | OPENCODE_GO_API_KEY | **unverified** |
| opencode-go/qwen3.7-max | opencode-go | qwen3.7-max | reasoning | standard | 20 | OPENCODE_GO_API_KEY | **unverified** |
| opencode-go/kimi-k3 | opencode-go | kimi-k3 | long | standard | 10 | OPENCODE_GO_API_KEY | **unverified** |
| zai/glm-4v-flash | zai | GLM-4V-flash | vision | economy | 10 | ZAI_API_KEY | **unverified** |
| xai/grok-4.6 | xai | grok-4.6 | premium | quality | 10 | XAI_API_KEY | **unverified** |
| economy/free-fast | economy | free-fast | fast | economy | 90 | ECONOMY_FAST_KEY | **unverified** |
| economy/free-strong | economy | free-strong | reasoning | economy | 90 | ECONOMY_STRONG_KEY | **unverified** |
| economy/free-long | economy | free-long | long | economy | 90 | ECONOMY_LONG_KEY | **unverified** |

Declared capability smoke for production rows: JSON / Tool Calling / structured long / Harness = pass. Vision only on GLM-4V-flash. No live provider call was made this phase.

## Capability Matrix (required by role)

| role | json | toolCalling | structuredLong | harness | vision |
|---|---|---|---|---|---|
| fast | required | required | | required | |
| reasoning | required | required | required | required | |
| vision | required | required | | required | required |
| long | required | required | required | required | |
| premium | required | required | required | required | |

A model missing any required `pass` is excluded, even if it is in the registry.

## Routing rules

1. Infer role from the task, never randomly:
   - import text / unknown table → `fast`
   - import image → `vision`
   - import pdf/word / long BOM → `long`
   - part / company → `reasoning`
   - low confidence / conflicting evidence / `escalate` → `premium`
2. Filter: production + verified + healthy + capability + quality + credential env present (value never read into the result).
3. Sort: lower `priority` first, then stable `id`.
4. `modelMode=auto` uses that list. `fixed` requires exact provider/model. `selected` returns `selected_not_bound` (contract only).
5. 429 / timeout / provider unavailable → next priority. Non-retryable errors stop.
6. premium only via premium role (escalation). `quality=quality` does not by itself promote a reasoning task to grok.

## Execution vs Model layers

- `mode=core` never calls the router, never starts Harness.
- `mode=auto` asks `isAgentAvailable()` / Router; no model → core fallback.
- `mode=agent` and Router finds nothing → `agent_unavailable`, no core/stub.

`runtime.js` still does not read `DEEPSEEK_API_KEY`. Availability is “Router resolved a model + process ready”.

## Tests

Platform suite **60/60**. New: `packages/model-policy/src/model-policy.test.js`, `tests/phase8/model-policy.test.mjs`.

Radar / Workbench: not modified.

## Still unverified live

Every production model above. This phase only declared capability and routed deterministically. No real opencode-go / zai / xai / economy call was executed.
