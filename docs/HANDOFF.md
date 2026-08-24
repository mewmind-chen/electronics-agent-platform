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
- §37 证据：`docs/ACCEPTANCE_14.md`（14/14 架构红线通过；不等于整体落地完成）。

## 三仓库

- Platform：`/Users/ylf/Documents/ChatGPT/工作台研究/electronics-agent-platform`
- Radar：`/Users/ylf/Desktop/型号追踪/xinghao-radar`
- Workbench：`/Users/ylf/Documents/ChatGPT/工作台研究/huaqiangbei-workbench`

## 已提交并推送

Platform（远端 HEAD `6dc8036`）：

- `0e11974` `feat: attach caller business context to research`
- `187dbd3` `fix: enforce agent API production boundaries`
- `b3f6ac9` `build: add secure deployable agent service`
- `8ffb8ae` `ci: install official harness CLI`
- `27e27ad` `test: add import and company eval corpora`
- `a578120` `feat: make agent tasks durable and resumable`
- `619ee0a` `feat: enforce production request boundaries`
- `8b87c7b` `docs: add implementation handoff`
- `36417d6` `fix: secure spreadsheet import dependencies`
- `ef22647` `feat: make business-context advice pluggable`
- `6dc8036` `docs: evidence for all 14 acceptance criteria of the original scheme`

Radar（远端 HEAD `ef011a9`）：

- `8f53974` `feat: inject radar context into part research`
- `5649a97` `fix: harden platform fallback boundary`
- `8655969` `fix: persist part analyses in shared database`
- `33f79c2` `test: isolate radar PWA fixtures`
- `ef011a9` `feat: human accept/reject/correct loop for part analyses`

Workbench（远端 HEAD `fbb73e3`）：

- `800428d` `feat: inject quotation context into part research`
- `c661f06` `fix: isolate platform credentials and fallback`
- `5728bab` `perf: index quotation context lookup`
- `99ffb57` `test: isolate workbench platform fixtures`
- `fbb73e3` `feat: human accept/reject/correct loop for saved reports`

## 当前现场

Platform `main` 已推送 HEAD 为 `6dc8036`。本地全量测试 **115/115**。

根目录仍有未跟踪文件，**禁止误提交**：

- `package-lock.json`（用户原有；不要暂存）
- `HANDOFF.md`（与 `docs/HANDOFF.md` 重复的根目录副本）
- `eslint.config.mjs/`（异常目录，不要当配置提交）

Radar：`npm test` **218/218**，`typecheck` 通过。工作区有人工决定测试补强，尚未提交。

Workbench：脚本测试 **159** + TypeScript **24**，`typecheck` 通过。工作区有 `0009_report_review_correction.sql`（修正正文 `corrected_json`），尚未提交。

## DSH 边界

本机已安装 DSH，禁止重复或全局安装：

- 路径：`/opt/homebrew/bin/dsh`
- 版本：`0.1.0-rc.6`
- 指向：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`

本地验证直接使用现有 `dsh`。CI 若需要 CLI，只允许安装在 GitHub Runner 的临时目录，不得让产品运行时依赖全局 CLI。

## 后续必做

已完成（不要再当待办）：

1. ~~审查并提交 Platform 安全依赖 / CI peers~~ → `36417d6`
2. ~~修复 Radar/Workbench 陈旧 PWA / migration 测试~~ → Radar `33f79c2`，Workbench `99ffb57`
3. ~~`adviseFromContext` 抽成可注册接缝~~ → `ef22647`（默认规则仍在 default adviser 内，接缝已在）
4. ~~人工接受 / 拒绝 / 修正闭环~~ → Radar `ef011a9`；Workbench `fbb73e3` + `0009`（修正正文）
5. ~~出具 14 项验收证据~~ → `docs/ACCEPTANCE_14.md`（第 1/10/11 项已写准确，第 14 项 Workbench 修正已做实）

仍未完成：

1. Vision / Long Import 的生产能力路径与资格验证。现状：9 个绑定模型里 **4 个 production**，`glm-4v-flash` 未过，long 路径超时。Import30 / Part21 / Company22 契约评测已在 `npm test` 中跑过。
2. 将本批三仓提交推送到对应远端。未推送不算完成。
3. 不要用 §37 签字代替整体落地。整体落地还要看 Vision/Long、production 模型池、CI 绿、三仓推送。

## 交接原则

不要用计划、文档或单个演示代替交付。每一阶段都应以可运行代码、自动测试、构建/CI 结果、Git 提交和远端推送共同作为证据。
