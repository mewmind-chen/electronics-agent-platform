# Radar / Workbench 接入前审计

日期：2026-08-24（审计当时只读）  
状态更新：2026-08-24 基线冻结时，Radar Import 合同解释与 Workbench 展示权已落地；本文保留审计当时的差距记录，实施结果见 `docs/business-reintegration-baseline.md`。  
范围：审计当时只读。不改 Radar、Workbench、Platform Core、Contract、Runtime、Router、Model Policy、Plugin。

| 仓 | 审计当时 HEAD | 基线冻结后 |
|---|---|---|
| electronics-agent-platform | `7671608`（tag `electronics-agent-plugin-v0.1.0-rc1`，未 push） | Plugin RC 仍为该 commit/tag |
| xinghao-radar | `1c32d49c9fa38a098d56266c0ea9713884c13b98` | `6b806f5` Import Contract Correction |
| huaqiangbei-workbench | `d8b5869a015dc335ee6a2a9a3bfd6fb7a4fdc51b` | `dbc4e18` Intelligence Presentation |

---

## 1. 当前 Plugin 冻结点

Electronics Agent Plugin **v0.1.0 RC** 已本地冻结。它是 Harness **用户对话入口**，不是 Radar/Workbench 入口。

- 三 Skill：`part-analysis` / `import-analysis` / `company-analysis`
- 三 HTTP Tool：只打 `POST /v1/parts/research`、`POST /v1/import/extract`、`POST /v1/companies/research`
- Contract **0.3.1** 未改
- 不写业务库；Vision 仍走 import `sourceType=image`

后续接入 **禁止**让 Radar/Workbench 去调 Plugin。三条边都只打 Platform API。

## 2. 三入口目标架构

```text
                    Electronics Agent Platform
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
       Harness Plugin       Radar          Workbench
         用户对话入口       业务入口         业务入口
```

共享能力：Import / Part / Company Intelligence + Evidence / Candidate。  
稳定事实、validation、DB、人工确认：留在业务仓。

**不要**新增 `radar-context-plugin` / `workbench-context-plugin`。  
当前代码已经是：业务仓自己聚合 Context Snapshot → HTTP 调 Platform。这是正确默认。

---

## 3. Radar 实际现状

### 3.1 Import 完整链

```text
src/routes/import.tsx（及工作台粘贴 src/routes/index.tsx）
  → parseImport  src/lib/server/import.ts
      ① extractViaPlatform  → POST /v1/import/extract  mode=auto
      ② runImportAgent      packages/harness-import（本地 DeepSeek/xAI）
      ③ parseExcel / parseCsv / headerKey / heuristicParse
      → markDuplicates
      → 预览 ImportRow[]
  → confirmImport  同文件
      → import_batches + parts + channel_offers / customer_inquiries / stock_lots / stock_movements
```

Platform 客户端：`src/lib/server/agent-platform.ts` `extractViaPlatform`。  
写库只发生在 `confirmImport`。Agent 不写 Radar DB。

### 3.2 Import 类型与硬编码

| 类型 | 是否先打 Platform | Platform 之后 | 现状 |
|---|---|---|---|
| 内部 Excel/CSV | 是 | 本地 `tableToRows` + `headerKey` 正则 | **审计当时：未分流。** 冻结后：受信内部模板走 deterministic，不再为未知表调用 headerKey 成功路径 |
| 任意供应商 Excel | 是 | 同上，列名靠 regex 猜 | **审计当时：核心缺口。** 冻结后：`needsAgent` + 空 candidates 停在 `needs_mapping`，不再 regex 冒充成功 |
| 文本 / 微信报价 | 是 | 本地 `heuristicParse` 有行则 **跳过 AI** | **审计当时：parser 可压制 AI。** 冻结后：叙事文本 Agent-first；受控行情行才允许 heuristic |
| 图片 | 是 | Platform 422 被当成失败；再走本地 xAI vision | **审计当时：vision_unavailable 未原样展示。** 冻结后：可明确 `local_fallback`，不伪装 Platform 成功 |
| PDF/Word | UI 直接拒绝上传 | 后端仍有 document 路径 | 与 Platform `agent_unavailable` 对齐不足（仍为已知限制） |

