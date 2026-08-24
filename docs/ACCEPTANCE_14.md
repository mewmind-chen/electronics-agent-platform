# 最终验收证据（原始方案 §37）

对照《Electronics Agent Platform 最终实施方案》第 37 节 14 项验收标准，逐项出具可复核证据。

更新日期：2026-08-24（本批补强：证据表述纠偏 + Workbench 修正持久化）。

## 0. 范围

本文件只回答一件事：**§37 的 14 条架构红线是否成立。**

它不宣称：

- Vision / Long Import 已具备生产能力
- 所有绑定模型都已进入 production 池
- 三个仓库的未跟踪文件、Docker 镜像、远端 CI 都已收口
- 把 DeepSeek Harness 整层换成另一套 Agent Runtime 已经做过一次真替换

上述事项见文末「§37 以外仍未完成」。

## 现场快照

| 仓 | 已推送 HEAD | 本批工作区 | 本次验证 |
|---|---|---|---|
| Platform | `6dc8036` | 本文件 + `docs/HANDOFF.md` | `npm test` **115/115** |
| Radar | `ef011a9` | 人工决定测试补强 | `npm test` **218/218**；`npm run typecheck` 通过 |
| Workbench | `fbb73e3` | `0009` 修正正文 + 测试 | `npm test` **159 + 24**；`npm run typecheck` 通过 |

本批补强（尚未提交）：

- Workbench `migrations/0009_report_review_correction.sql`：修正不再只写备注，持久化 `corrected_json`
- Radar `scripts/analysis-db.test.mjs`、`scripts/agent-api-boundary.test.mjs`：人工决定写入业务表、不回传 Platform
- Workbench `scripts/report-review.test.mjs`：接受/拒绝/修正闭环与降级边界

---

## 1. 新仓库实际运行官方 DeepSeek Harness

✅ 通过（Runtime 通了，不等于模型资格 9/9）。

**代码**

- `runtime/jsonrpc.cordis.yml` 使用官方 `@deepseek-ai/dsh-sdk-jsonrpc-server`
- `runtime/package.json` 依赖官方 JSON-RPC / credentials / sandbox 插件
- `apps/agent-api/src/runtime.js` 经 `@deepseek-ai/dsh-sdk-client` 的 `DeepSeekHarness` 启动进程
- `apps/agent-api` 不直接打 DeepSeek HTTP API；模型请求由 Harness 进程发出

**实测**

- `tests/phase9/live-chat.json`（2026-08-24T07:01:07Z，12772ms）
  - `ok=true`，`viaHarness=true`，`route=harness`
  - `toolsCalled=["part_research"]`
  - `modelRoute.provider=opencode-go`，`model=deepseek-v4-pro`
  - **质量很薄**：`claimsCited=[]`，报告正文大量「证据不足 / 未知」。这只证明官方 Harness 路径可跑，不证明 Part Research 已经稳定好用。
- `scripts/live-qualify.mjs` → `tests/phase82/live-results.json`

**模型资格（不要写成 7/9 production）**

| 口径 | 结果 |
|---|---|
| catalog 共 9 个绑定模型 | 9 |
| `verified=true` | **7/9** |
| `pool=production` | **4/9**：`deepseek-v4-flash`、`deepseek-v4-pro`、`qwen3.7-max`、`litellm/free-strong` |
| 未进 production | `free-fast`（import harness timeout）、`kimi-k3` / `free-long`（long: 0 rows / timeout）、`grok-4.6`（smoke 不完整）、`glm-4v-flash`（vision / harness 未过） |

§37 第 1 条的门槛是「新仓库实际运行官方 Harness」，不是「九个模型全部生产可用」。后者见文末。

## 2. Agent API 与 Harness Runtime 解耦

✅ 通过。

**分层**

- 业务 handler：`apps/agent-api/src/research.js` 只拿 `runtime` 返回的 contract 结果
- Runtime 封装：`apps/agent-api/src/runtime.js` 只经 `DeepSeekHarness` + `resolveJsonrpcBin` / `CORDIS_PATH`
- Harness 进程：`dsh-jsonrpc-agent`（`runtime/package.json` 的 `electronics-jsonrpc-agent`）
- 执行模式：`auto | agent | core`

