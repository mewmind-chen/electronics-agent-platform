# Electronics Agent Plugin v0.1.0 RC — Evidence

Date: 2026-08-24

Radar / Workbench / Platform Contract / Runtime / Router / Model Policy / 内部 `dsh-*` 未修改。

## Verdict

`electronics-agent` **v0.1.0** 已从「本机验证成功」收成可重复安装的 Release Candidate。不接 Radar / Workbench。不新增业务能力。

## Version

| 项 | 值 |
|---|---|
| Plugin | `electronics-agent` **0.1.0** |
| Platform Contract | 未改（仍为 0.3.1） |
| 对外 Tool | 仅 `part_research` / `import_extract` / `company_research` |

## 一、包审计

| 项目 | 当前状态 | RC 是否可接受 | 是否需要修改 |
|---|---|---|---|
| `manifest.json` | 三 Tool、env 配置名、`database:false` | 是 | 否 |
| `package.json` | `0.1.0`，`files` 白名单，peer 由 Harness 提供 | 是 | 已加 `files` + optional peer |
| `apply()` / entry | `src/index.js`，`inject: ["tools","skills"]` | 是 | 否 |
| Tools | 仅三个 HTTP 适配器 | 是 | 去掉 localhost 静默 fallback |
| Skills | `skills/*.md` 三份，`user-invocable` | 是 | 否 |
| Presentation | `src/present.js`，不 import Core | 是 | 配置失败显示「调用失败」 |
| Config | 只读 `AGENT_API_URL` / `ELECTRONICS_AGENT_PLATFORM_TOKEN` | 是 | 缺省返回明确错误码 |
| Dependencies | 无 `@electronics/*`、无 `dsh-*` | 是 | 否 |
| README | 13 节（含限制与排障） | 是 | 已按 RC 整理 |
| Checkout 开发文件 | `jsonrpc.cordis.yml`、`scripts/live-harness.mjs`、`.dsh/skills/` | **不进 tarball** 则可接受 | 不删，方便仓内验证 |
| 测试 / live-results | `tests/` | 不进发布包 | 否 |
| 生成物 | `*.tgz` gitignore | 是 | 否 |

禁止项检查（发布包与 Plugin 运行时代码）：

| 检查 | 结果 |
|---|---|
| import Platform 内部 package / Domain Core / contracts | 无 |
| import `dsh-part` / `dsh-import` / `dsh-company` | 无 |
| Radar / Workbench 代码 | 无 |
| 绝对本机路径 `Users/…` | 无（代码与 README） |
| 硬编码 `~/.dsh/profiles/desktop` | 无（README 仅说明 `~/.dsh/profiles/<name>`） |
| token / API key 字面量 | 无 |
| 测试临时 `--patch` 提交进仓 | 无 |
| desktop credentials 复制进包 | 无 |
| pnpm store 路径写入 Plugin | 无 |

## 二、对外边界

冻结为：

1. `part_research` → `POST /v1/parts/research`
2. `import_extract` → `POST /v1/import/extract`
3. `company_research` → `POST /v1/companies/research`

无 `/v1/chat` Tool、无 Vision 专用 Tool、无 Radar/Workbench Tool、无 Supervisor / Multi-Agent。图片仍走 `import_extract` + `sourceType=image`。

## 三、配置

- manifest / Skill / Tool 参数不收 token
- 日志与错误经 `redact()`，不回传完整 `Authorization`
- 未设 `AGENT_API_URL` → `configuration_error`（**无** `127.0.0.1:8787` fallback）
- 未设 `ELECTRONICS_AGENT_PLATFORM_TOKEN` → `authentication_configuration_error`

## 四、Desktop / headless pnpm store

判定：**B. Harness / Desktop（及 headless profile）环境问题**，不是 Plugin 架构问题。

本机 PATH `pnpm` 为 **v10**（store v10）。`~/.dsh/profiles/headless` 原 `node_modules` 链接 **store v11**。直接 `dsh plugin add/remove` → `ERR_PNPM_UNEXPECTED_STORE`。

Plugin **没有** `packageManager`、没有 store 路径。`@deepseek-ai/dsh-tools` 标为 optional peer（Harness 已提供），避免 add 时去拉一份工具包；**不能**用 Plugin 绕过 profile 的 store 主版本。

最小处理：用与 profile store 主版本一致的 pnpm 跑 `dsh plugin`（本机验证用 PATH 前置 `pnpm@11.23.0`）。不要改用户全局 pnpm，不要把 store 路径写进本包。

## 五、credentials / `--patch`

