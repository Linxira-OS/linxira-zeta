# Studio 界面设计检查表（web-ui 产品面）

作用：`web-ui/components/studio/**` + `web-ui/styles/studio/**` 的视觉验收标准。
每次改动产品面照此自查；判据可被 `scripts/check-style-literals.mjs` 与人工
截图复核。颜色/主题的机器判据见 `document/agents/brand/registry.md` 与
`web-ui/lib/theme/tokens.ts`，本文只管**层级、尺度、状态**。

## 1. 分工：谁是颜色的正本

| 层 | 归属 | 规则 |
|---|---|---|
| L1 `--zeta-static-*` | `lib/theme/tokens.ts` | 唯一允许写色值的地方 |
| L2 `--zeta-alias-*` | 同上（生成） | 语义色，主题切换即改这一层 |
| `--studio-*` | `styles/studio/tokens.css` | **桥接层**：只引用 L2（`var(--zeta-alias-*)` 或 `color-mix`），零字面量 |
| 组件 CSS/TSX | `components/studio/**` | 只允许 `var(--studio-*)`；禁止 hex/rgb/hsl |

后果：`data-theme` 在 `<html>` 上唯一存在，Studio 面**没有**第二套主题状态、
没有 `data-theme` 局部覆盖、没有主题切换器。

## 2. 层级：四个字号角色，没有第五个

| 角色 | 规格 | 用途 |
|---|---|---|
| 页标题 | 18px / 600 / 1.3 | 每个 page 一个，`page-title` |
| 区块标签 | 11px / 600 / 大写 + 0.08em | `card-title`、`sb-title` |
| 正文 | 13px / 400 / 1.45 | 列表行、表单、对话 |
| 元信息 | 11px / 400 / `--studio-text-3` | 计数、路径、时间、sha |

- **不再新增字号**。需要"更醒目"时先换字重或色阶，不加尺寸。
- 中文不套 `text-transform: uppercase`；该属性只加在英文标签上，CJK 无效果但
  不要据此假设层级成立——层级由字重 + 色阶 + 间距共同表达。
- 单屏最多一个 18px、若干 11px 标签、其余正文。

## 3. 节奏：间距只用 4 / 8 / 12 / 16 / 24

- 行高表：topbar 44 · 列表行 26 · 控件 28 · 状态栏 24 · 缩进 16/级（最多 2 级）。
- 同一列的所有行共享一个左内缩；计数/数值放**固定宽右栏**（3ch 或 4ch），
  让它们自己成一列。
- 卡片内边距 12/16；页面内边距 16/24；卡片间距 16。

## 4. 颜色克制

- 一屏之内：强调色只标"当前项"，状态色一次只出现一种。
- 深度靠 1px 边框 + surface 色阶，不靠阴影（浮层除外）。
- 禁止：渐变背景、彩色发光、彩虹标签、emoji 当图标。
- 状态色只用于状态（绿=成功/运行完成，橙=警告/待办，红=失败/冲突，蓝=信息），
  不用于装饰。

## 5. 状态覆盖（每块都写全）

| 状态 | 表现 |
|---|---|
| loading | `aria-busy` + 骨架或 `sb-empty` 文案；不留白屏 |
| empty | 一句说明 + 一个主行动按钮（不是死胡同） |
| error | `role="alert"` + `banner red`，可重试 |
| active | 底色 tint **加** 2px 标记（`inset box-shadow` 或下划线），不只靠颜色 |
| disabled | 50% 透明度 + `cursor: default`，且说明为什么不能点（tooltip 或文案） |

**没有后端的面不渲染**：缺端点就整页消失（导航里没有），不做假数据占位。

## 6. 可访问性底线

- 焦点环：`2px var(--studio-accent)`，`offset: -2px`，键盘可达；禁止 `outline: none` 无替代。
- 指针目标 ≥ 24px（`--studio-tap-min`）；紧密图标按钮用 28px 高度。
- 图标按钮必须有 `aria-label`；纯装饰图形 `aria-hidden`。
- 树/列表的展开态用 `aria-expanded`，当前页用 `aria-current="page"`。
- 文本对比：正文与背景 ≥ 4.5:1（主题层已保证，改动色阶须复测）。

## 7. 参考正本

- 视觉语汇来源：`web-ui/styles/design-system.css`（openchamber 设计语言）+
  `web-ui/styles/typography.css`。
- Studio 面语汇来源：`web-ui/styles/studio/**.css`（MIT，见 `THIRD-PARTY-NOTICES.txt`）。
- 标准设计系统/规则库：[OpenDesign](https://github.com/nexu-io/open-design)
  （`craft/typography-hierarchy.md`、`craft/anti-ai-slop.md`、`craft/state-coverage.md`、
  `craft/laws-of-ux.md`）。工作区开关 `.zeta/design.yml`，agent 内 `/design status`。
