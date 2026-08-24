# Phase 12 — Plugin as the user product entry

Radar / Workbench / Contract / Runtime / Model Policy / Router unchanged.

## Verdict

Electronics Agent Plugin can be installed into a real Desktop profile, loaded by official DeepSeek Harness, and used as a **user** entry (not the Phase 11 SDK launcher). Users see a business report, not raw Tool JSON.

## Presentation layer

Plugin-local `src/present.js` (no `@electronics/contracts` / Domain Core):

User sees, for example:

```markdown
# 型号分析报告

## 基础信息
型号：TPS54560DDAR
厂家：证据不足
…

## 公开市场判断
状态：未知
…

Agent 不写库存、询价或研究报告库。正式落库由业务系统确认。
```

`output.render` + `presentCall` / `presentResult` (`card: 'generic'`). Execute still returns JSON to the tool runtime; the UI/model-facing blocks are markdown.

HTTP client JSON-sanitizes payloads (`JSON.parse(JSON.stringify)`) so Harness lossless-JSON snapshot does not fail on `undefined` keys.

## User scenarios (official CLI, not DeepSeekHarness SDK)

Same plugin, `dsh --profile headless "…"`, Agent API `http://127.0.0.1:18724`.

Transcripts: `tests/phase12/transcripts/`.

### 场景1 — 型号分析

User: `分析 TPS54560DDAR`

- Tool: `part_research`
- Platform: `POST /v1/parts/research` **200**
- User-visible: `# 型号分析报告` with 基础信息 / 公开市场判断 / 供应情况 / 价格趋势 / 内部业务判断 / 综合建议
- Not a raw `{"verdict":...}` dump

### 场景2 — 报价图片导入

User asked to import an uploaded quote image via `import_extract` / `sourceType=image`.

- Tool: `import_extract`
- Platform: `POST /v1/import/extract` **422**
- User-visible: **`vision_unavailable`**, 未生成任何候选行, 未伪造识别结果

A long hang occurred when the prompt embedded a full PNG as base64 (model did not reach the tool). The product failure path was then verified with an image payload the Platform rejects. Live vision harness was not required for this check.

### 场景3 — 公司分析

User: `分析供应商 TI` (company_research only)

- Tool: `company_research`
- Platform: `POST /v1/companies/research` **200**
- User-visible: 公司/类型/主品牌/热门型号均为未知（无 evidence），不编造注册资本或联系人，Agent 不写库

If the model is allowed to use other Harness search tools, it may mix web text with the platform archive. The skill and this prompt tell it not to. That is a Desktop-profile composition risk, not a Platform Core change.

## Automated checks

`tests/phase12/*.test.mjs` plus existing `tests/phase11/*.test.mjs`.

## Not done (by design)

Platform Core, Runtime, Router, Model Policy, publishing `dsh-import` / `dsh-part` / `dsh-company`, Radar / Workbench, Supervisor, Multi-Agent, Docker.
