# Phase 9.3 — Business Context Integration

## 设计

```
User Request
  + context.inventory   (Radar snapshot, request-scoped)
  + context.quotation   (Workbench / Radar quotes, request-scoped)
  + context.customer    (reserved)
        ↓
parseBusinessContext
        ↓
Part Core (market-sources = external evidence)
        ↓
adviceFromContext      ← internal, tagged origin, not evidenceId
        ↓
composePartReport
  公开市场判断 / 内部业务判断 / 综合建议
```

Agent 不打开 Radar / Workbench 数据库。调用方把快照放进 `POST /v1/chat` 的 `context`。

## Context Contract

`packages/contracts/src/context.js`

| 字段 | 来源 | 进入 evidence[]？ |
|---|---|---|
| market-sources 结果 | 公开网 | 是，必须有 evidenceId |
| inventory | radar / caller | 否，标 origin |
| quotation | workbench / caller | 否，标 origin |
| customer | reserved | 否 |

规则：`CONTEXT_RULES` — 外部结论要 evidenceId；内部必须标记 source；二者禁止混写。

## 不改

Agent Request/Response 形状、Harness Runtime、Model Policy、Radar/Workbench 表结构。
