# Electronics Agent Platform 交接记录

更新日期：2026-08-24

## 必须保持的初心

> 把 Radar 和 Workbench 中容易变化、无法穷举的业务理解从硬编码里解放出来，形成可插拔、可复用的智能能力；同时把事实、约束、写库和最终决定牢牢留在业务系统与人手里。

这是架构取舍和验收的最高优先级。Platform 只提供可替换的智能能力；Radar/Workbench 保有业务事实、硬约束、持久化、正式业务判断和人工最终决定。

## 目标与执行要求

- 完成原始《Electronics Agent Platform 最终实施方案》在三个仓库的端到端落地，逐项满足 14 项最终验收标准。
- 每批改动完成后先验证，再分别提交并推送对应远端。未推送不算完成。
- 不得覆盖用户原有改动；特别是 Platform 根目录未跟踪的 `package-lock.json`，禁止修改、暂存或提交。
- 原始方案路径：
  `/Users/ylf/Documents/ChatGPT/工作台研究/.dsh-uploads/session-554847dc-04ff-4843-998f-024f2497992b/816dd77a3e7d18d3-Electronics_Agent_Platform_最终实施方案.md`

## 三仓库

- Platform：`/Users/ylf/Documents/ChatGPT/工作台研究/electronics-agent-platform`
- Radar：`/Users/ylf/Desktop/型号追踪/xinghao-radar`
- Workbench：`/Users/ylf/Documents/ChatGPT/工作台研究/huaqiangbei-workbench`

## 已提交并推送

Platform：

- `0e11974` `feat: attach caller business context to research`
- `187dbd3` `fix: enforce agent API production boundaries`
- `b3f6ac9` `build: add secure deployable agent service`
- `8ffb8ae` `ci: install official harness CLI`
- `27e27ad` `test: add import and company eval corpora`
- `a578120` `feat: make agent tasks durable and resumable`
- `619ee0a` `feat: enforce production request boundaries`

Radar：

- `8f53974` `feat: inject radar context into part research`
- `5649a97` `fix: harden platform fallback boundary`
- `8655969` `fix: persist part analyses in shared database`

Workbench：

- `800428d` `feat: inject quotation context into part research`
- `c661f06` `fix: isolate platform credentials and fallback`
- `5728bab` `perf: index quotation context lookup`

## Platform 当前现场

Platform `main` 的已推送 HEAD 为 `619ee0a`。存在一批尚未提交的安全依赖和 CI 改动，必须保留、审查、验证后提交推送：

- `.github/workflows/ci.yml`
- `Dockerfile`
- `apps/agent-api/package-lock.json`
- `packages/dsh-import/package-lock.json`
- `packages/import-core/package-lock.json`
- `packages/import-core/package.json`
- `docs/phase10/SECURITY_DEPENDENCIES.md`
- `tests/phase10/security-dependencies.test.mjs`

这批改动将 `xlsx` 升级为 SheetJS 官方 CDN 的 `0.20.3` 精确包，并增加真实 XLSX 解析回归测试。最近一次 Platform 本地全量测试为 `114/114` 通过；安全/导入定向测试为 `8/8` 通过。Docker 构建在用户中断后没有产生新镜像，提交前需重新完成构建验证。

`619ee0a` 的远端 CI 只在 DSH CLI 缺失 peer dependency 处失败，其余 `111/112` 通过。当前未提交 workflow 已增加明确 peers，需通过新提交的 CI 确认。

## DSH 边界

本机已安装 DSH，禁止重复或全局安装：

- 路径：`/opt/homebrew/bin/dsh`
- 版本：`0.1.0-rc.6`
- 指向：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`

本地验证直接使用现有 `dsh`。CI 若需要 CLI，只允许安装在 GitHub Runner 的临时目录，不得让产品运行时依赖全局 CLI。

## 已知待修复测试

Radar：

- `npm test` 当时为 216 个测试中 209 通过、7 失败。
- 7 个失败都来自 `scripts/grok-pwa-plugin.test.mjs`，原因是测试读取了真实 `src/lib/og/site.json` 和 `public/og.jpg`。
- `typecheck` 和 `build:dev` 通过；应修复测试隔离，不要改坏生产站点语义。

Workbench：

- 脚本测试当时 157 个中 150 通过、7 失败；TypeScript 后续测试 `24/24` 通过。
- 6 个 PWA 失败是同类测试隔离问题。
- `scripts/migration-plan.test.mjs` 有1 个过时断言，它认为不存在业务 migrations，但实际已有 `0002-0007`。
- `typecheck` 和 `build` 通过。

## 后续必做

1. 审查 Platform 未提交 diff，运行定向与全量测试、`git diff --check`、Docker 构建，然后只暂存这一批计划文件，提交并推送，监控 CI 到终态。
2. 分别修复 Radar/Workbench 的陈旧测试，全量测试、类型检查、构建通过后各自提交推送。
3. 将 `packages/part-intelligence-core/src/context.js` 中的 `adviseFromContext` 硬编码 if/else 抽离为能力注册/插件接缝，保持不反向侵入业务数据层。
4. 在 Radar/Workbench 增加人工接受、拒绝、修正闭环，由业务系统持久化最终动作；Platform 不拥有正式业务决定。
5. 完成 Vision/Long Import 的生产能力路径与资格验证，运行 Import30、Part21、Company22 评测集。
6. 按原始方案逐项出具 14 项验收证据，确认所有仓库测试、构建、CI、提交和推送都完成后，才能宣布整体落地完成。

## 交接原则

不要用计划、文档或单个演示代替交付。每一阶段都应以可运行代码、自动测试、构建/CI 结果、Git 提交和远端推送共同作为证据。
