# Phase 9.4 Evidence

## 交付

- Platform：Agent/Harness 公开研究完成后，以确定性后处理附加 Business Context。
- Radar：新增只读 Context Provider，向 `/v1/parts/research` 注入库存、在途和有效询价聚合。
- Workbench：新增只读 Context Provider，向 `/v1/parts/research` 注入未完成与近 90 天询价聚合。
- 两个业务界面均显示“内部业务建议”，正式落库仍由业务系统负责。

## 边界证明

- Platform 不读取或回调 Radar / Workbench 数据库。
- Context Provider 只发送白名单聚合字段。
- Agent 后处理不修改公开 `evidence[]`、`verdict` 或 `claims`。
- 内部来源不进入 `evidence[]`。
- Radar 的 `confirmImport` / Cross Match 与 Workbench 的正式报告保存路径未改。

## 验证

```text
electronics-agent-platform: npm test
xinghao-radar: npm run typecheck + targeted Agent boundary/context tests
huaqiangbei-workbench: npm run typecheck + targeted Agent boundary/context tests
```

全量业务仓测试中的既有 Grok PWA metadata / migration-plan 断言不属于本阶段改动；
Phase 9.4 定向测试与类型检查必须全部通过。

## 下一阶段约束

先使用真实业务数据验证建议质量与阈值，再决定是否把业务决策策略抽成独立
Rules Plugin。不得继续向 `adviseFromContext` 堆叠无边界的 `if/else`。
