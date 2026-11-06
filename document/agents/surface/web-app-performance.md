# Web-app 渲染性能测量协议（Studio renderer）

作用：给 Studio 渲染器「已知的四项成本」提供可复现的前后对照数字。
页面、采集器、独立构建与静态服务器都在 `web-app/` 内，**产品构建
（`vite.config.ts` / `dist/`）不受影响**。本文的数字只来自真实 Chromium
里跑出来的报告，不接受估算。

被测面与来源：

| 文件 | 作用 |
|---|---|
| `web-app/perf-harness.html` | 测量页（唯一 document） |
| `web-app/src/perf/entry.ts` | 挂载 `perf-harness-entry`（真实 `ConversationPane` + `ConversationMinimap` + `ConversationStore`）与真实 `ChipComposer` |
| `web-app/src/perf/collect.ts` | 页内采集器；`window.__perf.run()` / `window.__perfReport` |
| `web-app/vite.perf.config.ts` | 只以 `perf-harness.html` 为输入，输出 `web-app/dist-perf/`（产物入口改名为 `index.html`） |
| `web-app/scripts/serve-perf.mjs` | `dist-perf/` 的 Bun 静态服务器（loopback + 临时端口） |

---

## 1. 构建与启动

```bash
cd web-app
npx vite build --config vite.perf.config.ts
bun scripts/serve-perf.mjs
# 输出一行：perf harness: http://127.0.0.1:<port>/
```

`dist-perf/` 内含 `index.html`、`assets/` 与图形 vendor 资源。服务器不做
history fallback、不发缓存头（`cache-control: no-store`），端口由系统分配。
复核：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/`
应为 `200`。

---

## 2. 机器与浏览器夹具

同一组 before/after 数字必须在**同一台机器、同一个浏览器版本、同一窗口
尺寸**上采集，并在结果表下方登记。

- 浏览器：Chromium / Chrome ≥ 119（`Promise.withResolvers`、`longtask`、
  `performance.memory`、`PerformanceObserver({type:"paint"})`）。
- 启动参数（全新 profile，排除缓存与后台节流）：

```bash
chrome \
  --user-data-dir="$(mktemp -d)" \
  --no-first-run --disable-extensions \
  --js-flags=--expose-gc \
  --enable-precise-memory-info \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --window-size=1440,900 \
  "http://127.0.0.1:<port>/"
```

- 采集期间关闭 DevTools（DevTools 自身会抬高堆与帧耗时）；等自动跑完后
  再打开 Console 读取报告。
- 记录：CPU、内存、OS 版本、GPU/软件渲染、浏览器完整版本、设备像素比。

---

## 3. 固定场景（fixture）

页面加载后自动跑一次；也可在 Console 里重跑：`await __perf.run()`。

| 场景 | 真实调用 | 说明 |
|---|---|---|
| 500 消息会话 | `ompPerf.reset({ turns: 500, toolsPerTurn: 0, outputLines: 3 })` | harness 的夹具单位是 **turn**，每 turn 灌入一条 user + 一条 assistant：共 1000 个 message item。实际行数记录在 `fixture.rowsAfterSession`。简报里的「500 messages」在 harness 里只能这样表达。 |
| 20 帧流式 | `ompPerf.run({ frames: 20, charsPerFrame: 120, toolLinesPerFrame: 0, toggleEveryFrames: 0 })` | harness 的真实字段是 `toggleEveryFrames`（0 = 不折叠尾部卡）；**没有** `toggleTailCard` 字段。 |
| 滚动 2 s | 在已挂载的 500-turn transcript 上，每帧写一次 `scrollTop`，底部→顶部→底部 | 采样的是 rAF 到 rAF 的真实间隔，包含布局与合成。 |
| 20 次按键 | 向真实 `ChipComposer` 的 contenteditable（`#perf-composer`）插入 20 个字符 | 优先 `document.execCommand("insertText")`，不可用时退化为「插入文本 + 合成 `InputEvent`」；使用路径记录在 `metrics.keystrokeToPaint.method`。 |

Composer 以 fixed 浮层挂在右下角，参与整页测量（与会话 pane 同页）；
两轮各跑一次是刻意的：堆、流式、滚动、按键互不借用上一轮的状态
（流式会继续往当前 store 追加 delta，滚动前会重新 `reset`）。

