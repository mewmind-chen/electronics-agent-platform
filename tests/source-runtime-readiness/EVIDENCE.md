# Source Runtime Readiness Evidence

This directory records the post-v1.0 P1 boundary. Live tests are conditional
(`RUN_SOURCE_LIVE=1`) so CI never requires production credentials. The checked
in result file contains only redacted status metadata; no key, cookie, token,
credential prefix, length, or fingerprint is recorded.

## Contract checks

| Check | Result |
|---|---|
| Compose wires Platform-owned Firecrawl/AnySearch/ICNet/Mouser variables | covered by `credentials.test.mjs` |
| `/health` exposes safe readiness only | covered by `credentials.test.mjs` |
| Missing Firecrawl/AnySearch/ICNet semantics | covered by `source-status.test.mjs` |
| Parser failure is `DEGRADED`, not `EMPTY`/public zero | covered by `source-status.test.mjs` |
| `internalQuoteCount=0` is not public market zero | covered by `source-status.test.mjs` |
| Part and Company source traces | conditional live tests |
| Plugin has no silent generic intelligence fallback rule | static skill/prompt audit |

## Live command

```bash
RUN_SOURCE_LIVE=1 npm test -- tests/source-runtime-readiness/part-live.test.mjs tests/source-runtime-readiness/company-live.test.mjs
```

The live response is intentionally not copied into this repository. Use the
redacted `results.json` shape as the handoff artifact.