**测试**

- `tests/phase8/execution-mode.test.mjs`：`core` / Harness 不可用时 `harnessStarts=0`；`agent` 不可用返回 `agent_unavailable`，绝不静默走 stub
- `tests/phase9/part-agent.test.mjs`：`mode=core` 不是 Agent loop；`mode=agent` 才走 `part_research`

**边界**

`apps/agent-api` 仍依赖 `@deepseek-ai/dsh-sdk-client`（以及测试/插件侧的 `dsh-tools`）。解耦的是 **API 进程 vs Harness 进程**，以及 **业务 handler 不直接调模型**，不是 agent-api 零 SDK。

## 3. xinghao-radar 不依赖任何 Harness 内部类型

✅ 通过。

- `rg "@deepseek-ai" src/`（排除 node_modules）→ 无命中
- 只消费 HTTP contract：`src/lib/server/agent-platform.ts` 调 `/v1/parts/research`、`/v1/import/extract`
- 测试：`scripts/agent-api-boundary.test.mjs`「Radar agent client has no Harness types」断言无 `@deepseek-ai` / `defineTool`，且 `mode: "auto"`

## 4. Workbench 不依赖任何 Harness 内部类型

✅ 通过。

- `rg "@deepseek-ai" src/` → 无命中
- `src/lib/search/agent-platform.ts` 调 `/v1/*`，`src/lib/search/platform-contract.ts` 映射为本地类型
- 测试：`scripts/agent-platform-boundary.test.mjs` 断言无 Harness import、无 SQL 写、`mode: "auto"`

Workbench 仍有可选薄壳 `harness-tools/`，那是本仓 MCP 入口，**主 UI 查询链不走它**，也不引入 `@deepseek-ai` 类型到 `src/`。

## 5. Import 返回 Candidate，不直接写库

✅ 通过。

- `packages/contracts`：`rejectWriteSemantics` 拒绝 `confirmImport / INSERT / sql`
- `packages/import-core` 只产出 `ImportCandidate[]`
- Radar `candidateToImportRow` 只转 Preview；正式入库仍是 Radar `confirmImport`
- 测试：
  - `packages/contracts/src/contracts.test.js`「import candidate rejects preview/write flags and SQL」
  - `tests/phase10/import-eval/eval.test.mjs`「every corpus input is read-only ImportRequest; write semantics are rejected」
  - Radar `scripts/agent-api-boundary.test.mjs`「confirmImport stays local」

## 6. Part Research 每个核心 Claim 有 Evidence

✅ 通过。

- `parsePartResearchResult`：非 `未知` 的 claims 必须 `evidenceIdsExist`
- `packages/part-intelligence-core`：未知态 `claims=[]` 且 `state=未知`；有结论必须挂 evidenceId
- Eval：`tests/phase9/part-eval/cases.json` 21 个真实/对照型号；`eval.test.mjs` 校验 MPN 原样、无证据则未知
- 契约单测：`contracts.test.js`「part research result requires claim evidence to exist」

## 7. Company Research 结果包含来源与置信度

✅ 通过。

- `parseCompanyResearchResult` 输出 `companies / shopRows / evidence / verdict{state,score,confidence}`
- `tests/phase10/company-eval/cases.v1.json` 22 例，每例 `expected.confidence` ∈ `{low,medium,high}`，品牌/型号 claims 必须有 evidence
- 测试：`company-eval/eval.test.mjs`「company contract couples branded claims and verdict claims to listed evidence」

## 8. Market Sources 不依赖具体业务项目

✅ 通过。

- `packages/market-sources` 无 `import` Radar/Workbench 模块
- 唯一命中是注释：`md-parse.js` 写明解析器抽自 Workbench，属于代码来源说明，不是运行时依赖
- `runLookupStep` 经 request-scoped `ctx` 注入 key
- 测试：`packages/market-sources/src/market-sources.test.js`「package has no Harness or business-path coupling」

## 9. Credential 不使用模块级全局 mutable state

✅ 通过。