Platform 侧设计已经是对的（`packages/import-core`）：

- 表格 **无 mapping** → `needsAgent: true` + `reason: table_mapping_required` + `preview`（header + sample）
- 有 mapping → `applyMappingToTable` 批量确定性解析，不跑 LLM
- 非结构化 → Harness；图片无 Vision → `vision_unavailable` + 空 candidates
- **import-core 不以 heuristicParse 作为成功路径**

Radar 把这条设计接歪了：

```133:138:src/lib/server/agent-platform.ts
  if (!candidates.length) return rec.needsAgent ? null : { rows: [], usedAi: Boolean(rec.usedAi) };
```

`needsAgent` + 空 candidates → 当成 Platform 失败 → 本地 `headerKey`。  
任意供应商表只要某一列碰巧匹配 `/型号|mpn|p\/n|.../`，就会得到「看起来对」的行，**从而不再做 AI schema mapping**。这就是最初要消灭的回潮。

本地 excel 更快路径把问题写死了：

```69:76:packages/harness-import/src/agent.ts
    case "excel": {
      // 表格类永远走确定性解析
      return { rows: tableToRows(table, kind), usedAi: false, provider: null };
    }
```

文本同样：

```text
heuristicParse 有结果 → usedAi:false 直接返回（packages/harness-import/src/agent.ts）
```

MPN：`displayMpn` 只做 NFKC/trim；`verifyMpnProvenance` 只警告不改写。这一条应保留。

### 3.3 Part Intelligence

```text
src/routes/parts.$partId.tsx
  → analyzePartMpn
  → src/lib/server/knowledge.ts
  → runPartAnalysisFlow  src/lib/server/part-analysis-flow.ts
      getRadarPartContext
      POST /v1/parts/research  { mpn, steps:["lcsc","hqew"], mode:auto, context }
      失败 → HQB_BASE_URL/api/agent/lookup.full
  → part_analyses
  → submitPartReview → part_analysis_reviews（纯本地，不回写 Platform）
```

Context（`src/lib/server/radar-context-provider.ts`）：仅聚合 `inventory`（onHand/inTransit/仓库串）和 `quotation.openCount/recentCount`（二者目前都来自同一 `inquiryCount`）。  
**不发**客户名、成本、批次、渠道明细。Platform **不读** Radar DB。这是正确方向。

未进 snapshot：watchlist、movement。现阶段不必为了「更像 Context Provider」硬塞。

### 3.4 Radar 已完成 / 仍需 / 可降级 / 保持

**已经完成**

- 三入口 HTTP 客户端形态（只打 Agent API）
- Import 预览 → 人工 confirm → 本地写库
- Part 调 `/v1/parts/research` + 请求级 context + HQB 降级
- Review 本地保存
- MPN 不自动补全
- 专用 token `ELECTRONICS_AGENT_PLATFORM_TOKEN`

**审计当时仍需修改（真实差距）**  
状态：第一步 Import 合同解释 **completed**（Radar `6b806f5`）。mapping 确认大 UI 仍未做。

| 文件 | 当前逻辑 | 问题 | 目标改法 |
|---|---|---|---|
| `src/lib/server/agent-platform.ts` `extractViaPlatform` | `needsAgent` 空结果当失败 | 丢掉 `preview`/`mapping`/`vision_unavailable` | 把 Platform 合同字段原样交给 UI：mapping required / vision 失败 / 空候选 |
| `src/lib/server/import.ts` `parseImport` | Platform 空 → 本地 excel/headerKey | 任意表被 regex 吃掉 | 内置模板走 mapping 或 headerKey；陌生表禁止用 headerKey 当成功 |
| `packages/harness-import/src/agent.ts` | excel 永远 `tableToRows` | 与 Platform 设计相反 | 降级时也要分「已知模板」vs「需要 mapping」 |
| `packages/harness-import/src/table.ts` `headerKey` | 列名正则 | 合理作 **内部模板 fast path**，不能当任意文件主路径 | 缩小适用范围 |
| `src/routes/import.tsx` | 不展示 mapping UI；PDF 直接拒 | 陌生 Excel 没有「确认列映射」步 | 预览 Platform `preview`，确认 mapping 后再二次 `POST /v1/import/extract` |
| 图片失败 | 422 → 本地 xAI | 可能绕过 `vision_unavailable` | 明确失败或显式「本地视觉降级」，禁止沉默当成功 |

