---
name: import-analysis
description: Convert a BOM, quote sheet, Excel, image, or PDF into ImportCandidate rows. Wait for a human to confirm. Never write a database.
user-invocable: true
---

# Import analysis

## Goal

When the user uploads a BOM or quotation (Excel, CSV, image, or PDF), extract candidate rows only.

## Tools

| Tool | When |
|---|---|
| `import_extract` | Always. Pass `sourceType` plus `text` or `fileBase64`. Image quotes use `sourceType=image`. |

## Steps

1. Call `import_extract` with the file or pasted text. Use `sourceType`: `excel`, `csv`, `image`, `pdf`, `word`, or `text`.
2. Keep MPN characters exact. Keep qty, dateCode, and price in separate fields.
3. If the platform returns `vision_unavailable`, tell the user that code and that zero candidates were produced. Never invent rows.
4. Wait for a human to confirm in the business system. Do not import.

## Evidence

Candidates are proposals. Empty candidates must keep the platform `error` (for example `vision_unavailable` or `agent_unavailable`).

## Answer

给用户看业务可读的候选表和待确认说明。不要把完整 Tool JSON 贴进回复。失败时明确写出 `vision_unavailable`，禁止伪造识别结果。

## Hard rules

1. Never write a business database. Never call confirmImport.
2. Never return `selected` or `duplicate`.
3. Never autocomplete an MPN.
4. PDF / Word may be unavailable; report the error instead of inventing rows.
