# Phase 2 evidence

Collected 2026-08-24. Contracts only. No business migration.

## Package

`packages/contracts` (`@electronics/contracts@0.2.0`)

| file | exports |
|---|---|
| `src/import.js` | ImportRequest / ImportCandidate / Mapping / Warning |
| `src/part.js` | PartResearchRequest / PartResearchResult |
| `src/company.js` | CompanyResearchRequest / CompanyResearchResult |
| `src/evidence.js` | Claim / EvidenceItem / Verdict |
| `src/task.js` | TaskHandle / TaskEvent / TaskStatus |

Zero npm dependencies. No `@deepseek-ai/*`. No SQL.

## Tests

```sh
node --test packages/contracts/src/contracts.test.js
# 11/11 pass
```

Covered:

- Radar-shaped import row accepted without `duplicate` / `selected`
- preview flags and `INSERT` rejected
- MPN rewrite (`STM32F103` → `STM32F103C8T6`) rejected; NFKC/trim allowed
- Excel mapping must include `mpn`
- part verdict claims must cite existing evidence
- unknown verdict may have zero claims
- company brand claims must cite existing evidence
- task create typed; SQL text rejected

`GET /health` now reports `phase: 2` and `contractVersion`.

## Business repos

```text
xinghao-radar:           ## main...origin/main
huaqiangbei-workbench:   ## main...origin/main
```

## Not done (correct)

- no Import Pipeline V2
- no market-sources extract
- no `/v1/import/extract` or `/v1/parts/research` implementation
