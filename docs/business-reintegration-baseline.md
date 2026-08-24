# Business Reintegration Baseline

日期：2026-08-24  
范围：只记录已经实际完成并本地冻结的事实。未 push。

---

## 1. Plugin freeze

| 项 | 值 |
|---|---|
| 仓 | `electronics-agent-platform` |
| commit | `7671608ca16b0ceb62aeff315aa69b075744849d` |
| message | `feat: freeze electronics agent plugin v0.1.0 rc` |
| local tag | `electronics-agent-plugin-v0.1.0-rc1` → 同上 hash |
| tests | `npm test` **150 pass / 0 fail**（含 phase11 / phase12 / plugin-rc） |
| Contract | 仍为 **0.3.1**，冻结层零修改 |

Plugin 只负责 Skill / HTTP Tool / Presentation。  
只调用 `POST /v1/parts/research`、`POST /v1/import/extract`、`POST /v1/companies/research`。  
不访问 Radar / Workbench DB。

---

## 2. Radar freeze

| 项 | 值 |
|---|---|
| 仓 | `xinghao-radar` |
| commit | `6b806f5496b0fafa043da84ca738692d470cbd69` |
| message | `fix: restore agent-first routing for unbounded imports` |
| parent | `1c32d49` |
| tests | `npm test` **232 pass / 0 fail**（含 Import CASE 1–9） |
| typecheck | `npm run typecheck` 通过 |

已完成：未知供应商 Excel / 叙事文本不再被 headerKey / heuristic 抢成功；`needsAgent` + 空 candidates 解释为 `needs_mapping`；受信模板仍 deterministic；Preview → Human Confirm → Radar DB 保持。

---

## 3. Workbench freeze

| 项 | 值 |
|---|---|
| 仓 | `huaqiangbei-workbench` |
| commit | `dbc4e18e8fe16f998dac6380dca5e3b2ea06ee99` |
| message | `fix: make platform intelligence authoritative in workbench` |
| parent | `d8b5869` |
| tests | `npm test` **197 pass / 0 fail**（159 scripts + 38 TS/presentation） |
| typecheck | `npm run typecheck` 通过 |

已完成：Platform 成功后是唯一智能结论源；`buildMarketCards` 不再推断热门/缺货/涨跌；snippet 不再升格为公司/型号事实；evidence / confidence 可展示；fallback 明确标记；review / correction / save 仍在本地。

---

## 4. 三入口架构

```text
                  Platform
                     │
        ┌────────────┼────────────┐
        │            │            │
     Harness       Radar       Workbench
      Plugin
```

- Harness Plugin：用户对话入口 → Platform API
- Radar：业务入口 → Platform API
- Workbench：业务入口 → Platform API

Radar / Workbench **不调用** Harness Plugin。  
没有新增 `radar-context-plugin` / `workbench-context-plugin`。

---

## 5. 智能决策权

| 职责 | 归属 |
|---|---|
| Unbounded semantic understanding | Platform / Agent |
| Stable deterministic rules | 业务仓代码 |
| Evidence / claims | Platform |
| Business facts / context snapshot | Radar / Workbench |
| DB write | Radar / Workbench |
| Final decision | Human |

---

## 6. 保留的 fallback

- Radar：已知内部模板 / 受控行情行仍本地 deterministic；Platform 网络不可用时未知表不走任意 Excel regex 成功；图片可显式 `local_fallback`（现有 xAI）
- Workbench：Platform 不可用时继续 Firecrawl / HQB / AnySearch；公开结论保持 unknown，并标 `origin=fallback`
- Platform：Harness / Vision 不可用时诚实失败或 core fallback；不把源失败写成 evidence

---

## 7. 当前已知限制

- Vision：Platform 当前常返回 `vision_unavailable`；Radar 可显式本地视觉降级，不伪装 Platform 成功
- PDF / Word：Platform 仍可能 `agent_unavailable`；Radar UI 直接拒绝上传；本基线不补 PDF Agent
- Harness 本机环境：Desktop credentials 格式与 CLI 不完全兼容；Plugin 安装依赖本机 profile / pnpm store
- 既有 lint debt：Radar / Workbench 旧文件仍有 lint error，本基线未为过 lint 改冻结规则
- Radar：若 live Agent 只返回 mapping、candidates 仍空，本基线停在 `needs_mapping`，没有 mapping 确认大 UI
- Workbench：Company 请求仍无 context；Part quotation 聚合保持无客户名 / 金额
- 三仓 commit / tag **均未 push**

---

## 8. 下一阶段候选（只列，不实现）

A. 验证 Radar live schema mapping 是否存在：Platform 返回 mapping 但 candidates 为空的真实情况  
B. 增加更厚的 Market Sources / Evidence  
C. 后续真实业务流量接入  

不要默认下一步一定是 A。
