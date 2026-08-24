# Phase 9.4 — Business Context Providers

## 目标

让 Radar 与 Workbench 真正接入 Phase 9.3 的 Business Context Contract，
同时保持数据所有权与 Runtime 边界不变。

```text
Radar DB                         Workbench DB
   ↓ read-only provider             ↓ read-only provider
inventory + inquiry aggregate    quotation aggregate
   └───────────────┬─────────────────┘
                   ↓ request.context
             Stable Agent API
                   ↓
        public research / Evidence
                   ↓
  deterministic internal-context attachment
                   ↓
         business-system UI / report
```

## Provider 边界

Provider 属于业务系统，不属于 Agent Platform：

- Radar 精确按 MPN 聚合在手、在途、仓库摘要和有效询价数量。
- Workbench 精确按 MPN 聚合未完成询价、近 90 天询价和最后更新时间。
- Provider 不发送客户名、报价内容、成本、批次、渠道或业务表主键。
- 业务系统主动调用现有 `/v1/parts/research`；平台不回调业务系统，也不持有业务数据库凭据。

允许的请求形状：

```json
{
  "mpn": "TPS54560DDAR",
  "mode": "auto",
  "context": {
    "inventory": {
      "source": "radar",
      "onHand": 8000,
      "inTransit": 0,
      "warehouse": "SZ 8000"
    },
    "quotation": {
      "source": "workbench",
      "openCount": 4,
      "recentCount": 4,
      "lastQuotedAt": "2026-08-24T08:00:00.000Z"
    }
  }
}
```

每个业务入口只发送自己拥有的字段；上例用于说明合并后的 Contract，不要求
Radar 读取 Workbench，也不要求 Workbench 读取 Radar。

## Agent / Evidence 边界

公开研究先完成，随后平台用确定性代码附加内部 Context 与 Advice：

1. 不修改 `evidence[]`、`verdict` 或 `claim.evidenceId`。
2. 内部数据只进入 `businessContext`、`advice` 与业务建议。
3. 首次 Agent 结果、升级模型结果和 Core fallback 使用同一边界。
4. 正式保存仍由 Radar / Workbench 自己完成。

## 本阶段不做

- 不新增平台到业务系统的 HTTP 回调。
- 不让 Harness Tool 读取 Radar / Workbench 数据库。
- 不扩 Company Context、Supervisor、Multi-Agent 或 Event Bus。
- 不修改 `confirmImport`、Cross Match 或业务写库路径。
- 不把内部 Context 伪装成公开 Evidence。

## 验收

- 同一 MPN 无 Context 时只给公开市场判断。
- Radar 入口返回并显示库存/询价驱动的内部业务建议。
- Workbench 入口返回并保存询价驱动的内部业务建议。
- Agent/Harness 路径与 Core 路径都保留 Context。
- Context payload 不包含业务明细，Evidence 不包含 `radar` / `workbench` 内部来源。