判定：**B. Harness Desktop / CLI credentials 兼容问题**。

GUI 文档 `~/.dsh/.credentials.yaml` 为 `version` + `refs` 映射。当前 `dsh-credentials-local` 要求扁平 `KEY: string`。`dsh --dump-config` 仍可加载 Plugin 层；完整 boot 在 credentials apply 时失败。Plugin 在失败**之前**已经 `plugin loaded`。

- 不修改 Plugin 架构
- 不把 credentials 复制进仓库
- 不提交临时 patch
- 本机 live 使用未入库的 `/tmp` `--patch`（扁平 credentials + 默认模型）。原 GUI credentials **未改**

## 六、Presentation

`src/present.js` 只展示：

- 配置错误 → `# 调用失败`，不当成功报告
- `vision_unavailable` → `# 导入失败`，零候选
- MPN / ImportCandidate 单元格原样
- `evidenceId` 以 `〔id〕` 保留
- 无 evidence 的公司字段保持未知，不编造联系人/注册资本

Harness 模型可能把 markdown **改写成列表**，但不得把失败包装成成功、不得贴完整 Tool JSON。见 transcripts。

## 七、三场景（正式 Plugin RC + 官方 CLI）

Agent API：`http://127.0.0.1:18731`（本机验证进程，非发布配置）。

CLI：`dsh --profile headless`（不是 Phase 11 `DeepSeekHarness` SDK）。

实录：`tests/plugin-rc/transcripts/`。

### 场景 1 — 分析 TPS54560DDAR

| 项 | 值 |
|---|---|
| 链 | Harness → electronics-agent → `part_research` → `POST /v1/parts/research` |
| HTTP | **200** |
| mpn | `TPS54560DDAR` |
| 用户可见 | 型号分析报告；厂家/分类/封装证据不足；公开市场**未知** |
| 非 Tool JSON | 是 |

### 场景 2 — 上传报价图片并识别

| 项 | 值 |
|---|---|
| 链 | `import-analysis` → `import_extract` → `POST /v1/import/extract` `sourceType=image` |
| HTTP | **422** |
| error | `vision_unavailable` |
| candidates | **0** |
| 用户可见 | 明确失败；禁止伪造 |

### 场景 3 — 分析供应商 TI

| 项 | 值 |
|---|---|
| 链 | `company-analysis` → `company_research` → `POST /v1/companies/research` |
| HTTP | **200** |
| evidence | 0 |
| 用户可见 | 类型/主品牌/热门型号未知；不编造联系人、注册资本 |

工具直连（无 LLM）同样三条 HTTP，见 `tests/plugin-rc/live-results.json`。

## 八、安装 / 卸载 / 重装

Profile：`headless`（避免把 Desktop GUI 当循环靶）。证据：`tests/plugin-rc/install-cycle.log`。

| 步 | 结果 |
|---|---|
| PATH pnpm v10 `remove` | `ERR_PNPM_UNEXPECTED_STORE`（记录兼容原因） |
| pnpm 11 `remove` | dump-config **无** `electronics-agent`；`node_modules` 副本不存在 |
| `add file:./electronics-agent-plugin` | dump-config `id: electronics-agent`；apply 注册 3 tool + 3 skill |
| 再次 `remove` | 插件层消失 |
| 再次 `add` | 再次加载成功，tools/skills 仍为那 6 个名字 |

结论：成功不依赖「上次残留的半安装状态」。

Desktop 仍保留 Phase 12 的已安装副本；本阶段循环在 headless 上证明可重复。

## 九、npm pack

```text
electronics-agent@0.1.0
13 files / ~33.9 kB unpacked

README.md
cordis.patch.yml
manifest.json
package.json
skills/{company,import,part}-analysis.md
src/{index,present}.js
tools/client.js
tools/{company_research,import_extract,part_research}/index.js
```

未包含：`node_modules`、`jsonrpc.cordis.yml`、`scripts/live-harness.mjs`、`.dsh/`、credentials、`.env`、测试、Radar/Workbench、Platform Core、内部 `dsh-*`、`.git`。

## 十、冻结层

对本仓冻结路径 `git diff` 为零（见本阶段结束时的命令输出）。Radar / Workbench 为独立仓，本阶段未打开、未接入。

## 十一、测试

`npm test`（含 `tests/plugin-rc/*.test.mjs`）本次结果：

**150/150 pass，0 fail。**

基线 141（至 Phase 12）+ RC 9 项（配置错误、pack 白名单、secret/path 扫描、presentation lossless）。未为通过而放宽原有约束。
