# Electronics Agent Plugin 化前架构审计

日期：2026-08-24  
范围：只读审计。不开发插件，不改 Agent Contract / Runtime / Model Policy / Radar / Workbench 数据边界 / Core。

## 基线

| 仓 | 范围 | HEAD | 工作区 |
|---|---|---|---|
| electronics-agent-platform | `6dc8036` → `25abd63` | `25abd63` | 未跟踪：`package-lock.json`、`eslint.config.mjs/` |
| xinghao-radar | `ef011a9` → `1c32d49` | `1c32d49` | 干净，已与 `origin/main` 对齐 |
| huaqiangbei-workbench | `fbb73e3` → `d8b5869` | `d8b5869` | 干净，已与 `origin/main` 对齐 |

Platform 该范围内两个提交：`058890e`（§37 证据）+ `25abd63`（官方 Vision 图片 Import）。Vision 已在 Platform 智能执行层，不是独立 HTTP 资源。

本审计对照的目标拓扑（尚未实现）：

```text
DeepSeek Harness          用户对话入口
        ↓
Electronics Agent Plugin  能力入口（用户可安装）
        ↓
electronics-agent-platform 智能执行层（Agent API + Runtime + Model Policy + Core）
        ↓
Radar / Workbench         业务事实与业务闭环（写库、确认、降级）
```

当前已落地的拓扑是另一条边：

```text
Radar / Workbench  ──HTTP /v1/*──►  Agent API
                                        ↓
                                 DeepSeekHarness Runtime（进程内）
                                        ↓
                                 内部 dsh-* Tool + .dsh/skills
                                        ↓
                                 import-core / part-core / company-core
```

两条边可以共存。Plugin MVP 只能新增「Harness → Plugin → Agent API」，不能把 Radar/Workbench 或内部 dsh-* 搬进用户桌面。

---

## 1. 当前架构位置

### 已经稳定的分层

| 层 | 位置 | 角色 | Plugin 化时 |
|---|---|---|---|
| Agent Contract | `packages/contracts` `CONTRACT_VERSION=0.3.1` | 唯一共享类型边界 | **冻结，插件只吃合同** |
| Core | `import-core` / `part-intelligence-core` / `company-intelligence-core` / `market-sources` | 确定性校验与公开源 | **不进用户插件** |
| Agent API | `apps/agent-api` | 鉴权、合同门、任务、HTTP | **插件的唯一后端** |
| Runtime + Model Policy | `runtime/` + `packages/model-policy` | 官方 Harness 进程、选模型 | **插件不直连** |
| 内部 Tool Plugin | `packages/dsh-*` | Runtime 进程内 `defineTool` | **保持 A，不发布为 B** |
| 业务闭环 | Radar / Workbench | 写库、人工确认、降级 | **不复制进插件** |

原始方案 §18 还列了 `dsh-electronics-bundle/`。仓库里 **没有这个包**。那才是用户可安装 Electronics Agent Plugin 该出现的位置。

### 原则核验

- Radar / Workbench 的 `src/` **零** `@deepseek-ai` / `dsh-*` 引用；只打 `AGENT_API_URL` + `ELECTRONICS_AGENT_PLATFORM_TOKEN`。
- Platform **不持有**业务库凭证；合同拒绝 `confirmImport` / `sql` / `writeDb`。
- Vision 走 Import `sourceType: "image"` + `deepseek-v4-flash-vision-exp`，没有单独 vision 路由。
- Long Import 已排除出产品范围；PDF/Word 保持 `agent_unavailable`。

---

## 2. Platform 对外能力

`apps/agent-api/src/index.js` 实际路由（用户问题里的 `/v1/company/research` **不存在**，正确是复数）：

| HTTP | 状态 | 是否适合作为 Plugin Tool | 说明 |
|---|---|---|---|
| `POST /v1/chat` | 已实现且有合同门 | **不适合** | Harness 已是对话入口。再调 chat 会二次编排；且 `runChat` 只识别 `part_research` intent，import/company/vision 走不通。 |
| `POST /v1/parts/research` | 稳定 | **适合** | 输入 `mpn`；输出 `PartResearchResult`；不写库。 |
| `POST /v1/import/extract` | 稳定（含 Vision） | **适合** | `sourceType` 含 `image`；Candidate only；无 vision 模型时 `error: vision_unavailable` + 空 candidates。 |
| `POST /v1/companies/research` | 稳定 | **适合** | 输入 `company`；输出 `CompanyResearchResult`。 |
| Vision 专用接口 | **不存在** | **不要新建** | 插件把附件映射为 import extract 即可。 |
| `GET /health` | 稳定、公开 | 适合探活，不是业务 Tool | 不含 token / 业务上下文。 |
| `POST /v1/hello` | 探活 | 不适合产品 Tool | Phase 1 探针。 |
| `POST/GET /v1/tasks*` | 稳定异步面 | MVP **不必**暴露 | 同步 research 已够；任务是加长作业，不是能力入口。 |
| `GET /metrics` | 运维 | 不适合用户插件 | |

