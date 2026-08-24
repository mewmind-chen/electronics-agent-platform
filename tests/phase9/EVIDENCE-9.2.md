# Phase 9.2 Evidence — Part Intelligence Agent 业务化验证

Radar / Workbench **零修改**。无新模型、无 Router/Supervisor/Multi-Agent。

## 交付

1. `docs/phase9/PART_CAPABILITY_AUDIT.md`
2. `.dsh/skills/part.md` — 7 步领域 SOP
3. Domain Core：`analyze.js`（供应分桶 / 定位 / 市场卡片）+ 更完整 claim
4. `composePartReport` — 业务报告模板
5. `tests/phase9/part-eval/` — 21 个真实/对照型号

## 闭环（live）

`分析 TPS54560DDAR` → `/v1/chat` → Electronics Agent → Part Skill → `part_research` → Part Core → Evidence → 自然语言报告。

`tests/phase9/live-chat.json`：`viaHarness=true`，`toolsCalled=["part_research"]`，MPN 原样。本次市场源薄 → **状态：未知**，不编热门/缺货/涨价。

## Eval

21 cases，桶：A 热门 / B 工业 / C 冷门 / D 风险 / E 错误 / F 多供应商。

每条验证：MPN 原样、skill=part、tool=`part_research`、无证据则 unknown、报告含固定章节。  
**21/21 离线 Agent 路径通过（≥5 的验收门槛）。**  
错误型号 `NOTAREALPART999` / `XXXX0INVALID` / `FAKECHIP42ABC` 不编造确定结论。

平台全量 **80/80**。

## 业务价值判断

- Agent 已能按领域 SOP 产出可审计报告，而不是 JSON dump。
- 当前 live 价值受 **市场源证据厚度** 限制：无 Firecrawl/授权页时正确降级为未知。
- 这是诚实结果，不是模型失败。下一阶段应补数据源接入（请求级 key / Radar 询价 ctx），而不是再扩 Runtime。

## 下一阶段建议（不在本阶段做）

1. Phase 9.3：请求级接入 LCSC/HQEW（已有 market-sources）+ 可选 Radar `internalQuoteCount`，让 5 个热门型号在 live 下也能给出带 evidence 的非未知结论。
2. 再考虑 Import / Company Agent。不要回头扩模型池。
