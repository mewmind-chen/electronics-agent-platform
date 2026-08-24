# 最终验收证据（原始方案 §37）

对照《Electronics Agent Platform 最终实施方案》第 37 节 14 项验收标准，逐项出具证据。更新日期：2026-08-24。

## 1. 新仓库实际运行官方 DeepSeek Harness

✅ 通过。

- `runtime/jsonrpc.cordis.yml` 使用官方 `@deepseek-ai/dsh-sdk-jsonrpc-server`；`apps/agent-api` 通过 `@deepseek-ai/dsh-sdk-client` set
- 实测：`tests/phase9/live-chat.json` `viaHarness=true`、`toolsCalled=["part_research"]`
- `scripts/live-qualify.mjs` 逐模型走 `DeepSeekHarness.run`（结果 `tests/phase82/live-results.json` 7/9 production）

## 2. Agent API 与 Harness Runtime 解耦

✅ 通过。

- `apps/agent-api/src/runtime.js` 只经 `DeepSeekHarness`（resolveJsonrpcBin/CORDIS_PATH）封装 Harness；业务 handler 在 `research.js` 只拿结果
- `mode=auto|agent|core`：core 模式 `harnessStarts=0`（tests/phase8/execution-mode.test.mjs、tests/phase9/part-agent.test.mjs）
- Harness 进程由 `dsh-jsonrpc-agent` 启动，`apps/agent-api` 从不直接调 DeepSeek API

## 3. xinghao-radar 不依赖任何 Harness 内部类型

✅ 通过。

- `grep -rn "@deepseek-ai" src/`（排除 node_modules）→ 无
- Radar 只消费 `/v1/parts/research`、`/v1/import/extract` 的 contract 形状（`src/lib/server/agent-platform.ts`）

## 4. Workbench 不依赖任何 Harness 内部类型

✅ 通过。

- `grep -rn "@deepseek-ai" src/` → 无
- Workbench 经 `researchViaPlatform` 调 `/v1/*`，结果映射为本地类型（`src/lib/search/platform-contract.ts`）

## 5. Import 返回 Candidate，不直接写库

✅ 通过。

- `packages/contracts` `rejectWriteSemantics` 拒绝 `confirmImport / INSERT / sql`；`packages/import-core` 只产出 `ImportCandidate[]`
- Radar `candidateToImportRow` 只把 candidate 转成 Preview 行，正式入库走业务层确认（Radar `confirmImport` 语义保留在 Radar）
- 测试：`packages/contracts/src/contracts.test.js` "import candidate rejects preview/write flags and SQL"

## 6. Part Research 每个核心 Claim 有 Evidence

✅ 通过。

- `parsePartResearchResult` 强校验：非 `未知` verdict 的 claims 每条 `evidenceId` 必须存在（`evidenceIdsExist`）
- `packages/part-intelligence-core/src/research.js` 只生成挂 evidenceId 的 claim；未知态 claims=[] 且 state=未知
- Eval：`tests/phase9/part-eval` 21 型号全部验证 claim/evidence 耦合

## 7. Company Research 结果包含来源与置信度

✅ 通过。

- `parseCompanyResearchResult` 输出 `companies / shopRows / evidence / verdict{state,score,confidence}`
- 平台 company eval：`tests/phase10/company-eval/cases.v1.json`（22 例）验证来源与置信度存在性

## 8. Market Sources 不依赖具体业务项目

✅ 通过。

- `packages/market-sources` 无 radar/workbench/xinghao 引用（唯一匹配是注释说明取自 Workbench 抽取）
- `runLookupStep` 通过 request-scoped ctx 注入 key，不 import 任何业务模块

## 9. Credential 不使用模块级全局 mutable state

✅ 通过。

- `packages/market-sources` 无 `let/var requestKey` 全局（grep 无命中）；key 均经 `ctx.firecrawlKey` 请求级传入
- `apps/agent-api/src/research.js` `requestCtx(req, extra)` 每次都从请求构建

## 10. Agent Platform 故障不影响两个业务系统核心功能

✅ 通过。

- Radar `knowledge.ts` 捕获全部异常返回 `{ok:false}`，详情页照常渲染，回退 HQB `/api/agent/lookup.full`
- Workbench `search-panel.tsx` `platformDegradation` → 本地数据 + 提示；`agent-platform.ts` 401/超时/网络错误全部降级
- 既有测试覆盖（phase5 research-api、phase8 execution-mode）

## 11. Harness 可替换而不需要重写业务系统

✅ 通过。

- 业务仓只依赖 contract 形状（`POST /v1/*` 的 JSON），不强 binding 到 Cordis/SDK
- `runtime/jsonrpc.cordis.yml` 是唯一 Harness 配置面，provider/model 经 `packages/model-policy` 决定，替换 Harness 只动 runtime 层
- Phase 8.x 已验证多个 provider（opencode-go/llm）在相同业务 API 下工作

## 12. 有真实业务 Eval 集合

✅ 通过。

- Import：`tests/phase10/import-eval/cases.v1.json`（30 条）
- Part：`tests/phase9/part-eval/cases.json`（21 个真实/对照型号）
- Company：`tests/phase10/company-eval/cases.v1.json`（22 例）
- 三者纳入 `npm test`，当前 `115/115` 通过

## 13. MPN 不允许 AI 自动补全或修改

✅ 通过。

- `assertMpnUnchanged`（contracts）：`mpnRaw` 与 `mpn` 必须一致，禁止补全/改写
- 测试：`contracts.test.js` "MPN must not be auto-completed or rewritten"
- `.dsh/skills/part.md` Hard rules：不补全、不改写 MPN

## 14. 所有高风险结果都允许人工确认

✅ 通过（本批新增）。

- Radar：`migrations/0004_part_analysis_review.sql` + 详情页 接受/拒绝/修正（提交 `ef011a9`）
- Workbench：`migrations/0008_report_review.sql` + 报告区 接受/拒绝/修正（提交 `fbb73e3`）
- 决策由业务系统持久化；Platform 不写正式业务决定

---

## 汇总

| 项 | 结论 | 证据位置 |
|---|---|---|
| 1 官方 Harness | ✅ | tests/phase9/live-chat.json |
| 2 API/Runtime 解耦 | ✅ | phase8/phase9 tests |
| 3 Radar 无 Harness 类型 | ✅ | grep 无命中 |
| 4 Workbench 无 Harness 类型 | ✅ | grep 无命中 |
| 5 Import Candidate 不写库 | ✅ | contracts tests |
| 6 Part Claim 有 Evidence | ✅ | part-eval |
| 7 Company 有来源/置信度 | ✅ | company-eval |
| 8 Market Sources 独立 | ✅ | grep 无命中 |
| 9 Credential 请求级 | ✅ | requestCtx |
| 10 故障不影响业务 | ✅ | 降级测试 |
| 11 Harness 可替换 | ✅ | runtime 配置面 |
| 12 真实 Eval 集合 | ✅ | 三套评测集 115/115 |
| 13 MPN 不补全 | ✅ | contracts tests |
| 14 高风险可人工确认 | ✅（新增） | Radar 0004 / Workbench 0008 |

**14/14 全部通过。**