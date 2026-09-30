# VENDOR — Yazi 快照账目

| 项         | 值                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 上游仓库   | https://github.com/sxyazi/yazi                                                                             |
| 来源 tag   | `v26.9.1`                                                                                                  |
| peeled SHA | `8dd895c695a5950330c2623eb43debf323b60654`(轻量 tag,直指 commit)                                        |
| 引入方式   | `curl` GitHub tag tarball(`temp/yazi-v26.9.1.tar.gz`,1.12 MiB,无上游 git 历史)                          |
| 协议       | MIT(`LICENSE`,Copyright (c) 2023 - sxyazi,原样保留;`LICENSE-ICONS` MIT,Copyright (c) 2023 nvim-tree) |
| 引入日期   | 2026-09-30                                                                                                 |
| 角色       | 终端文件管理器——工作台 files 腿定稿选型;fork 自持:改 UI / 加功能,上游只同步致命修复                       |

## 同步策略

上游只同步**致命 bug 修复与精选功能**,手动 cherry-pick,不做整线追赶。
Yeta 改造(UI/主题改造与工作台集成)后续计划于 `document/roadmap.md`。

## 与仓库其余部分的关系

- **不是根 Cargo workspace 成员**:根 `Cargo.toml` members 显式列 `crates/*`;
  yazi 自带 `[workspace]`(members `yazi-*`,自有 `Cargo.lock`,workspace
  version 26.9.1,rust-version 1.95.0)。在 `yazi/` 内跑 cargo 命令,与根
  workspace 完全隔离。
- **不是 Bun workspace 包**:根 `package.json` workspaces 为 `packages/*` 与
  `python/robomp/web`,glob 不会捞进 `yazi/`(同 `editor/`、`web-ui/`、
  `termide/` 先例)。
- 上游自带 `rustfmt.toml`(hard_tabs/unstable_features)——阻断 rustfmt 向上
  发现 Zeta 根配置,效果同 `termide/rustfmt.toml` 守卫文件,此处为上游原生提供。
- 构建产物走 `yazi/target/`(yazi 自带 `.gitignore` `/target`,根 `.gitignore`
  全局 `target/` 亦覆盖)。

## 修改层清单(对上游 v26.9.1 的全部偏离)

| # | 文件                | 偏离                                                                                    | 原因                                                                                                                                                  | 日期       |
| --- | ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `.github/`(目录) | 上游 `.github/` 不随树(tarball 解压后排除,未复制)                                   | 仓库硬规则:子目录绝不携带 GitHub workflow(GitHub 只执行仓库根 workflow)                                                                            | 2026-09-30 |
| 2   | `rust-toolchain.toml` | 上游 v26.9.1 不带 rust-toolchain 文件(全树 find 核验);**若未来 bump 引入,一律删除** | 工具链由仓库策略管理(根 `rust-toolchain.toml`),禁止 rustup 静默下载;在 `yazi/` 内本地构建时用 `RUSTUP_TOOLCHAIN` 覆盖                              | 2026-09-30 |

## bump 流程

1. `git ls-remote --tags --sort=-v:refname https://github.com/sxyazi/yazi | head -5`
   确认新 tag 名与 peeled SHA;
2. `curl -fL --retry 5 https://github.com/sxyazi/yazi/archive/refs/tags/<tag>.tar.gz
   -o temp/yazi-<tag>.tar.gz` 并解压到 `temp/yazi-<去 v 的 tag>/`(本机网络下
   git clone 不可用,curl 到 codeload 实测通);
3. `diff -r` 对账本清单修改层,逐项重新应用并登记(`.github/` 排除;
   rust-toolchain 文件存在即删除);
4. 更新本文件 tag/SHA/修改层;单 commit 提交(`vendor: bump yazi to <tag>`)。
