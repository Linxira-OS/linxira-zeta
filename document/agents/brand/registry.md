<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。逐行品牌面注册表 + 合并后恢复规则。判定分类（SUBSTITUTE/COMPAT/DUAL/OVERTURN）见 document/brand-surface-rules.md。 -->

# Zeta 品牌面注册表（逐行）

> 用法：OMP tag 合并后逐行核对，把被带回的上游值恢复成 Zeta 规范形。
> 分类判定与例外登记正本：`document/brand-surface-rules.md`；
> 机械规则：`scripts/brand/brand-rules.ts`；
> Zeta-only 代码哨兵：`scripts/brand/zeta-sentinels.ts`（`bun scripts/check-zeta-sentinels.ts`，CI check job 强制。
> 该检查强制 `AGENTS.md` 链接的是 `document/merge-review.md`，不是本文件）。

## Zeta Brand Surface Registry (merge-protected)

Zeta owns its product brand surface. Each upstream OMP merge must re-check
this table row by row and restore the Zeta canonical form wherever the merge
pulled an OMP (`π` / `PI_LOGO` / `@oh-my-pi` / `.zeta`) value back in. This is
a hard merge rule — the v18.0.3 merge (c5ceed6285) silently reverted the ζ CLI
brand, which this registry exists to prevent. Mechanical enforcement lives in
`scripts/brand/` (usage: `document/merge-playbook.md`).

