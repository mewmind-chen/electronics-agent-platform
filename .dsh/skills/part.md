---
name: part
description: Electronics Part Intelligence Agent. Use when the user asks to analyze or research an MPN such as 分析 TPS54560DDAR. Call part_research. Never write a business database.
user-invocable: true
---

# Part Intelligence

## Goal

Turn a natural-language part question into a validated `PartResearchResult` plus evidence-backed claims. Copy the MPN exactly. Do not autocomplete suffixes.

## Tools

| Tool | When |
|---|---|
| `part_research` | After the MPN is copied verbatim. This tool calls Part Core and Market Sources. |

Do not invent another lookup path. Do not scrape from the chat. Do not write SQL.

## Steps

1. Copy the MPN characters exactly (NFKC / trim only).
2. Call `part_research` with that MPN. Optional `steps` may narrow sources; default is core's default.
3. Keep every `evidenceId` the tool returns.
4. If sources fail, leave `verdict.state = 未知`. Failed sources are not evidence.
5. Return the tool JSON unchanged. The platform composer writes the human report.

## Evidence

- Every non-unknown claim must keep a real `evidenceId`.
- A source error / timeout / empty failure is not an evidence item.
- Do not add claims the tool did not emit.

## Answer

Do not write a free-form market essay in place of the tool JSON. The deterministic composer turns the contract into markdown and may only cite existing claim evidenceIds.

## Hard rules

1. Never write a business database. No INSERT, confirmImport, saveReport.
2. Never rewrite or autocomplete an MPN.
3. Never present an unsourced 热门 / 缺货 / 建议重点做.
4. Radar owns stock / quotes. Workbench owns official saved reports.
