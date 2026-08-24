# Phase 8.3 — Electronics Business Capability Qualification

Radar / Workbench unchanged. No Bundle / UI / Supervisor. No new models.

Live path: Model Router identity → official DeepSeekHarness → Import / Part / Company Skill → dsh-* Tool → contract acceptors.

`hello_ping` is no longer enough for production auto-select. Production now requires `verified` + harness capability + `businessQualified` for the role.

## Business Capability Matrix

| model | providerId | skills run | tools observed | import | part | company | structuredLong | pool |
|---|---|---|---|---|---|---|---|---|
| deepseek-v4-flash | opencode-go | import | `import_*` | **pass** | unknown | unknown | n/a for fast | **production** |
| free-fast | llm | import | `import_*` | **fail** (no TPS54560DDAR candidate) | unknown | unknown | n/a | candidate |
| deepseek-v4-pro | opencode-go | part, company | `part_research`, `company_research` | unknown | **pass** | **pass** | n/a | **production** |
| qwen3.7-max | opencode-go | part, company | `part_research`, `company_research` | unknown | **pass** | **pass** | n/a | **production** |
| free-strong | llm | part, company | `part_research`, `company_research` | unknown | **pass** | **pass** | n/a | **production** |
| kimi-k3 | opencode-go | long import | none | **fail** | unknown | unknown | **fail** (timeout, 0 rows) | candidate |
| free-long | llm | long import | none | **fail** | unknown | unknown | **fail** (timeout, 0 rows) | candidate |
| grok-4.6 | grok | none this phase | — | unknown | unknown | unknown | fail | candidate |
| glm-4v-flash | describe-image | none | — | unknown | unknown | unknown | fail | candidate |

## Failures

- **free-fast**: Harness + import tools ran; extracted JSON did not contain `TPS54560DDAR` with qty=10000 / DC=2418 / $1.15. Not business-qualified for import.
- **kimi-k3 / free-long**: 180s Harness timeout on the 10-row BOM. `structuredLong=fail`. Not judged by `finalResponse.length`.
- **grok-4.6**: still no grok adapter in this JSON-RPC composition.
- **glm-4v-flash**: still a describe-image backend, not a Harness agent model. Vision requests return `vision_unavailable`.

## Runtime degrade

- Premium escalation with no production premium model keeps the first reasoning result and sets `premiumReviewUnavailable: true`.
- Image import with no vision model returns `error: vision_unavailable` and does not fake candidates.

## structuredLong consistency

Phase 8.2 EVIDENCE claimed free-fast structuredLong was not required / mixed. Live file no longer treats `finalResponse.length >= 20` as structuredLong. Long role is fail until a long BOM import actually returns ≥8 contract rows.

## Tests

Acceptors cover the TPS54560DDAR regression, field-swap rejection, long-row completeness, and claim/evidence coupling. Router production selection now requires `businessQualified`.