**可以删除/降级（Platform 稳定后，非本阶段）**

- 本地 `model-adapter.ts` DeepSeek/xAI 直连（与 Platform Harness 重复）
- excel 第三层与 harness 重复的 `parseExcel` 成功路径（保留作 **已知模板** 安全网即可）

**保持不动**

- `confirmImport` 及所有 SQL 写库
- `markDuplicates` / `ensurePart`
- `radar-context-provider.ts` 只读聚合
- `submitPartReview`
- `domain.ts` 数量/仓位/MPN 展示规则

---

## 4. Workbench 实际现状

### 4.1 Part Research

```text
src/components/workbench/search-panel.tsx  runLookup()
  → researchViaPlatform  src/lib/search/agent-platform.ts
      POST /v1/parts/research
      { mpn, steps:[lcsc,st,hqew,intel,findchips,icnet], mode:auto,
        context: { quotation }?, firecrawlKey? }
  → 成功：saveReport → search_reports
  → 失败：lookupStep × N  src/lib/search/live-lookup.server.ts  Firecrawl
  → lookup-report.tsx  展示 + buildMarketCards
  → submitReportReview → search_reports.decision / corrected_json
```

Context：`src/lib/search/workbench-context-provider.ts` `QuotationContext`（openCount / recentCount / lastQuotedAt）。  
SQL 聚合 `quote_lines`，**不传**客户名、询价正文、金额。Company 请求 **不带** context。

公开 vs 内部：`PlatformAdvice.usedInternal` 已标注非公开证据。审计当时 UI 仍用本地 `buildMarketCards` 画「热门/货/价」，与 Platform advice **并行**。冻结后：Platform 成功时以 Platform `verdict` / `cards` / `claims` 为准。

Review 完全本地。Agent 不写 `search_reports` 以外的业务主数据。

另有一条 **dsh / `/api/agent/*`** 轨（`src/lib/agent/api.server.ts`）：`lookup.full`、`evidence.save`、`research_reports`。UI 主路径 **不读** `evidence_items`。不要在本阶段把 UI 改成第二条 Harness。

### 4.2 Company Research

```text
runLookup(kind=company)
  → POST /v1/companies/research  { company, steps:["gys","shop","intel"], mode:auto }
  → 失败：本地 gys + intel + shop（Firecrawl，gys.hqew.com）
  → LookupReport 名片/库存结构
```

审计当时无 UI 层 verdict/confidence/evidenceId。降级路径 `identityPatchFromIntel` / `briefFromHits` 从 snippet 打分，**无 evidence 链**。冻结后：Company 展示 Platform claim + evidence；snippet 不再升格为授权/主营/联系人。这曾是公司侧最大的产品风险，但不是 Import 那个「parser 压制 AI」级的架构回归。

### 4.3 Workbench 已完成 / 仍需 / 可降级 / 保持

**已经完成**

- Part/Company Platform-first + 本地 Firecrawl 降级
- Part 出站 quotation 聚合与边界测试
- `search_reports` 保存 + 人工 review
- 双 token 隔离（出站 Platform token ≠ 入站 `WORKBENCH_AGENT_API_TOKEN`）
- `platform-contract.ts` normalize
- 无 Import（Workbench 本来就不是导入写库入口）

