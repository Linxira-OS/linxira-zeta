# 个人号（微信/QQ）接入：三条路线与保底方案

用户要求：国内用户更想要"AI 真的操纵一个微信/QQ 账号"，不是官方机器人——只有真号才能进群拿消息、
被私聊、发空间动态。本文把三条路线、各自证据、以及**保底用我们自己的 computer-use** 讲清楚。

## 1. 三条路线（按"账号风险从低到高、能力从窄到宽"排）

| # | 路线 | 能力 | 风险 | 代表项目（已核实） |
|---|---|---|---|---|
| A | 官方机器人 API | 私聊为主；群聊/空间受限 | 合规 | QQ 官方 botpy（私聊）；飞书/微信客服 |
| B | 真号协议/注入 | 群聊、私聊、成员列表；空间动态通常不在协议面内 | **封号**；协议版本与风控随时变 | QQ：NapCat（NTQQ 协议）、Lagrange（OneBot 11）；微信：WeChatFerry（Hook）、wxauto（UIAutomation）、macOS `wechat_chatter` |
| C | **computer-use 驱动官方客户端**（保底） | 与人眼一致：看到什么就能点什么；群聊/私聊/空间都能进 | 不碰协议、不注入进程；慢；依赖窗口可后台输入 | 我们的 `computer` 工具（本仓） |

用户本地项目 `G:\CODE\MINECRAFT\clones\MaiBot`（`982e832a`）属于 **A/B 之上的"人格层"**：README:194 明说它依赖
**NapCat**，本质是"给真号协议接一个 LLM 人格"，不是真号驱动本身。它可以借鉴对话风格/记忆式人格，
但不能替代路线 B 的协议层。

## 2. 保底方案：我们自己的 computer-use 到底能控制到什么程度

证据全部来自本仓实现，不是推测：

| 维度 | 事实 | 位置 |
|---|---|---|
| 后台输入（不抢鼠标） | Windows 走 `PostMessageW` 向目标 HWND 投递 `WM_LBUTTON*`/`WM_CHAR`/`WM_KEY*`，**不移动真实指针、不激活窗口** | `crates/pi-natives/src/desktop/win32/input.rs:251-252,362,435` |
| 前台输入（会抢） | 仅 `takeover: true` / 桌面级输入才用 `SendInput` + `SetCursorPos` | 同文件 `:950,1094,1133` |
| 读界面 | 窗口截图 + UIA 树（Windows `ax.rs`）；AX 树可点按元素，不靠坐标 | `crates/pi-natives/src/desktop/win32/ax.rs` |
| 焦点行为 | Windows 的 UIA `SetFocus` 会移动键盘焦点；macOS 的 AX 不会 | `tools/computer/worker.ts:808-809` |
| 抢焦点的唯一入口 | `takeover`、`raise()`、`apps.open({activate:true})`、桌面级输入、macOS 菜单；`computer.backgroundFallback: "refuse"` 时这些**全部拒绝** | `prompts/tools/computer.md:57-59`、`tools/settings.ts:669-690` |
| 用户随时能停 | 物理 Escape 停止 takeover 输入（后台输入不受用户 Escape 影响，用户可继续用自己的程序） | `prompts/tools/computer.md:21` |
| 用户介入优先 | macOS `UserIntervened`：用户来到该应用或输入即中止本次调用，且**不复跑** | `prompts/tools/computer.md:62` |

**结论**：保底路线不会默认抢鼠标——默认是后台投递；只有当某个控件不吃后台消息、且 UIA 也够不着时，
才会按设置二选一：`takeover`（短暂接管并把焦点还给用户）或 `refuse`（直接失败）。对微信/QQ 这类客户端，
"后台 PostMessage 是否被接受"必须**实测**（Chromium 系控件常忽略合成消息），这正是要在真机上先做的验证，
不能先写死在文档里。

## 3. 落地方式（怎么接进我们已有的渠道层）

1. **协议类（B）做外部桥，不进核心**：`packages/channels` 新增 `onebot`（QQ，HTTP/WS 客户端）与
   `wechat-bridge`（本机 HTTP，桥后面是 WeChatFerry/wxauto，用户自选自装）两个适配器；
   适配器只做协议翻译，不携带注入代码、不内置凭据，默认关闭（`channels.*.enabled`）。
2. **保底类（C）做"操作员模式"**：`computer` 已经是工具，配一个 `personal-account-operator` 的技能/提示词
   包，把"打开客户端 → 进群 → 读消息 → 回消息"写成受控流程；所有动作走现有 fallback 策略，
   默认 `refuse`（用户明确允许才降级 takeover），并在每个动作前记录"为什么需要前台"。
3. **两条路线共用同一套上层**：会话路由、工作区绑定、人设、记忆都是我们已经做好的（默认工作区 +
   `remote.sessionMappings` + `persona`），所以 B 与 C 只是两个"输入通道"，上层不需要第二套模型。
4. **能力矩阵要写在渠道清单里**：群消息/私聊/@提及/空间动态 四项分别标注 A/B/C 是否支持，
   避免用户以为官方机器人也能发动态。

## 4. 未决（需要用户拍板，不擅自实现）

- 是否在仓内维护 `onebot` / `wechat-bridge` 适配器，还是只发布"桥的协议规格 + 示例脚本"（后者零封号责任）。
- 保底模式默认 `refuse` 还是 `takeover`（现状全局默认 `takeover`；个人号场景建议更保守）。
- 是否把"空间动态"列入首期——A 类不支持，B 类需额外协议，C 类靠界面。