| Surface | Canonical | Guard |
|---|---|---|
| CLI 终端标题品牌字符 | `ζ`（title-generator.ts） | 上游重引 `π` 即恢复 + 两测试 |
| CLI welcome/splash/outro 字符画（**2026-10-18 用户定稿，永久冻结**） | 标准工具生成（2026-10-14 规格，`scripts/brand/logo-art.ts`）：mark = FIGlet `ANSI Shadow` 的 `Z`（`Ζ` 的 ASCII 形，即 `ZETA_LOGO`）+ 主行 `Zeta`（`ANSI Shadow`，`ZETA_WORDMARK`）+ 次行 `Linxira-Zeta`（`mini`，`ZETA_SUBLINE`），版本 `v<version>` 在字标下；native/splash 面的字标文本为 `Zeta` / `Linxira-Zeta` | 不接受上游 `PI_LOGO`/`omp` wordmark/π art；`bun scripts/brand/generate-logo-art.ts` 生成、`brand-check.ts` 校验三个常量与生成脚本输出逐字一致（手改一个字符即红）；`brand-rules.ts` MUST_CONTAIN 与 `zeta-sentinels.ts` 同时钉标志与字标的确切行 |
| `icon.omp` unicode 预设（symbols.ts） | `ζ`（ascii 预设 `zeta`） | 重引 `π`/`pi` 即恢复；nerd 预设 `U+F0D57` 保留（v18.0.10 决议） |
| `icon.pi`（symbols.ts） | `π` | 保留——pi-provider 图标非品牌 |
| latex-to-unicode π 条目 | `π` | 保留——数学转换 |
| 配置目录 | `.zeta` / `~/.zeta` | 无 `.omp` 别名 |
| CLI bin 命名(**2026-10-15 定稿：一个包一个 bin**) | `@linxiraos/zeta` 的 bin = `zetacode`（**无别名**）；用户可见文案与 `CLI_BIN_NAME` 一律用 `zetacode`；`zeta://`、`.zeta`、`ZETA_*`、包名、`zeta-cli-*` release 资产名、npm 包名均不变 | **连字符兼容名全删**：`zeta-c`/`zeta-cli` 不再是 bin，也不再出现在文案/垫片/安装文件面（安装脚本装的名字就是 `zetacode`）；裸 `zeta` 名属 `@linxiraos/main` 工作台且**只打印 help**（列出 zetawork/zetacode/zetaide）；`APP_NAME`("zeta") 仍是产品身份(配置根/日志名/归因头/splash)——勿把配置/线值扫成 `zetacode`；sweep 正则须排除 `[\w.-]` 后缀（`zeta-cli-*` 资产名、`zeta-capture-*` 之类文件面不动）；**容器内 CLI 垫片**：`Dockerfile`(pi-base 段)只装 `/usr/local/bin/zetacode` 一个垫片，robomp 按名 spawn 该名字(`ROBOMP_OMP_COMMAND` 的取值/默认，现 `zetacode`)——两侧配对由 `scripts/check-robomp-cli-contract.ts` 钉死(CI `check` job) |
| 伴侣产品 bin(**2026-10-15 定稿：只留三个标准名**) | `zetawork`(`@linxiraos/main`；其 npm bin 为 `zetawork`+裸 `zeta`，裸 `zeta` = 打印 help)、`zetacode`(`@linxiraos/zeta`)、`zetaide`(`@linxiraos/ide`) | **对外只有这三个命令**；连字符兼容名（`zeta-c`/`zeta-cli`/`zeta-work`/`zeta-ide`/`zeta-i`）与旧 editor 名（`zeta-editor`/`zeta-e`/`zetaeditor`）**全部删除**：`@linxiraos/editor` 已无 bin（载荷是 zetawork 内置编辑器的编辑器专用入口 `termide-editor`，按路径被 spawn；TUI 的编辑器走 `zetaide`）；`zeta code` 这类带空格写法不是 bin，任何文案不得出现；**新增** `zetawork web`（本机起 localhost，浏览器里跑**完整** web ui；复用 `zetacode serve` 机器，`zetawork server` 同义） |
| 工作台与 IDE 包 | `@linxiraos/main`(bin `zetawork`/`zeta`，main/ 独立 Rust workspace)、`@linxiraos/ide`(bin `zetaide`，termide npm 面)、`@linxiraos/editor`(**无 bin**，只发平台叶二进制；载荷 = vendored termide 的**编辑器专用入口** `termide-editor`，2026-10-17 接手该包名（npm 1.2.1 仍为 TTT：旧的连字符编辑器 bin + `ttt.exe`；下一次发布切换为 `termide-editor[.exe]`、bin 消失——该包破坏性变更，见其 README）) | 发布链已全接线：ci.yml 发布链经 workflow_call 派发 main/ide/editor-publish.yml（2026-09-30 起，1.1.24 起实际发版）。**平台叶包内嵌的二进制是入库产物**——发版前必须重编并提交（main/npm/*/bin、editor/termide npm 同理），否则原样带出陈旧二进制（v1.1.25 事故：发的是 1.1.23 的 zeta.exe，v1.1.26 补丁修复）；editor 叶包的载荷是 `termide-editor[.exe]`（`cargo build --release --locked -p termide --bin termide-editor`，Windows 侧加 `--target x86_64-pc-windows-gnu`，拷进 leaf `bin/`，见 termide/VENDOR.md），`scripts/ci-release-publish.ts --editor` 在叶包缺载荷时**拒绝发布**而不是发包空壳；release 资产名（`zeta-work-*`/`zeta-ide-*`/`zeta-editor-*`/`zeta-cli-*`）属文件面，保持原样 |
| 内部文档 URL scheme | `zeta://`（唯一；`zeta://docs` 根别名保留） | 出现 `omp://` 即全树 sweep（代码/提示词/docs 语料/测试 fixture）；v18.2.5 起不再保留 alias handler，`brand-check` MUST_NOT_CONTAIN 强制 | 
| **Release 资产名（更新器 ↔ 发布链）** | `zeta-cli-<os>-<arch>[.exe]`（musl: `zeta-cli-linux-musl-*`） | 真源 `packages/utils/src/release-assets.ts`；守卫 `bun scripts/check-release-asset-names.ts`（CI check job）。**资产名不跟 `CLI_BIN_NAME`**——`zetacode` 是命令面，资产保留文件面 `zeta-cli-*`：v1.1.27 更新器按 bin 名拼 `zetacode-<os>-<arch>`，二进制回退下载对每个用户 404（旧版 1.1.27 硬编码 `zeta-cli-*` 反而是对的） |
| npm scope | `@linxiraos/*`（pi-coding-agent→zeta 等） | 上游 `@oh-my-pi/*` 全量改写（driver `OMP_SCOPE` 必须保留 `@oh-my-pi/` 字面量，MUST_CONTAIN 守护） |
| Native 版本机制 | `pi_natives_build_version()` + `__piNativesBuildVersion` 值戳 | v18.3.3 起取代逐版本哨兵名；`check-version-consistency.ts` 钉机制符号而非版本派生名 |
| Native Tokio 安装导出 | `__ompInstallTokioRuntime` | crate/index.js/loader 三方一致；勿 sweep 成 `__zeta*`（v18.0.10 改断，Tokio 静默不装） |
| `/language` `/tracking` | builtin-zeta.ts | 合并后恢复 registry spread |
| 插件清单目录 | `.omp-plugin` | 刻意保留——OMP/Claude 兼容面，勿 sweep |
| 中继/分享 URL | `my.omp.sh` | 共享 OMP 基础设施，不品牌化 |
| **本地服务默认端口（2026-10-24 用户裁定）** | Web UI `43141`、Web Gateway `43143`、Stats `43147`（`packages/utils/src/ports.ts` 为唯一真源） | OMP 与本机常用端口（30141/30142/3847、3000/8080/8787…）必须避开；三者互差 ≥2。守卫 `bun scripts/check-service-ports.ts`（CI check job），desktop 独立壳的 `WEB_UI_URL`/`STATS_URL` 字面量必须同步。合并不得把上游端口默认值带回来 |
| 安装提示 URL | `https://linxira-os.github.io/install.sh`（POSIX）/ `install.ps1`（Windows） | **我们自己的站**（与 `scripts/install.sh`/`install.ps1` 同源，从 GitHub Releases 拉 `zeta-cli-*`）；上游 `omp.sh/install` 不再出现在任何用户可见提示里（2026-10-13 起，`installerHint()` 两侧成对改，见 `cli/update-cli.ts`） |
| **遥测导出（2026-10-10 定稿）** | **硬关闭**：产品门控 `TELEMETRY_EXPORT_ENABLED = false`（`main.ts`），`telemetry.otlpExportEnabled` 设置**已删除**（原先默认 `true`） | 我们没有遥测服务端，无处处理事件——不是默认关，是**没有开关**：任何 `OTEL_EXPORTER_OTLP*` 端点都不导出。三重守卫：MUST_CONTAIN 钉死常量与调用点、MUST_NOT_CONTAIN 禁止设置键复活。等自建采集端后**有意识地**加回，勿在合并中被动恢复 |
| OTLP `service.name` 兜底 | `zeta` | 合并会带回 `oh-my-pi`；用户在自建 OTLP 里看到的身份面 |
| **`OMP_*` 环境变量（2026-10-10 裁定：暂不改）** | 保持 `OMP_*` | **190 个变量、约 2000 处引用**，且多数是 `docs/environment-variables.md` 里文档化的用户配置项。一次性改名会（a）破坏用户现有配置与脚本（b）要求生产者/消费者同时改，漏一处即静默失效（2026-10-10 的 `bin: "omp"` 夹具事故就是这个成因）。正确路径是**读旧写新**的分阶段迁移，需独立方案与守卫后再动。`brand-check` 现有规则**不覆盖** env 名，故合并不会误扫，也不会误报 |
| 品牌残留守卫 | `bun scripts/brand/brand-check.ts`（已进 CI check job） | 机械规则进 `scripts/brand/brand-rules.ts`，散文只留判断 |
| 产品前门（README/logo/名称/主页/安装文档） | Zeta 产品面 | 完整合并后单独 branding-overlay commit |

**启动字符画定稿（2026-10-18 用户裁定）**：`packages/tui/src/prompt/welcome.ts` 的
`ZETA_LOGO` / `ZETA_WORDMARK` / `ZETA_SUBLINE` 与 `scripts/brand/logo-art.ts` 的输出**就是
最终稿，永久冻结**——不再讨论字形美观、不再换字体、不再改宽度或渐变。合并带回了别的画就
按本表恢复；任何"字符画看起来断了/像别的字"的判断一律作废，除非用户**再次明确要求**修改。
判据仍是 `brand-check` 的逐字校验（手改一个字符即红）。