- `packages/market-sources` 无 `let requestKey` 全局；key 走 `ctx.firecrawlKey`
- `apps/agent-api/src/research.js` `requestCtx(req, extra)` 每次从请求构建
- 测试：
  - `market-sources.test.js`「concurrent scrapes do not share keys」
  - 「missing firecrawl key fails that request only」

## 10. Agent Platform 故障不影响两个业务系统核心功能

✅ 通过。证据在**业务仓**，不在 Platform phase5/phase8。

**Radar**

- `src/lib/server/knowledge.ts`：不可达 / 超时 / 空结果返回 `{ok:false}`，详情页照常渲染
- 回退 `HQB_BASE_URL/api/agent/lookup.full`
- `src/lib/server/part-analysis-flow.ts`：`context_provider_unavailable` / `platform_unavailable` → `lookupFallback`
- 测试：
  - `scripts/agent-api-boundary.test.mjs`「Radar analysis degrades provider and Platform failures into a safe HQB fallback」
  - `scripts/agent-platform.test.mjs` 401 / timeout 安全降级
  - `scripts/knowledge-map.test.mjs`「降级: 服务端 ok=false → ok:false」

**Workbench**

- `src/lib/search/agent-platform.ts`：401 / ≥500 / 超时 / 网络错误 → `platformDegradation`
- `src/components/workbench/search-panel.tsx` + `lookup-report.tsx`：本地数据 + 「已使用本地数据」提示
- 测试：
  - `scripts/agent-platform-boundary.test.mjs` 401/超时/提示文案
  - `scripts/report-review.test.mjs`「Workbench platform degradation keeps local lookup and never writes the review」

Platform 的 phase5 / phase8 证明的是 **Agent API 自己的 mode/fallback**，不能单独当作「业务系统核心功能不受影响」的证据。

## 11. Harness 可替换而不需要重写业务系统

✅ 通过（架构可替换；不是已经换过一套 Runtime）。

**已证明**

- 业务仓只依赖 `POST /v1/*` JSON，不绑定 Cordis / SDK 类型（第 3、4 项）
- Harness 配置面集中在 `runtime/jsonrpc.cordis.yml`
- provider / model 经 `packages/model-policy` 决定
- 同一套官方 Harness 下，`opencode-go` 与 `llm`（litellm）已在相同业务 API 上跑通（live-qualify production 4 个模型）

**未证明、不得写成已完成**

- 没有把 `@deepseek-ai/dsh-sdk-*` 整层换成 Copilot / 自研 loop 再跑一遍 14 项
- Grok 订阅与 Vision 插件尚未成为可替换生产路径

替换成本：改 runtime 配置 + model-policy 资格，不改 Radar/Workbench。这是 §37 要的「不需要重写业务系统」。

## 12. 有真实业务 Eval 集合

✅ 通过。

| 集合 | 路径 | 规模 | 纳入 `npm test` |
|---|---|---|---|
| Import | `tests/phase10/import-eval/cases.v1.json` | 30 | 是 |
| Part | `tests/phase9/part-eval/cases.json` | 21 | 是 |
| Company | `tests/phase10/company-eval/cases.v1.json` | 22 | 是 |

本次 Platform `npm test`：**115/115**。评测集覆盖契约、只读、MPN 原样、无证据则未知；不是线上抓取黄金集，但是真实业务形状（型号、风险桶、脱敏样本）。

## 13. MPN 不允许 AI 自动补全或修改

✅ 通过。

- `assertMpnUnchanged`：`mpnRaw` 与 `mpn` 必须一致，只允许 NFKC + trim
- `.dsh/skills/part.md` Hard rules：不补全、不改写 MPN；composer 必须原样返回 tool JSON
- 测试：
  - `contracts.test.js`「MPN must not be auto-completed or rewritten」
  - `part-eval/eval.test.mjs`「20+ eval cases keep MPN」
  - `part-core.test.js`「inferPartIntent copies TPS54560DDAR from a Chinese sentence」

## 14. 所有高风险结果都允许人工确认

✅ 通过。本批把 Workbench「修正」补到与 Radar 同级。

**Radar（已推送 `ef011a9`，本批补测试）**

