## [Unreleased]


### Added

- 看板按宿主语言渲染:CLI 的语言设置(或浏览器偏好)注入页面,侧栏、卡片、表头、图例、空状态与日期/数字格式全部跟随;首发简体中文,英文为回退。语言在启动时固定(页面内无切换器),因为看板随 `zetacode stats` 一起启动。
- 「情绪压力」页:判据覆盖卡会区分「已评判 / 正则 / 未评分」——词典未覆盖的语言(如日语、韩语、西里尔文)显示为**未评分**而不是判定为平静。

### Changed

- Improved dashboard responsiveness and efficiency by reducing unnecessary data refreshes and re-rendering, speeding up session synchronization, database access, package imports, and usage, model, and time-series requests, and avoiding repeated downloads of unchanged traces.
- Dashboard requests are now cancelled when no longer needed, improving responsiveness when switching sessions or closing trace views during loading.
- 「情绪压力」的辨识层重做:新增中文与语音输入词典(无词界/不依赖标点,因为中文输入大量来自语音转写,脏话常呈同音字),新增强调信号(全角爆点、叠字、叠词)用于判定“发怒”,并新增**整条消息重复上一条**这一跨语言信号。不再依赖 emoji(用户输入几乎不用,模型才输出);英文词典保持不变。判定提示词改为语言中立,并适配单条消息内中英混杂。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 临时目录过滤保持（测试垃圾不入库）；stats-cli 摘要测试种子适配非 temp 编码目录。

## [1.1.22] - 2026-09-30

- CLI bin 命名(zeta-c)相关提示文案对齐;`zetacode stats` 面板不受影响。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:统计聚合遍历熔断(withStatsSyncLock 文件锁重写)。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步,内部修复。

## [1.1.12] - 2026-09-10

- 同步 worker 选择器与主 CLI 的 `__zeta_worker_*` 家族对齐,修复 stats 子系统无法启动的问题。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline (stats tracking panel updates).

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: `/trace` tracking panel, compaction summary persistence, and stats-sync worker alignment.

## [1.1.5] - 2026-08-26

- 随 1.1.5 版本线对齐发布：OMP v18.0.6 同步未触及本包，无独立功能变更。
