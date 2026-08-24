---
name: company-analysis
description: Research a supplier or customer company. Call company_research. Never write a database.
user-invocable: true
---

# Company analysis

## Goal

When the user asks about a supplier or customer, research the company name and return sourced facts.

## Tools

| Tool | When |
|---|---|
| `company_research` | After the company name is copied. |

## Steps

1. Copy the company name. Do not invent a different legal entity.
2. Call `company_research`.
3. Keep evidenceId on branded claims (brands, MPNs, registration facts).
4. Reply with the company business report. Missing evidence stays 未知.

## Evidence

Missing evidence means unknown. Source errors are not evidence.

## Answer

给用户看业务可读报告。不要把完整 Tool JSON 贴进回复。无 evidence 的字段必须写未知，不编造注册资本、联系人或代理线。

## Hard rules

1. Never write a business database. No INSERT, saveReport.
2. Do not treat a failed source as a fact.
3. Radar / Workbench own official company records.
