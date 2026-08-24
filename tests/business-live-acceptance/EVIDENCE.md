# Real Business Traffic Acceptance

验收日期：2026-08-24
结论：**PASS**

这份证据只记录脱敏摘要。真实 Excel、客户/单号、原始备注、完整价格和任何凭据均未进入仓库。机器可读结果见 `results.json`，真实表格的脱敏结构见 `fixtures/kowin-shape.redacted.json`。

## 业务边界结论

- 容易变化的 Excel 列语义、聊天文本理解、图片识别、Part/Company 研究由 Platform 的可插拔 Harness 能力处理。
- Excel 原始字节不再经过模型：Platform 只给模型 8 行有界预览，模型返回并校验一次 mapping，145 条原始业务行由确定性代码解析。
- MPN、数量、DC、交期等事实经过合同和确定性校验；明确事实若未抽取会产生人工核对 warning，不会静默消失。
- Radar 在预览后才写库，并独立执行“渠道必填”等业务约束；Platform 不拥有正式业务库。
- Workbench 只展示 Platform 的公开结论与本地汇总上下文。无公开 evidence 时保持“未知”；人工 `corrected_json` 只写 Workbench，不回传 Platform。

## Live 结果摘要

| 流程 | 结果 | 关键证据 |
|---|---|---|
| 真实 Kowin 形态 Excel | PASS | 504 → 200；145 candidates；bounded preview；validated mapping；deterministic bulk apply |
| Radar 受控单行文本 | PASS | 本地确定性解析；先预览；缺渠道时拒绝写入 |
| Radar 多型号 + 统一交期 | PASS | UI 标记 `AI 识别（Platform）`；2 型号、各自 DC、统一交期均保留 |
| 图片 | PASS | Harness Plugin → Platform；vision role；1 candidate；不按文件名猜测 |
| Part 并发 | PASS | 3/3 结构化；UUID 会话唯一；不再把 tool arguments 冒充结果 |
| Company 并发 | PASS | 3/3 结构化；无 evidence 保持未知；不编联系人 |
| 同型号业务上下文 | PASS | 有货有询与无货有询产生不同内部动作；公开 verdict 都保持未知 |
| Harness Plugin | PASS | Part / text import / image import / Company 共用同一 Platform，展示层不倾倒原始 JSON |
| Workbench 人工修正 | PASS | 修正成功落本地；页面标明工作台持有；Platform 不接收决定 |
| 失败语义 | PASS | health 200；unauthorized 401；contract 422；agent unavailable 明确 `ok:false` |

## 验收中发现并落地的修复

- Platform `d3a4b57`：Excel mapping 闭环、DSH lossless JSON、严格 tool output 识别、并发 UUID 会话、显式事实丢失 warning。
- Workbench `0ef4ba7`：Playwright 保持服务端依赖，修复 Vite 8 dev 启动崩溃。
- Workbench `1f2c79b`：根级 QueryClientProvider，修复真实报告/人工复核页面崩溃。
- Radar `6b806f5`：`needsAgent` 不再被本地 header/regex 假成功吞掉，陌生输入进入 Platform。

## 验证

- Platform：160/160；GitHub CI green（功能修复批次）；证据批次推送后由同一 CI 再验。
- Radar：232/232；typecheck pass；production build pass。
- Workbench：160/160 + 38/38；typecheck pass；production build pass。

公开抓取凭据或会员 cookie 缺失时，系统会明确显示降级并维持未知。这是已验收的安全行为，不是伪造成功。
