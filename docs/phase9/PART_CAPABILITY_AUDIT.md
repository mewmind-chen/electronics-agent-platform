# Part Capability Audit

对照：`huaqiangbei-workbench` 型号分析 vs `electronics-agent-platform` Part Core / Agent。  
原则：不复制业务仓代码；Workbench AI 能力进入 Domain Core，再由 Part Skill 调用。  
Radar / Workbench 本阶段零修改。

| 能力 | Workbench 已有 | Platform 已有（9.1） | 是否完整迁移 | 9.2 处理 |
|---|---|---|---|---|
| 型号身份确认 | LCSC/ST identity：brand / category / package / specs / summary | `researchPart` 合并 identity；失败则 null | 部分 | 保留 live lookup；报告强制写厂家/分类/封装；无身份则未知 |
| 厂商识别 | `identity.brand` + 系列知识（ST / 乐鑫 / 华邦） | 薄 `extraKnowledge`，缺 use/customers | 部分 | 补领域目录字段 `use` / `customers`，不写业务库 |
| 市场分析 | `computeMarketAnalysis`（询价 70% / 供给 30%）+ `buildMarketCards` | 简化 hotness/shortage/priceTrend，无卡片文案 | 部分 | Core 增加可解释市场卡片；无快照不编涨价 |
| 供应分析 | `analyzePart`：exact 挂货、供应商桶、批次、立创库存、价差 | 只计 offer 条数 | 否 | 迁入 `analyze.js`（领域函数，无 UI） |
| 风险判断 | 热门/缺货/价卡片 + 停产靠人工备注；NRND 无独立引擎 | `verdict.state` 热门/缺货/平稳/未知，规则过粗 | 部分 | 无证据=未知；风险只陈述证据不足/货紧，不编停产 |
| Evidence | claim.evidenceId + 源失败不当证据 | 有 Evidence 模型，但常只发 1 条泛化 claim | 部分 | 身份/供应/市场分条 claim，全部挂 evidenceId |
| 定位 / 客户 | `partPositioning` + `translateApps` + 目录 `customers` | headline 过短 | 否 | Core 输出定位与目标客户，报告「业务建议」引用 |
| 报告 | 工作台卡片 UI | `composePartReport` 接近 JSON 转 Markdown | 否 | 固定业务报告模板 |
| Agent SOP | 无官方 Skill | `part.md` 仍偏「调用 tool 返回 JSON」 | 否 | 7 步领域流程 |

## 边界

- Agent 可：理解「分析 {MPN}」、选 part Skill、调 `part_research`、组织报告。
- Agent 不可：写 Radar / Workbench 库、INSERT、saveReport、补全型号。
- Radar：库存 / 询价事实来源与消费者。
- Workbench：正式研究报告消费者；内部询价条数经 request ctx 传入。
