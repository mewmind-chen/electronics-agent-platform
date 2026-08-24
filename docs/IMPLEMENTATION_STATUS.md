# Electronics Agent Platform — implementation status

This file is the durable delivery ledger for the original final implementation
plan. A phase is complete only when code, automated evidence, deployment
instructions, and the business-system fallback path all exist.

## North star

> 把 Radar 和 Workbench 中容易变化、无法穷举的业务理解从硬编码里解放出来，形成可插拔、可复用的智能能力；同时把事实、约束、写库和最终决定牢牢留在业务系统与人手里。

Every change must be classified before it is accepted:

| Concern | Owner | Hard boundary |
|---|---|---|
| Ambiguous input, semantic mapping, research orchestration | replaceable Agent Skill / capability plugin | may return candidates, evidence and recommendations only |
| MPN, quantity, price, currency, evidence linkage and context schema | framework-neutral deterministic core | model output is always revalidated |
| Inventory, quotation, customer and formal report facts | Radar or Workbench | Platform receives only request-scoped minimum snapshots |
| Database writes and state transitions | Radar or Workbench service layer | Agent Platform never receives business DB credentials |
| High-risk acceptance, import confirmation and final commercial decision | human user | advice must remain reviewable and reversible |

An expanding semantic `if/else` or regex tree is a design warning. Stable
validation branches are allowed; volatile business interpretation must expose a
replaceable capability boundary and versioned evaluation evidence.

## Original acceptance ledger

| Original acceptance item | Status | Evidence / remaining gate |
|---|---|---|
| Official DeepSeek Harness is actually executed | complete | `tests/phase1`, `tests/phase8` |
| Agent API and Runtime are decoupled | complete | `apps/agent-api/src/runtime.js`, execution-mode tests |
| Radar has no Harness-internal dependency | complete | Radar Agent API boundary tests |
| Workbench has no Harness-internal dependency | complete | Workbench Agent API boundary tests |
| Import returns Candidate and never writes DB | complete | contracts + Phase 3 tests |
| Part claims cite Evidence | complete | contracts + Part Eval |
| Company result contains source and confidence | complete | company core + research API tests |
| Market Sources are business-project neutral | complete | Phase 4 request-scoped connector tests |
| Credentials have no module-global mutable state | complete | concurrent request-key tests |
| Platform failure preserves both business cores | complete | Radar/Workbench fallback tests + authenticated deployment smoke |
| Harness is replaceable without changing callers | complete | stable HTTP contracts + core/agent execution modes |
| Real business Eval corpus exists | partial | Import 30, Part 21 and Company 22 are versioned; correction records remain |
| AI may not autocomplete or rewrite MPN | complete | contract/domain/import eval gates |
| High-risk results require human confirmation | partial | write ownership is correct; explicit review/correction records remain |

## Delivery queue

1. Production API boundary: authorization, contract validation, credential
   separation and observable fallback.
2. Deployable service baseline and cross-repository smoke.
3. Durable task state, SSE, idempotency, limits, deadlines and observability.
4. Versioned 30 Import / 20 Part / 20 Company evaluation corpus and human
   accept/reject correction records.
5. Qualified long-document and vision import paths.

The queue deliberately excludes Supervisor, autonomous database writes and
automatic commercial decisions.