**审计当时仍需修改**  
状态：第二步 / 第四步展示去冲突与 Company evidence **completed**（Workbench `dbc4e18`）。Company context 仍未新增。

| 文件 | 当前逻辑 | 问题 | 目标改法 |
|---|---|---|---|
| `lookup-report.tsx` + `analyze.ts` `buildMarketCards` | 供应商数/询价数 if-else 判热门货价 | 与 Platform `advice`/`cards` 抢话筒；无 evidence | Platform 成功时以 Platform 报告为准；本地卡片只在降级时用 |
| `agent-platform.ts` Company | 不传 context；intel 映射为 null | 丢失线索；无内部对照 | 仅传允许的聚合 snapshot（若有）；intel 不要丢 |
| 公司降级 `anysearch.server.ts` | snippet 推断 applications | 无证据编造 | 降级也要 unknown，禁止当事实 |
| `search_reports` vs `research_reports` | 双表 | UI 看不到 evidence | 长期统一；**不要**为此先做 Harness Plugin |

**可以删除/降级（更后）**

- UI 路径在 Platform 成功时仍跑的 `buildMarketCards`
- 与 Platform 重复的 `computeMarketAnalysis`（仅 dsh 轨）

**保持不动**

- `runLookupStep` + `md-parse` 作为 **Platform 不可用时的抓取降级**
- `parse-health` / snapshot 阻断
- `workbench-context-provider` 聚合边界
- 本地 review
- `internal.history.search`（只给本机 dsh，不给 Platform）
- `/api/agent/*` 入站鉴权

---

## 5. AI / deterministic / human 边界

| 变化、无法穷举 | 稳定、可穷举 | 人 |
|---|---|---|
| 陌生 Excel 列映射 | 已知内部表 mapping 批量执行 | 确认 mapping 与导入行 |
| 图片/聊天语义抽取 | qty/DC/货币 validator | 确认候选 |
| 型号/公司公开研究 | MPN NFKC/trim；名称 key | accept / reject / corrected |
| 市场源编排（已在 Platform） | 库存/询价计数聚合 | 正式报价与写库 |

`adviseFromContext` **不在 Radar/Workbench**，在 Platform `packages/part-intelligence-core/src/context.js`。已是 `createContextAdviser()` 可注册 seam，默认仍是库存×询价 if/else。  
本阶段 **只评估、不重构**：默认规则可继续当 A/B；若业务判断要随客户变，用 adviser 注册，而不是新 Harness Plugin。

---

## 6. 重复能力矩阵

| 能力 | Platform | Radar | Workbench | 下一步归属 |
|---|---|---|---|---|
| 任意 Excel 语义识别 | 合同已支持 mapping+Harness | HTTP 已打，但 `needsAgent` 回落到 `headerKey` | 无 Import | **Radar 消费 mapping/preview** |
| 图片报价识别 | Vision 在 import 路径 | 422 当失败再本地 xAI | 无 | Platform 结果原样；本地视觉仅显式降级 |
| MPN normalize | 合同：仅 NFKC/trim | `displayMpn` + 大写 key | `normalizeMpn` 大写 | 展示保留原文；key 可大写。禁止补全 |
| 型号研究 | `/v1/parts/research` | 已调用 + HQB 降级 | 已调用 + Firecrawl 降级 | 保持；修展示冲突 |
| 公司研究 | `/v1/companies/research` | 无主路径 | 已调用 + gys/shop 降级 | Workbench UI 对齐 unknown/evidence |
| 市场来源 | market-sources + Runtime | 不直连（Part 只传 steps） | 本地 Firecrawl 重复实现 | 降级保留；成功路径不要再抓一遍 |
| Evidence | 合同强制 claim→id | Part 结果映射；Import 无 evidence 模型 | UI 主路径几乎不用 evidence 表 | 业务仓展示 Platform evidence；不在仓内再造 |
| 库存事实 | 只收 snapshot | Radar DB + 已出站聚合 | 不持有 Radar 库存 | Radar 继续构造 snapshot |
| 询价事实 | 只收 snapshot | inquiryCount 塞进 quotation | QuotationContext | 各自聚合，不暴露明细 |
| 人工确认 | 禁止 confirmImport | `confirmImport` / part review | report review | **必须留在业务仓** |
| DB write | 禁止 | Postgres | SQLite `search_reports` 等 | **必须留在业务仓** |

