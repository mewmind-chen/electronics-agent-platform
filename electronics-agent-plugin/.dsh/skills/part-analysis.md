---
name: part-analysis
description: Analyze an electronics MPN. Extract the part number, call part_research, then show a business-readable report. Never write a database.
user-invocable: true
---

# Part analysis

## Goal

When the user asks to analyze a part such as `分析 TPS54560DDAR`, copy the MPN exactly and research it.

## Tools

| Tool | When |
|---|---|
| `part_research` | After the MPN is copied verbatim. |

## Steps

1. Extract the MPN. Trim and NFKC only. Do not autocomplete suffixes.
2. Call `part_research` with that MPN.
3. Keep every non-unknown claim tied to a real `evidenceId`.
4. Reply with the tool's business report (基础信息 / 公开市场判断 / 供应情况 / 价格趋势 / 内部业务判断 / 综合建议). Do not invent stock, price, or hotness.

## Evidence

Every non-unknown claim must keep a real `evidenceId`. Source failures are not evidence.

## Answer

给用户看业务可读报告。不要把完整 Tool JSON 贴进回复。

## Hard rules

1. Never write a business database. No INSERT, confirmImport, saveReport.
2. Never rewrite or autocomplete an MPN.
3. Radar owns inventory writes. Workbench owns official saved reports.
