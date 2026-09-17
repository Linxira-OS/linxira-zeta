# Zeta 用户手册

Zeta 是一个本地编码 Agent，提供 Web 界面、IM 渠道接入与桌面托盘。本手册
涵盖安装、启动、配置与日常使用。

## 安装

Zeta 以 npm 包和桌面应用两种形式发布。

**npm（Bun / Node）：**

```bash
npm install -g @linxiraos/zeta
# 或
bun add -g @linxiraos/zeta
```

安装后用 `zeta --version` 验证。`zeta` 二进制是 CLI、Web 服务器与桌面壳的
统一入口。

**桌面版：** 安装对应平台的桌面构建。桌面应用运行同一个 `zeta` 运行时，
并额外提供系统托盘图标（关闭窗口时最小化到托盘）。

## 启动 Web 界面

运行 `zeta serve` 启动完整栈——Web UI、Web Gateway、Stats Dashboard——
统一代理到一个端口：

```bash
zeta serve
```

- Web UI 地址为 `http://127.0.0.1:30141`。
- Web Gateway 监听 `127.0.0.1:30142`（dev 模式访问）。
- Stats Dashboard 运行在 `127.0.0.1:3847`。

`zeta web` 启动 Web UI（不带桌面壳）。可在 `web.yml` 中配置域名、端口、
远程访问，以及是否常驻系统托盘。

## 使用 Web 界面

Web UI 以会话（session）为单位组织：

- **新建会话** — 在任意文件夹创建会话；agent 在该目录内工作。
- **聊天** — 输入消息后回车发送。`/` 打开命令，`@` 附加文件。
- **Trajectory** — 将消息区切换为分支/轨迹视图。
- **模型** — 打开侧栏底部的“模型”面板选择提供商与模型，或配置提供商
  模型。
- **设置** — 齿轮图标打开设置面板：外观、模型、工具、Web / 消息渠道，
  以及“关于 / 使用”标签页（即本手册）。
- **Stats** — Stats 标签页内嵌 Stats Dashboard（用量、费用、会话）。

## 模型配置

模型凭据与定义都存放在 `~/.zeta/agent/models.yml`（与 CLI 读取的是同一
个文件——在 Web UI 里改动会立即同时作用于 CLI 与 serve）。打开侧栏中的
**模型**：

1. **定义在 `models.yml` 中的提供商**显示完整编辑器：名称、Base URL、
   API Key（环境变量名、`!shell-命令` 或直接填字面量 key）、headers、
   `compat`。每个提供商下可以添加模型并配置详情——**思考强度**（模式 +
   支持的档位 + 默认档位）、输入类型、成本、上下文/最大 token 等。
2. **其他提供商**以受管卡片显示：OAuth 订阅登录（ChatGPT/Anthropic 等）
   或简单的 API Key 卡片。其凭据存放在 auth 存储（`agent.db`），与
   `models.yml` 分开。
3. 选择模型并设为默认。

如需从自定义端点导入模型，使用**导入**操作并填写提供商的 base URL。也
可以直接编辑 `~/.zeta/agent/models.yml`。

## 连接 IM 渠道

启用 IM 渠道后（设置 → Web / 消息渠道，或在 `web.yml` 中），Zeta 会通过
Telegram、飞书或微信回复你的消息，并把 agent 的回答转发回手机。

**Telegram：**

1. 用 @BotFather 创建机器人并复制 **token**。
2. 在 设置 → Web / 消息渠道 中启用 Telegram 并粘贴 token。
3. 保存；渠道连接成功后机器人即可使用。

**飞书：**

1. 在飞书开放平台创建企业自建应用。
2. 在 设置 → Web / 消息渠道 中启用飞书，填写 **App ID** 与 **App Secret**。
3. 保存；渠道连接成功。

**微信：**

1. 在 设置 → Web / 消息渠道 中启用微信。
2. 点击二维码，用微信扫码登录。
3. 应用运行期间渠道保持连接。登录过期时，在设置中使用**重新连接**获取
   新二维码。

渠道上线后，直接给机器人发消息即可。agent 会在同一会话内回复。也可以
用命令驱动协调者（中文输入法的全角标点会自动归一化）：

- `!hello` — 验证机器人连接；`!help` — 完整参考；`!status` — 渠道 / 路由 /
  工作区 / 语言 / 模型一览。
- `!lang <zh|en>` — 设置本聊天的回复语言。
- `!session list` / `new <名称>` / `use <id|编号>` / `rename` / `delete` —
  管理额外的默认空间会话（每聊天独立上下文；relay 会话不可删除）。
- `!model` / `!model <p>-<m>` — 按编号列出 / 切换模型。
- `!workspace list` / `open <路径> [别名]` / `create <路径> [别名]` /
  `close <别名>` — 管理已注册工作区（多仓库委派）。`*<别名>` 让当前聊天
  直达某个工作区，`*relay`（或 `!workspace relay`）切回中转协调者。
- `!workspace bind <别名>` — 持久化"当前聊天 → 工作区"绑定（直达模式）；
  `!workspace unbind` 解除。`!workspace use <别名>` 是仅本次生效的直达切换。
- `!work workspace:<别名> <任务>` — 在指定工作区直接执行任务；`!work <任务>`
  — 在当前绑定工作区或 relay 执行。
- `!plan <任务>` — 让协调者为任务制定计划；计划会以图片（或文本降级）
  发到手机，然后回复 **1** 执行、**2** 压缩后执行、**3** 在新会话中执行、
  **4** 取消。同一计划也可在 Web 界面中审批。

完整命令参考与路由模型见
[`docs/remote-workspaces.md`](/docs/remote-workspaces.md)。

完整命令参考与路由模型见 `docs/remote-workspaces.md`。

## 桌面托盘

桌面构建提供系统托盘图标。关闭窗口后 Zeta 继续在托盘中运行（设置 →
Web / 消息渠道 → “关闭窗口时最小化到托盘”）；通过托盘菜单重新打开窗口
或退出。


## 桌面入口：`zeta-d` 与 `zeta`

桌面安装只向 PATH 注册一个命令：`zeta-d`。

- `zeta-d` — 运行捆绑的 CLI/TUI（与 `zeta` 体验一致）。
- `zeta-d -d` — 在当前目录打开桌面 GUI；也可传路径（`zeta-d -d
  ~/projects/foo`）指定工作区。

裸 `zeta` 永远属于 npm/源码安装，桌面捆绑包绝不注册该名称，两者共存零冲突。
npm 安装也可以用 `zeta --desktop [cwd]` 打开桌面 GUI；未找到桌面安装时会列出
探测路径并以错误退出。桌面应用自带更新器；在捆绑二进制上运行 `zeta update`
会被刻意拒绝。

## CLI 侧边栏与回合遥测

交互式 TUI 提供两个显示特性：

- **侧边栏**（`/sidebar`，或设置 `tui.sidebar`）：右侧面板显示上下文用量、
  token 总量与费用、git 分支/脏状态以及当前模型。需要至少 100 列终端宽度，
  更窄时自动隐藏；上翻的历史记录中不含侧边栏文本。
- **回合遥测**（`statusLine.turnTelemetry`，默认开启）：每回合结束后编辑器上方
  出现一行暗色遥测信息——吞吐（token/s）、首 token 延迟、耗时、token 数与费用。
  将 `turn_stats` 加入状态栏片段可持久显示同样数据。

## 更新

检查新版本：

```bash
zeta update --check
```

应用更新：

```bash
zeta update
```

桌面应用也可以在 Web UI 中更新（设置 → 检查更新）。更新保留
`~/.zeta/` 下的配置；会话与设置不受影响。