---

## 7. 硬编码回潮审计

分类：A 合理规则 / B fast path / C validator / D fallback / E 正在替代 AI 的业务判断。

### Radar（真问题在 E/B 误用）

| 位置 | 类 | 说明 |
|---|---|---|
| `headerKey` 中英文列名 | A，但被当成任意文件主路径时变成 **E** | 只应绑定内部模板 |
| `heuristicParse` MPN/DC/数量 | A 作 validator/辅助；有行就跳过 AI 是 **E** | 聊天文本应 semantic → validator |
| excel `tableToRows` 永不 AI | B 仅内部模板合理 | 陌生表 = 回潮 |
| `correctTradeText` 坂田/HK | A | 不改 MPN |
| `verifyMpnProvenance` | C | 保留 |
| `mixed` 有 customer→inquiry | E | 业务类型推断，应弱于人工 kind |
| Platform→harness→regex 三层 | D | 降级链要保留，但成功判定不能靠「有几行」 |

### Workbench

| 位置 | 类 | 说明 |
|---|---|---|
| `md-parse` 源站 HTML/markdown | A + D | 降级抓取解析，保留 |
| `stProductUrl` 仅 STM32 | B | 保留 |
| `buildMarketCards` 热门/货/价阈值 | **E** | Platform 成功后仍覆盖智能结论 |
| `computeMarketAnalysis` | E | 仅 dsh 轨，勿接到 UI |
| `briefFromHits` / `identityPatchFromIntel` | **E** | 无 evidence 推断 |
| `part-dossier` extraKnowledge 目录 | B/E | Agent 轨贸易知识，勿扩大到 UI 主路径 |
| Platform 失败 → Firecrawl | D | 保留 |

### Platform（记录，本阶段不改）

`adviseFromContext` 默认 if/else：有货且询价多 / 无货询价多 / 有货无询价。A 作为默认 seam；要产品化再挂业务规则，不新开 Plugin。

---

## 8. Context 现状

正确形状已经存在，**不要**再做成 Harness Plugin。

```text
Radar DB / Workbench DB
  → 业务仓只读聚合（无客户名、金额、正文）
  → request.context
  → Platform
  → advice.usedInternal（非 evidence）
```

| Snapshot | 已有 | 应给 Platform | 禁止给 Platform |
|---|---|---|---|
| Radar inventory | 是 | 是 | 仓位明细可继续只给汇总串 |
| Radar inquiry/quotation | 计数，且 open/recent 目前相同 | 计数即可 | 客户、内容 |
| Radar watchlist/movement | 仅本地 UI | 暂不 | — |
| Workbench quotation | 是（Part） | 是 | 客户、content、amount |
| Workbench customer/supplier 主档 | 本地 | 否 | 全部标识 |
| 查询/研究报告全文 | 本地 | 否 | review 决定 |

---

## 9. 接入差距（压缩）

### Radar

HTTP 已经打到 Platform。审计当时 **缺的是 Import 合同被当成「有行就算成功」**；该解释错误已在 Radar `6b806f5` **completed**。  
Part 接入在架构上已经完成，剩下的是 snapshot 语义（recentCount）和 live mapping 应用，不是重新接 API。

### Workbench

HTTP 已经打到 Platform。  
审计当时 Part 缺：成功时仍用本地热门启发式 → **completed**（`dbc4e18`）。  
审计当时 Company 缺：evidence/unknown 展示；降级编造 → **completed**（`dbc4e18`）。  
Import 不是 Workbench 职责。

### 共同

不要为 Context 或「插件化」新建 Plugin。不要让业务仓调用 electronics-agent Plugin。

---