鉴权：`/v1/*` 在配置了 `AGENT_API_TOKEN` 时要求 `Authorization: Bearer`。错误码已可给插件消费：`unauthorized`、`contract_error`、`rate_limited`、`vision_unavailable`、`agent_unavailable`、`unsupported_intent`。

### 哪些已经稳定 / 需要冻结

**已稳定、Plugin MVP 应冻结：**

- `POST /v1/import/extract`
- `POST /v1/parts/research`
- `POST /v1/companies/research`
- Bearer 鉴权与 `422 { ok:false, error:"contract_error", errors:[{path,message}] }`
- Import 图片路径：`sourceType=image` + `fileBase64` / `mime`；失败码 `vision_unavailable`
- 响应不得含 `confirmImport` / `selected` / `duplicate`

**保持存在、不对用户插件承诺：**

- `/v1/chat`、`/v1/hello`、`/v1/tasks*`、`/metrics`
- `modelRoute` / `viaHarness` 为观测字段，插件可忽略，不要当业务合同

**不要为 Plugin 冻结或新增：**

- 独立 `/v1/vision/*`
- Long / PDF 生产能力
- 新模型、Router、Supervisor

Radar 已把表格/文本/图片导入打到 `/v1/import/extract`；Workbench 只打 part/company research。插件应与这条 HTTP 面对齐，而不是对齐各自 UI。

---

## 3. Contract Freeze Report

`packages/contracts` 声明自己是 Radar、Workbench、dsh-*、agent-api 的唯一类型边界。对 Plugin 同样成立：**插件只依赖合同 JSON，不依赖 Core 或 Harness 类型。**

| 合同 | 输入是否明确 | 输出是否稳定 | 错误是否明确 | 不写业务库 |
|---|---|---|---|---|
| `ImportCandidate` / `parseImportRequest` | 是。`kind`、`sourceType∈excel\|csv\|pdf\|word\|image\|text`、可选 `text`/`fileBase64`/`mime` | 是。无 preview 旗标；MPN 仅 NFKC/trim | 解析失败走 `errors[]`；运行时另有 `vision_unavailable` | 是。`rejectWriteSemantics` + 禁止 `confirmImport` |
| `PartResearchResult` / `parsePartResearchRequest` | 是。必填 `mpn` | 是。claim 必须带已存在的 `evidenceId` | 合同 422；Runtime `agent_unavailable` | 是 |
| `CompanyResearchResult` / `parseCompanyResearchRequest` | 是。必填 `company` | 是。品牌/型号声明绑 evidence | 同上 | 是 |
| `Evidence` / `Claim` / `Verdict` | 是 | 是。`sourceFailureIsNotEvidence` | 缺 evidenceId 即合同失败 | 是 |
| `Task` | 是。仅 `part_research` / `company_research` | handle/status/event 稳定 | `task not found`、容量 503 | 是；任务库不是业务库 |
| `AgentRequest` / `AgentResponse` | chat 专用 | **偏窄**：intent 只有 `part_research\|unsupported` | `unsupported_intent` | 是 |

### 冻结建议

1. **冻结 `CONTRACT_VERSION` `0.3.1` 作为 Plugin MVP 对端版本。** 插件启动可先读 `/health.contractVersion`，不匹配则拒绝调用。
2. **冻结三份业务结果的字段集**（ImportCandidate / PartResearchResult / CompanyResearchResult / Evidence），含 MPN 不得改写。
3. **冻结错误信封**：HTTP 401/422/429 + body `error` 字符串；Import 空结果必须带 `error`，禁止用假 candidates 填空。
4. **不要把 `/v1/chat` 的 AgentResponse 当作插件主合同。** 它覆盖不了 import/company/vision。
5. **不要把 `firecrawlKey` 写进用户插件 Tool 参数。** 内部 `dsh-part` / `dsh-company` 目前把该字段暴露给 `defineTool`；那是 Runtime 内部实现，不是用户合同。密钥只留在 Agent API 请求作用域（`x-firecrawl-key` / 环境变量）。
6. 合同里仍允许 `holderQty` / `cost` 等调用方可选字段；用户 Harness 对话默认 **不传**内部库存/询价上下文。缺上下文时执行层仍应返回公开研究 + 空内部 advice，这与现有 Context 规则一致。

