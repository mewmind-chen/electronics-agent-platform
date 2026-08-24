# Phase 9.3 Evidence

## 交付

- Context Contract：`packages/contracts/src/context.js`
- 设计：`docs/phase9/PHASE93_CONTEXT.md`
- 注入：`requestCtx` 只读请求体 `context.*`
- 报告：公开市场判断 / 内部业务判断 / 综合建议
- Eval：`tests/phase9/context-eval.test.mjs`

## 对照

同一型号 `TPS54560DDAR`：

- 无 context → 综合建议走「补公开数据 / 仅公开市场」
- 有 Radar 库存 8000 + Workbench 询价 4 → 「优先消化库存、按询报价」

内部数字不进入 `evidence[]`。

## 下一阶段建议

业务系统（Radar/Workbench）在调用 `/v1/chat` 时注入真实库存/询价快照。不要改库、不要做 Company/Import Agent、不要回头扩 Runtime。