---

## 4. 六项指标：定义与采集

所有数字都直接来自浏览器 API；API 缺失时该字段为 `null`，并在
`supported` / `notes` / `errors` 里写明原因，**不估算、不补值**。

| # | 指标 | 采集 | 报告字段 |
|---|---|---|---|
| 1 | 加载期 JS 传输字节 | `performance.getEntriesByType("resource")`，取 `initiatorType === "script"`（或 `.js/.mjs`）的 `transferSize` 求和 | `metrics.jsTransferredBytes`（另附 `jsDecodedBytes`、`jsScripts`、`jsCachedScripts`） |
| 2 | 加载后 JS 堆 | `performance.memory.usedJSHeapSize`，读取前若 `globalThis.gc` 存在则强制 GC 两次 | `heap.afterLoadBytes`（`supported.forcedGc` 标明是否 GC） |
| 3 | 打开 500 消息会话后的堆 | 场景 1 完成并等 transcript 进入 idle 后，同一方式读堆 | `heap.after500MessageSessionBytes` |
| 4 | 20 消息流式期间的 long task（> 50 ms） | 场景 2 全程 `PerformanceObserver({ type: "longtask" })`；统计数量、总时长、最大值（只计 `duration > 50`） | `metrics.longTasksDuringStream`（`count` / `totalMs` / `maxMs`） |
| 5 | 输入法按键 → 绘制 | 每次按键记录 `performance.now()`，插入后取「下一个 rAF 之后的首个 task」的时刻相减；20 次取中位数 / p95 / 最差值 | `metrics.keystrokeToPaint`（`medianMs` / `p95Ms` / `worstMs` / `count`） |
| 6 | 500 行 transcript 滚动帧率 | 场景 3 的 2 s 内逐帧间隔：帧率 = 帧数 / 实际时长；另报中位 / p95 / 最差帧间隔与 `> 32 ms` 的掉帧数 | `metrics.scrollFrameRate`（`fps` / `frames` / `medianMs` / `p95Ms` / `worstMs` / `droppedFrames`） |

补充但非六项：

- `paint`：`PerformanceObserver({ type: "paint", buffered: true })` +
  `performance.getEntriesByType("paint")`，记录 `first-paint` /
  `first-contentful-paint`，作为加载基线的上下文。
- `metrics.stream`：harness 自报的帧间隔中位数 / p95 / 最差 / 掉帧 / 停顿帧。
- `buildSwitches`：`performanceOptions` 的三个构建期开关，保证 before/after
  的构建条件可比。

「按键 → 绘制」的口径说明：浏览器没有「任意一次绘制的时间戳」API，
`paint` 条目只有首次绘制/首次内容绘制。这里沿用上游 render-work harness
的输入探针：输入事件时间戳 → 下一个 rAF → 该帧绘制完成后的首个 task。
它测到的是「输入到真正画出来」的完整延迟，而不是 React commit 时间。

---

## 5. 采集步骤

1. 按 §1 构建并启动，按 §2 启动全新 profile。
2. 页面在 `load` 后自动跑六个场景，结果存到 `window.__perfReport`；
   同时派发 `perf-report` CustomEvent。
3. 打开 DevTools Console：

   ```js
   JSON.stringify(__perfReport, null, 2)
   // 或重跑：
   await __perf.run()
   ```

4. **每个 before/after 数据点跑 3 次**（每次全新 profile，或至少
   hard reload + 禁用缓存），确认 `metrics.jsTransferredBytes` 的
   `jsCachedScripts === 0`；缓存命中的那一次丢弃。取 3 次的**中位数**
   填表。
5. 报告 JSON 原样留档（大小约几十 KB），表里只填六项数字。
6. 失败/空值处理：先看 `errors`；`supported.longtask === false` 说明浏览器
   不支持 longtask，`supported.memory === false` 说明缺
   `performance.memory`（不是 0）。环境修好前不要填数。

---

## 6. 结果表（安静机器，背靠背）