## 10. 最小实施顺序

按 **真实差距** 重排，不机械四段并行。

### 第一步（审计当时下一阶段唯一开工项）：Radar Import 合同对齐 — **completed**

独立验收、可回滚、Platform 挂了仍能导入 **已知内部表**、Agent 仍不写库。

1. `extractViaPlatform` 区分：`table_mapping_required` / `vision_unavailable` / 真正网络失败。
2. 陌生 Excel：把 `preview` 交给用户确认 mapping → 第二次 POST 带 `mapping` → `applyMappingToTable`。
3. 内部模板：显式 mapping 或白名单 headerKey；**禁止**用 headerKey 吞掉未映射的任意表。
4. 文本：heuristic 只做 validator，不能因为「抽到了行」就跳过 Platform/AI。
5. 图片：展示 `vision_unavailable`；若保留本地视觉，必须是显式降级。

### 第二步：Workbench Part 展示去冲突 — **completed**

Platform 成功则禁用或降级 `buildMarketCards`；advice/evidence 来自 Platform。Firecrawl 仅失败时启用。

### 第三步：Radar Part snapshot 语义（小） — **planned**

拆清 `quotation.recentCount`；不扩 watchlist。不改 Platform Contract。

### 第四步：Workbench Company unknown/evidence — **completed**

降级路径禁止 snippet 当注册资本/联系人/品牌关系；UI 无 evidence 则未知。

每步都满足：业务系统可单独回滚；Platform down 时内部模板/本地抓取仍可用。

---

## 11. 后续真实业务验收案例（设计，本阶段不跑）

### Radar Import

1. **标准内部 Excel**  
   目标：deterministic（带已知 mapping 或白名单表头），不浪费 LLM。预览 → 人确认 → DB。

2. **陌生供应商 Excel，列名完全不同**  
   目标：AI schema mapping，**不是**新 `headerKey` 分支。未确认 mapping 不得当成功。

3. **微信/聊天式报价文本**  
   目标：semantic extraction + validator。heuristic 命中不得单独作为唯一成功路径。

4. **报价图片**  
   Platform Vision 可用 → Candidate；不可用 → 明确失败或显式降级，**不伪造**。

5. **不完整/歧义 MPN**  
   不得自动改后缀。人确认后才写库。

全部：Candidate → Preview → Human Confirm → Radar DB。

### Workbench Part

真实型号 `TPS54560DDAR`：claim 必须带已存在 evidenceId；不足则 unknown。本地热门卡片不得在 Platform 成功时盖掉 unknown。

### Workbench Company

真实供应商：无证据不编造联系人、注册资本、热门型号、品牌关系。

---

## 12. 风险与回滚

| 风险 | 回滚 |
|---|---|
| 关掉 headerKey 后内部表导入变空 | 保留内部模板 mapping 白名单；feature flag 按 source |
| Platform Harness 超时 | 已知模板仍本地 deterministic；陌生表显示「需要映射」而不是错行 |
| 图片不再走本地 xAI | 用户看到明确失败，与 Plugin RC 一致；可开关「允许本地视觉」 |
| Workbench 去掉 buildMarketCards | 仅 Platform 成功分支；失败仍用本地卡片 |
| 误把 Context 做成 Plugin | **不做**。当前 snapshot HTTP 即可 |

---

## 13. 下一步建议

**审计当时立刻做的第一项：改 Radar Import 对 `/v1/import/extract` 返回值的解释，而不是再接一条 API、也不是改 Plugin。该项已 completed。**

原因：最初立项要解决的就是「任意供应商文件被 parser/regex 吃掉、AI 没机会做 schema mapping」。Platform 合同和 import-core 已经按这个模型写好了；Radar 曾用「有 candidates 才算成功，否则 headerKey」把缺口接了回去。Part/Company 的 HTTP 主路径已经在两个业务仓落地。

当前冻结事实见 `docs/business-reintegration-baseline.md`。本审计原文保留差距记录；状态字段已标 planned → completed。