### 合同层已知缺口（不否决冻结，Plugin 实现时避开）

- `validateSkillSop` 目前只锁了 `.dsh/skills/part.md`。`import.md` / `company.md` / `hello.md` 未按同一 SOP 标题集测试。用户可调用 Skill 若要随插件分发，需要单独写插件 Skill，而不是直接打包这三份内部 SOP。
- `AGENT_INTENTS` 未覆盖 import/company；这是 chat 的限制，不是 extract/research 的限制。

---

## 4. Harness 对接边界

设计目标：

```text
DeepSeek Harness → Electronics Agent Plugin → Agent API
```

### 当前 Skill / Tool / Runtime 是否满足「插件需求」

| 部件 | 现在做什么 | 对用户插件 |
|---|---|---|
| `.dsh/skills/{hello,import,part,company}.md` | Platform Runtime 里的官方 Skill；`user-invocable: true` | 不能当安装入口。它们教模型调用 **进程内 tool 名**，不教调用 HTTP。 |
| `dsh-import/part/company/hello` | Cordis `apply(ctx)` + `defineTool`；被 `runtime/jsonrpc.cordis.yml` 挂进 **Platform 的** JSON-RPC 进程 | 满足内部编排，不满足用户安装。 |
| `apps/agent-api` Runtime | `DeepSeekHarness.run` + Model Policy | 继续当执行层。插件 **禁止**再起一套 Harness 打 Core。 |
| Radar / Workbench | HTTP 客户端 | 禁止复制进插件。 |

进程内 Tool 与用户插件 Tool 不能是同一个包：

- 内部 Tool：`part_research` → 直接 `researchPart()`（Core）。
- 用户插件 Tool：`electronics_part_research`（名称待定）→ `POST /v1/parts/research`。

若把内部 dsh-* 装进桌面 Harness，会绕过 Agent API 的鉴权、合同门、Model Policy 和请求级密钥，并在用户机器上重复加载 Core / 连接器。这违反原始方案 §6（领域核心不进 Harness Plugin 实现）和本次「不要复制业务仓」的红线。

### 已具备、可复用的对接条件

- 官方 `defineTool` / `apply(ctx)` / `inject: ["tools"]` 形态已在内部跑通。
- 稳定 HTTPS 合同已存在；业务仓已是先例客户端。
- 图片 Import 已在执行层打通；插件只需传 `sourceType: image` 与图像字节。
- 权限边界清晰：插件需要的是 **出站网络 + Bearer**，不需要业务 DB、不需要 `danger-full-access`。

---

## 5. 当前 dsh plugin 判定

**结论：全部属于 A。内部 Tool Plugin。不是 B。用户可安装 Electronics Agent Plugin。**

| 包 | 形态 | 判定 |
|---|---|---|
| `@electronics/dsh-hello` | `private: true`；`package.json` 写了 `dsh.bundle.patch`，但 **没有** `cordis.patch.yml` | A，探活 |
| `@electronics/dsh-import` | `private: true`；`file:` 依赖 import-core；无 bundle patch | A |
| `@electronics/dsh-part` | `private: true`；直接调 part-core；Tool 参数含 `firecrawlKey` | A |
| `@electronics/dsh-company` | 同上，company-core | A |
| `dsh-electronics-bundle` | **不存在** | 原方案 §18 的 B 位空缺 |

相对 B，缺少的层：

| 缺失层 | 现状 |
|---|---|
| 用户可安装 bundle | 无 `dsh.bundle.patch` 可用的组合包（hello 声明了文件却缺失） |
| plugin metadata | 无面向 profile 的显示名、能力列表、对端 `CONTRACT_VERSION` |
| user entry | 无随插件分发的 Skill（现有 Skill 只在 Platform 仓库 `.dsh/skills`） |
| install structure | 不能 `dsh plugin --profile <name> add …`；现包是 workspace `file:` 依赖 |
| permission | 未声明「只允许访问 Agent API」；内部 Tool 反而把爬虫密钥暴露给模型参数 |
| HTTP 后端绑定 | 内部插件不读 `AGENT_API_URL`；它们就是后端 |

官方 DSH 用户插件的安装面是 profile 组合包：`package.json` 的 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，由 `dsh plugin --profile …` 装进 `$DSH_HOME/profiles/<name>`。当前 electronics 包没有走通这一层。

---

## 6. 未提交文件（不提交）

### `package-lock.json`（仓库根）

**不应进入 main。**

