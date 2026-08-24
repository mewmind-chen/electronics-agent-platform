# Electronics Agent Plugin deployment

This document is the runbook for the release shape accepted by the business-live handoff:

```text
DeepSeek Harness/Desktop
  -> electronics-agent (official npm plugin package)
  -> HTTP Platform (electronics-agent-platform)
  -> read-only Import / Part / Company contracts

Radar and Workbench
  -> the same Platform URL and token
```

The plugin supplies changing business understanding as skills and tools. Facts, evidence, validation, database writes, and final decisions remain in Platform, Radar, Workbench, and the human review path.

## Build and install

From `electronics-agent-platform`:

```bash
tmp=$(mktemp -d)
npm pack --pack-destination "$tmp"
mkdir -p "$HOME/.dsh/packages"
cp "$tmp"/electronics-agent-*.tgz "$HOME/.dsh/packages/electronics-agent-0.1.0.tgz"
dsh plugin --profile desktop add "$HOME/.dsh/packages/electronics-agent-0.1.0.tgz"
```

The package contains only the runtime plugin surface: manifest, Cordis patch, tools, presentation, and skills. It does not contain Platform source, Core, tests, workspace data, or credentials. Verify with:

```bash
dsh plugin --profile desktop list
dsh --profile desktop --dump-config
```

The official profile must be able to boot with the installed credential provider. The current DSH release expects a flat credential mapping; the desktop profile uses the local compatibility path to the existing flat credential document. No key is stored in this repository or in the plugin package.

## Runtime configuration

The plugin reads only these connection variables:

```text
AGENT_API_URL=http://127.0.0.1:8787
ELECTRONICS_AGENT_PLATFORM_TOKEN=<secret>
```

Platform model credentials are deployment secrets (`DEEPSEEK_API_KEY` and `OPENCODE_GO_API_KEY`) and are injected into the Platform process only. Radar and Workbench use the same `AGENT_API_URL` and token; their own inbound credentials are separate.

## Start Platform

Use the repository deployment contract, not a development stub:

```bash
AGENT_API_TOKEN="$AGENT_API_TOKEN" \
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
OPENCODE_GO_API_KEY="$OPENCODE_GO_API_KEY" \
docker compose up --build -d
curl -fsS http://127.0.0.1:8787/health
```

The image installs optional dependencies and rebuilds `node-pty` from source for Alpine/musl. This is required for the official sandbox, attachment-local, and subprocess modules to load after a clean image build.

## Verification order

1. `GET /health` is healthy and reports the expected routes.
2. `POST /v1/parts/research` with `TPS54560DDAR` returns a Harness-routed, evidence-bounded report.
3. `POST /v1/companies/research` with `TI` returns a report or an explicit unknown state.
4. Text import returns validated candidates without writing a business database.
5. Image import succeeds only when a qualified vision model exists; otherwise it returns `vision_unavailable` with zero candidates and no fabricated rows.
6. Load the installed package in the official desktop profile and confirm the three tools are registered.
7. Restart the Compose service and repeat health plus one real Part request.
8. Run Radar and Workbench typecheck/build/test gates against their `main` commits.

Do not use `ELECTRONICS_IGNORE_LIVE`, Harness stubs, fake API responses, or raw JSON as a release acceptance substitute.

## Release gate

Release Freeze and `v1.0` are allowed only after the evidence file reports all required GUI and API scenarios as passed. An explicit `vision_unavailable` is acceptable for the image scenario; a configuration error, unauthorized request, fabricated candidate, missing report rendering, or stale profile load is not.