- `migrations/0004_part_analysis_review.sql`：`part_analysis_reviews`，`decision ∈ {accept,reject,corrected}`，含 `corrected_json`
- 详情页接受 / 拒绝 / 修正；修正必填修正 JSON
- `submitPartReview` 只写 Radar DB，不调 `/v1/*`
- 测试：`analysis-db.test.mjs`「人工决定写入业务表且修正必须带 corrected_json」；`agent-api-boundary.test.mjs`「Radar human review is persisted locally and never sent to the platform」

**Workbench（已推送 `fbb73e3` 决策列；本批 `0009` 补修正正文）**

- `migrations/0008_report_review.sql`：`decision / reviewed_at / review_note`
- `migrations/0009_report_review_correction.sql`：`corrected_json`
- 报告区接受 / 拒绝 / 修正；修正必填修正 JSON，备注可选
- `submitReportReview` 只 `update search_reports`，Platform 不写正式决定
- 测试：`scripts/report-review.test.mjs`

**不变式**：高风险结论（型号分析、询价报告、公司画像 eval 也标了 `requiresHumanReview`）的最终动作由业务系统持久化。Platform 只给 Candidate / Research / Evidence。

---

## 汇总

| 项 | 结论 | 硬证据 | 需要记住的边界 |
|---|---|---|---|
| 1 官方 Harness | ✅ | `live-chat.json` viaHarness | 7/9 verified，**4/9 production**；该次 chat 质量薄 |
| 2 API/Runtime 解耦 | ✅ | phase8/phase9 mode 测试 | agent-api 仍依赖 SDK client |
| 3 Radar 无 Harness 类型 | ✅ | `src/` grep + boundary 测试 | |
| 4 Workbench 无 Harness 类型 | ✅ | `src/` grep + boundary 测试 | `harness-tools` 是可选 MCP，不进主 UI |
| 5 Import Candidate 不写库 | ✅ | contracts + import-eval | 入库仍在 Radar `confirmImport` |
| 6 Part Claim 有 Evidence | ✅ | part-eval 21 | 无证据必须未知 |
| 7 Company 有来源/置信度 | ✅ | company-eval 22 | |
| 8 Market Sources 独立 | ✅ | 无业务模块 import | 注释提及 Workbench 来源 |
| 9 Credential 请求级 | ✅ | requestCtx + 并发 scrape 测试 | |
| 10 故障不影响业务 | ✅ | Radar/Workbench 降级测试 | **不要引用 phase5/8 当主证据** |
| 11 Harness 可替换 | ✅ | `/v1` contract + runtime 配置面 | 证明的是架构，不是真换 Runtime |
| 12 真实 Eval 集合 | ✅ | 三套评测 115/115 | 契约评测，不是线上黄金抓取 |
| 13 MPN 不补全 | ✅ | assertMpnUnchanged + skill | |
| 14 高风险可人工确认 | ✅ | Radar 0004；Workbench 0008+0009 | 本批补齐 Workbench `corrected_json` |

**§37：14/14 通过。**

## §37 以外仍未完成

这些**不否决**第 37 节签字，但也不能用本文件宣布「整体落地完成」：

1. Vision / Long Import 生产能力：`glm-4v-flash` 未过，`kimi-k3` / `free-long` long 路径超时。
2. 模型资格：9 个绑定里只有 4 个 production。
3. Platform 根目录未跟踪文件（禁止误提交）：`package-lock.json`、`HANDOFF.md`、`eslint.config.mjs/`。
4. 本批 Radar / Workbench / 本文件的工作区改动尚未提交推送。未推送不算交付。

## 如何复验

```bash
# Platform
cd electronics-agent-platform && npm test
# 期望 115/115

# Radar
cd xinghao-radar && npm test && npm run typecheck
# 期望 218/218

# Workbench
cd huaqiangbei-workbench && npm test && npm run typecheck
# 期望 scripts 159 + ts 24
```

抽查：

```bash
rg -n "@deepseek-ai" --glob '!**/node_modules/**' xinghao-radar/src
rg -n "@deepseek-ai" --glob '!**/node_modules/**' huaqiangbei-workbench/src
python3 -c "import json; d=json.load(open('electronics-agent-platform/tests/phase82/live-results.json')); print(sum(1 for r in d['results'] if r.get('pool')=='production'), '/', len(d['results']))"
```