- CI 明确写了：本仓库还没有经审查的根 lockfile，禁止打开 npm cache（`.github/workflows/ci.yml`）。
- `.dockerignore` 排除 `package-lock.json`；镜像用 `npm install --ignore-scripts`。
- 该文件把宿主机路径编进 lock：`../../../../.dsh/profiles/desktop/node_modules/dsh-plugin-subscriptions`。这是本机 DSH desktop profile 泄漏，不是可复现的仓库依赖图。
- 用户原有未跟踪文件；交接规定禁止误提交。

将来若要锁依赖，应在干净工作区重新生成、审查 workspace 图后再单独决策。本次不要提交。

### `eslint.config.mjs/`

**不应进入 main。应视为事故目录。**

- 这是 **目录**，不是 ESLint 配置文件。
- 内含嵌套 `.git`，没有有效 eslint 内容。
- 提交会污染树，并可能把无关 git 元数据带进主仓。

不要提交。本地应删除该目录（本次审计不执行删除）。

---

## 7. 已具备 Plugin 条件

1. 智能执行层可经稳定 HTTP 调用，不暴露 Harness Web Server。
2. 三份业务能力（import / part / company）输入输出可解析、禁止写库、错误可区分。
3. Vision 已并入 import，插件不必等新 API。
4. Radar / Workbench 已证明「只做 HTTP 客户端」可行，且故障可降级。
5. 内部 Harness 路径（Skill + dsh-* + JSON-RPC）已在 Platform 侧跑通，执行层不用为插件重写。
6. 合同版本号已存在，可作插件对端协商。

## 8. 缺失能力

1. **用户可安装的 Electronics Agent Plugin 包**（原方案 `dsh-electronics-bundle`）。
2. **Plugin → Agent API 的 HTTP Tool**（而不是进程内 Core Tool）。
3. 随插件分发的用户 Skill（教模型调插件 Tool，不教调 `part_research` 内部名）。
4. 安装元数据：`cordis.patch.yml`、profile bundle 声明、设置项（`AGENT_API_URL`、token）。
5. 权限模型：仅网络访问 Agent API；密钥不进 Tool 参数。
6. 探活：插件应打 `/health` + 鉴权失败可理解，而不是安装内部 `hello_ping`。
7. （非阻塞）chat 合同过窄、内部 Skill SOP 未全部冻结——插件自己带 Skill 即可绕开。

## 9. API 冻结建议

Plugin MVP 只承诺下面三张业务面 + 探活：

```text
GET  /health
POST /v1/import/extract
POST /v1/parts/research
POST /v1/companies/research
```

冻结规则：

- 路径、方法、Bearer、合同 parser、写库禁令、`vision_unavailable` 语义，下一阶段不得为插件改名或拆 vision 路由。
- `/v1/chat` 不进入插件 Tool 表。
- 不新增模型、不改 Router、不改 Runtime 选路。

## 10. Contract 冻结建议

- 冻结 `0.3.1` 的 Import / Part / Company / Evidence 解析器行为。
- 插件请求：`mode: "auto"`，不要 `modelMode: "fixed"`（那会把模型选择漏到桌面）。
- 插件响应：只把合同业务字段展示给用户；`viaHarness` / `modelRoute` 可选日志。
- 图片：`IMPORT_SOURCES` 已含 `image`，冻结该枚举，不再加 `vision` sourceType。

## 11. 下一阶段是否可以开始 Electronics Agent Plugin MVP

**可以开始 MVP。条件是新包、HTTP 客户端、三 Tool，而不是发布现有 dsh-*.**

建议 MVP 范围（仍不在本次实现）：

1. 新包（例如 `packages/dsh-electronics-bundle`），`private` 可先本地 `dsh plugin` 安装。
2. 三个 Tool：import extract（含 image）、part research、company research → 只 POST Agent API。
3. 一份用户 Skill：何时调哪个 Tool；Hard rules 复制合同禁令（不写库、不改 MPN、不确认导入）。
4. 设置：`AGENT_API_URL` + Bearer；无 firecrawlKey 参数。
5. 不改 Radar / Workbench / Router / 模型池。

明确不做：Supervisor、Multi Agent、Docker/公网部署、Long Import、把 Core 打进桌面。

---

## 最终判断

**当前代码已经适合进入「DeepSeek Harness Electronics Agent Plugin」阶段的后端就绪门。**

它 **还不适合** 把现有 `dsh-import` / `dsh-part` / `dsh-company` 当作用户可安装 Electronics Agent Plugin 发布。

一句话：执行层和合同已经够硬，缺的是能力入口这一层（B），不是再造一套智能后端。