> 同一机器、同一浏览器版本、同一夹具。`before` = `temp/perf-baseline/`（四项
> 成本落地前的 `dist-perf` 快照），`after` = 当前构建。两列在同一轮里交替
> 采集：4 个全新标签页（B0/A0/B1/A1，各自独立 document），另加 3 轮同标签
> 页背靠背（B/A 交替）复核中位数。浏览器：Chrome/156 隐藏窗口，1280×900
> @1.25。

| 指标 | 单位 | 基线（before） | 之后（after） | 变化 | 备注 |
|---|---|---|---|---|---|
| 加载期 JS 传输字节 | B | 1,179,208 | 1,180,079 | +0.07 % | 测量台构建，非产品 `dist/` |
| 加载后 JS 堆 | MiB | 5.12 / 5.11 | 5.13 / 5.14 | 持平 | `supported.forcedGc=false`（无 `expose-gc`），只作同条件对照 |
| 500 turns 会话后的堆 | MiB | 9.18 / 9.18 | 9.22 / 9.20 | +0.4 % | 1,001 行 |
| 流式 long task（> 50 ms） | 个 / ms | 1 / 51–52 | **0 / 0** | 消失 | 两轮基线各出现一次 ~51 ms，优化后两轮均无 |
| 按键 → 绘制中位数 | ms | 8.6 / 8.5 | 8.7 / 8.7 | +0.1（噪声内） | p95：基线 9.1 / 8.8，之后 10.9 / 9.2；worst：11.9 / 10.4 → 11.2 / 9.4 |
| 500 行滚动帧率 | fps | 38.0 / 39.8 | 36.8 / 47.5 | 噪声 | 掉帧 35 / 28 → 35 / 24；单次 2 s 采样，离散度大于差异 |

**这一轮的数字必须这样读**：

1. 早期（负载下）记录的那组「long task 11 个 / 3,683 ms / 最大 2,748 ms、
   滚动 7.86 fps、按键 p95 42.1 ms」是**机器被 9 个并行 agent 占满时的采样**，
   不是构建差异；它与本轮同一构建的 8.3 ms / 0 long task 相差三个数量级，
   已从对照表撤下，只在本段留档。
2. 四项成本的收益**不落在这六个指标上**：它们削的是每个事件的
   `JSON` 深拷贝（`MemoryClientTransport.emit`）、每次按键的 chips/缩略图重算、
   `setInterval` 轮询、以及 tier 切换时的整树重排。合成 harness 的 20 帧流式
   与 20 字符按键太轻，clone 与重算的成本进不了 long-task 阈值。
   这四项的证明在同目录单测里：
   - `web-app/src/vendor/client/src/snapshot-clone.test.ts`（同一 snapshot 对象按引用下发）
   - `web-app/src/studio/composer/draftPublish.test.ts`（按键只写 ref，渲染边界才提交）
   - `web-app/src/studio/usage/usagePolling.test.ts`（隐藏页暂停轮询）
3. 仍未测的面：真实会话（长 transcript + 图片 chips）与真机 GPU 合成。
   要拿到可信的「前后差」，夹具需要改成 500 帧流式 + 400 字符拼写，并关掉
   其他负载；这需要扩 `src/perf/collect.ts` 的场景常量。

## 6.0 UI 性能：口径与现状（2026-11-06 用户裁定）

「卡」指 **Work Studio（UI）的性能**：首屏、交互延迟、滚动、内存。不是合成夹具上的
帧率数字，也不是包体积本身——字节只有在 UI 里被下载、解析、驻留时才成为性能问题。

### 现状（已核实）

| 项 | 现在 | 来源 |
|---|---|---|
| 入口 JS | 2,084,533 B（**raw**）；i18n 按需加载后 −5.1% | `vite build` 产物；`curl` 实测 |
| 传输压缩 | **没有**：`studio-web-app.ts` 不发 `content-encoding`，浏览器收原始字节 | `src/server/studio-web-app.ts`（无 `gzip`/`br`） |
| 大 chunk | `mermaid` 3.08 MB、`graphics-xite` 10 MB（解包）——两者都按需加载，首屏不拉 | tarball 清点；`LazyMermaid.tsx` / `x3d-frame.ts` 动态 `import()` |
| 1,001 行合成夹具 | 按键 p95 9.2–10.9 ms；0 个 >50 ms 长任务；堆 9.2 MiB；滚动 36.8–47.5 fps（噪声） | §6 表 |
| 真实长会话 | **未测**：没有 dump 复放，`performance.memory` 在真实负载下从未采样 | — |
| 内存预算 | 未进 CI；目标见下表 | 本文 |

