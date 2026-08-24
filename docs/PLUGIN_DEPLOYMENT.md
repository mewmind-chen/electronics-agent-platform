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

## Market Source Credentials

Public research credentials are owned by the Platform container. The plugin
manifest, skills, and tool parameters contain none of these values:

| Variable | Used by | Required for default path |
|---|---|---|
| `FIRECRAWL_API_KEY` | LCSC, HQEW, GYS, shop, ST, Findchips scraping | Yes |
| `ANYSEARCH_API_KEY` | public Intel/AnySearch research | Yes for `intel` |
| `ICNET_COOKIE` | IC交易网 authenticated lookup | Optional |
| `MOUSER_API_KEY` | Mouser authorized API connector | Optional |

Inject them through the deployment host (or its secret store), not through the
Harness profile:

```bash
AGENT_API_TOKEN="$AGENT_API_TOKEN" \
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
OPENCODE_GO_API_KEY="$OPENCODE_GO_API_KEY" \
FIRECRAWL_API_KEY="$FIRECRAWL_API_KEY" \
ANYSEARCH_API_KEY="$ANYSEARCH_API_KEY" \
ICNET_COOKIE="$ICNET_COOKIE" \
MOUSER_API_KEY="$MOUSER_API_KEY" \
docker compose up --build -d
```

`GET /health` reports only `configured`, `ready`, and (for optional sources)
`optional`; it never reports a key, cookie, token, prefix, length, or
fingerprint. Readiness is configuration readiness, not a network probe. A
request-level `sourceRuntime.traces[]` records the actual source call, status,
URL, latency, result count, and a bounded degradation reason.

The source status contract is strict:

- `OK`: the source call succeeded and returned a result.
- `EMPTY`: the source call succeeded and explicitly returned no match.
- `AUTH_REQUIRED`: a key or login session is missing.
- `DEGRADED`: network/fetch/timeout/page or parser-health failure.
- `ERROR`: an unexpected program exception.

Parser failures are never represented as `EMPTY` with zero public offers. A
missing `ICNET_COOKIE` is `AUTH_REQUIRED`, not a public-market zero. Likewise,
`internalQuoteCount: 0` means only that this request carried no Radar/Workbench
quotation context; it is not a public offer count.

### Source readiness troubleshooting

1. `curl -fsS http://127.0.0.1:8787/health` and inspect `sources` without
   copying any secret into a report.
2. If `firecrawl.ready` is false, expect LCSC/HQEW/GYS/shop/ST/Findchips to
   return `AUTH_REQUIRED` until the host injects `FIRECRAWL_API_KEY`.
3. If `anysearch.ready` is false, the `intel` trace is `AUTH_REQUIRED`; it is
   not an empty public evidence set.
4. If an authenticated page fetches but its parser cannot validate the
   structure, the trace is `DEGRADED` and the report keeps the fact unknown.
5. Plugin skills must use the Platform result as the formal intelligence
   chain. Generic web search is allowed only when the user explicitly asks for
   separately labelled external supplemental research.

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
