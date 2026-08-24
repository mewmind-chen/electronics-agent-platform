# Plugin deployment and business-live evidence

Run date: 2026-08-25 (Asia/Shanghai)

This is a redacted evidence index. Secrets, bearer values, cookies, and raw credentials are intentionally excluded.

## Release baseline

| Repository | Branch | Commit | Working tree before this acceptance change |
|---|---|---|---|
| Platform | `main` | `4c14d84` | deployment hardening and evidence committed |
| Radar | `main` | `6b806f5496b0fafa043da84ca738692d470cbd69` | clean |
| Workbench | `main` | `1f2c79b848d650467e1e93e11b993d0189711c4c` | clean |

## Package and profile

- `npm pack` produced `electronics-agent-0.1.0.tgz` with 13 runtime files.
- Persistent package: `~/.dsh/packages/electronics-agent-0.1.0.tgz`.
- SHA-256: `318ea52dd29eaf52912e00f0ffd3996ef37515e05b7045925436af01c5c1aad9`.
- Official install command completed: `dsh plugin --profile desktop add <persistent tgz>`.
- Desktop profile dependency resolves to the persistent tgz, package version `0.1.0`.
- `dsh --profile desktop --dump-config` contains `electronics-agent`.
- `dsh plugin --profile desktop list` contains `electronics-agent 0.1.0`.

## Platform runtime

- Clean Platform test suite: **160 passed, 0 failed**.
- Clean Alpine image build: **passed**.
- Native runtime checks inside the image: `sharp`, `koffi`, and `node-pty` all load; `node-pty` is rebuilt from source for musl.
- Compose restart: **passed**; `GET /health` returned `ok=true`, `agent.available=true`, and the expected routes.
- Post-restart Part request: `POST /v1/parts/research` returned HTTP 200, `ok=true`, `route=harness`, `viaHarness=true`, and the exact MPN `TPS54560DDAR`.

## Plugin/API scenarios

| Scenario | Evidence | Result |
|---|---|---|
| Part `TPS54560DDAR` | plugin tool call + Platform HTTP 200; business renderer, no raw JSON | passed |
| Company `TI` | plugin tool + Platform HTTP 200; evidence-bounded result | passed |
| Text import | Platform HTTP 200; one validated candidate; no write flag | passed |
| Image import | Platform HTTP 422 `vision_unavailable`; zero candidates; no fabricated MPN | passed by explicit-failure contract |
| Unauthorized/configuration guard | plugin tests cover explicit errors; no localhost fallback | passed |

## Radar and Workbench gates

- Radar `npm test`: **232 passed, 0 failed**; `npm run typecheck`: passed; `npm run build:dev`: passed.
- Workbench `npm test`: **38 passed, 0 failed**; `npm run typecheck`: passed; `npm run build`: passed.
- Workbench dev process was started with `AGENT_API_URL` and `ELECTRONICS_AGENT_PLATFORM_TOKEN` set; `/api/agent/health` responded with the expected local route contract.

## Remaining release gate

The API and package chain are healthy. The final Freeze gate still requires a fresh human-visible Desktop P2 Company run and the corresponding screenshot/session evidence in the same clean profile. Until that last GUI row is captured, do **not** create or push `v1.0`.