### 判据（在真实 dump 上测）

| 判据 | 目标 |
|---|---|
| 按键 → 绘制 p95 | ≤ 16 ms |
| 滚动帧率（1440p） | ≥ 50 fps；无 GPU 合成时 ≥ 40 fps 通过 |
| 长任务 | 不得出现 > 100 ms；> 50 ms 计次 |
| 内存 | 每 1,000 事件增量 ≤ 8 MB；5,000 事件会话 JS 堆 ≤ 120 MB |

### 为什么现有数字不算数

1,001 行短文本只有 ~9 MiB 堆，而体感来自长会话（数千事件、工具体、图片 chips、
多会话切换）。合成夹具只证明"没有回归"，不证明"不慢不胀"。

### 执行顺序（取消此前的"暂不排期"）

1. **先取真实样本**：导出一个长会话的 `/api/v1` 响应 dump（`session.transcript` /
   `agent.conversation` 的分页结果），放进 `temp/`，不进仓库。
2. **再复放**：用现有 harness（`web-app/src/studio/perf/`）按 dump 重放四项判据，
   确认慢在加载、渲染还是 GC。
3. **然后按证据改**，优先怀疑四处：**静态服务无压缩**（确定项）、整段 transcript 驻留
   内存、每个事件一份快照、以及 10 MB 的 x_ite 面板在弱机上首次打开。
4. **CI 只守可确定的部分**：入口字节数与单 chunk 上限；内存/延迟不进 CI（噪声会变假红），
   但发布前按第 2 步复放一遍并登记。

原写的"有人报告卡顿"没有数据源（`TELEMETRY_EXPORT_ENABLED = false`，产品不上报遥测），
已删除；问题不靠用户报告触发，靠第 1 步的样本被动暴露。

## 6.1 运行登记

| 项 | 值 |
|---|---|
| 分支 / 工作树 | `feat/web-ui-studio-migration`（`temp/web-ui-studio`，未提交） |
| 采集日期 | 2026-11-05（第二轮：安静机器，背靠背） |
| OS / CPU | Windows 10.0.26300 x64，开发机 |
| 浏览器 | Chrome/156.0.0.0，omp 托管 Chromium，隐藏窗口 |
| 窗口 / DPR | 1280 × 900 / 1.25 |
| 基线构建 | `temp/perf-baseline/`（四项成本前的 `dist-perf` 副本） |
| 报告存档 | `temp/perf-fresh-baseline.json`、`temp/perf-fresh-after.json`、`temp/perf-final-{baseline,after}.json`（同标签页 3 轮） |
| `buildSwitches` | `boundedMermaid=true` / `highlightWorker=true` / `backgroundPublishing=true` |

## 7. 判读规则

- **同条件才可比较**：不同机器、不同浏览器版本、不同窗口尺寸的数字不能
  放进同一张 before/after 表。
- 六项里堆与 long task 噪声最大：先确认 `supported.forcedGc === true`
  （否则堆偏高）、确认采集期间没有其他标签页/后台任务。
- 帧率上限由显示器决定：144 Hz 屏的 120 fps 不等于「比 60 Hz 屏的 90 fps
  更好」，只能同屏对比。
- 任何指标为 `null` 时，先修采集环境；不要把 `null` 当 0 或当成通过。
  `notes` 会写明缺的是哪个 API（`memory` / `longtask` / `paint`）。
- 已知偏差（写进基线备注，避免误读）：
  1. 「500 messages」夹具实际是 500 turns → 1000 个 message item；
  2. 流式选项是 `toggleEveryFrames`，不是 `toggleTailCard`；
  3. 滚动/按键场景里 composer 浮层与会话 pane 同时在页面上；
  4. 按键到绘制的终点是「下一帧绘制后的首个 task」，不是像素级时间戳。

---

## 8. 扩展

新增指标时只改 `web-app/src/perf/collect.ts` 的对应场景与
`PerfReport` 字段，并在 §4 / §6 各加一行；不要改动
`web-app/src/studio/**` 的产品行为（`src/perf/` 是唯一新增面）。
