---
name: part
description: Electronics Part Intelligence Agent. Use when the user asks to analyze or research an MPN such as 分析 TPS54560DDAR. Follow the seven-step SOP. Call part_research. Never write a business database.
user-invocable: true
---

# Part Intelligence

## Goal

分析一颗电子元器件型号：确认身份、供应、市场，交叉验证后给出带 Evidence 的业务报告。Copy MPN exactly. Do not autocomplete suffixes.

## Tools

| Tool | When |
|---|---|
| `part_research` | After the MPN is copied verbatim. The tool runs Part Core + Market Sources for identity, supply, and market steps. |

Do not invent another lookup path. Do not scrape from the chat. Do not write SQL.

## Steps

### Step 1 — MPN 规范化

- trim
- NFKC
- 不补全
- 不猜型号

### Step 2 — 型号身份确认

Call `part_research` so Core can fetch manufacturer / package / category / basic specs (typically LCSC / ST).

### Step 3 — 供应分析

The same tool collects distributor / stock / supplier count (typically HQEW / Findchips). Do not invent stock numbers.

### Step 4 — 市场分析

Use Core market cards: demand signal, availability, price trend. No snapshot → do not claim 涨价.

### Step 5 — 交叉验证

Different sources must confirm. If evidence is thin: `verdict.state = 未知`.

### Step 6 — Evidence 整理

Keep every `evidenceId`. Failed / timed-out sources are not evidence.

### Step 7 — 生成业务报告

Return the tool JSON unchanged. The deterministic composer writes 基础信息 / 市场判断 / 供应情况 / 价格趋势 / 业务建议.

## Evidence

- Every non-unknown claim must keep a real `evidenceId`.
- A source error / timeout / empty failure is not an evidence item.
- Do not add claims the tool did not emit.

## Answer

Do not write a free-form market essay in place of the tool JSON. The composer may only cite existing claim evidenceIds.

## Hard rules

1. Never write a business database. No INSERT, confirmImport, saveReport.
2. Never rewrite or autocomplete an MPN.
3. Never present an unsourced 热门 / 缺货 / 建议重点做.
4. Radar owns stock / quotes. Workbench owns official saved reports.
