# Zeta Web UI

Zeta's browser interface is based on the OMP Web snapshot and keeps the
existing runtime and configuration compatibility layer. See
`../docs/upstream-sync.md` for the source baseline and porting policy.

[English](./README.en.md)

Zeta 的浏览器界面，基于 OMP Web 快照，并保留现有 OMP 运行时和配置兼容层。

> **来源说明**：Zeta Web 包含 OMP Web 快照和 [Pi Web](https://github.com/agegr/pi-web) 的历史。核心架构、会话浏览、实时对话和文件预览仍保留其上游作者归属。

![Zeta Web 界面展示：结构化 Markdown、工具调用与项目导航](./docs/Untitled%20blend-4096x4096.png)

## 什么是 Zeta？

Zeta 是基于 OMP 运行时的开箱即用编码代理。Zeta Web 通过本地 Next.js 服务器在浏览器中展示兼容的会话文件。

## 快速开始

Zeta Web 要求 Node.js 22.19.0 或更高版本。可通过 `node --version` 检查当前版本。

**从源码运行（Git Clone）：**

```bash
git clone https://github.com/Linxira-OS/linxira-zeta.git
cd linxira-zeta/web-ui
npm install
npm run dev      # 启动开发服务器（端口 30141）
# 或构建后运行生产模式：
npm run build
npm start
```

启动后打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)。服务就绪后会尝试自动打开浏览器。Zeta Web 默认仅监听 `127.0.0.1`。

**可选参数：**

```bash
zeta-web --port 8080              # 自定义端口
zeta-web --hostname 0.0.0.0       # 在可信网络中开放访问
zeta-web -p 8080 -H 0.0.0.0       # 组合使用
zeta-web --no-open                # 不自动打开浏览器

PORT=8080 zeta-web                # 也支持环境变量
ZETA_WEB_HOSTNAME=0.0.0.0 zeta-web  # 显式开放网络访问
ZETA_WEB_NO_OPEN=1 zeta-web         # 适用于后台服务或开机自启
```

Zeta Web 没有应用层身份验证，并且可以调用高权限智能体。请勿将其暴露到互联网；仅在可信网络中使用非 loopback 监听地址。

## HTTP 代理

Zeta Web 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx zeta-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx zeta-web@latest
```

## 特色与增强功能

- **独立代码块语法主题选择器**：新增多主题代码渲染支持，内置 **One Dark Pro**、VS Code Dark+、VS Code Light 等高亮主题，用户可自由切换代码视觉风格。
- **Zeta 兼容层**：默认使用 `~/.zeta/agent/` 目录结构（`models.json`、`models.db`、`config.yml`、`agent.db` 等），兼容 `~/.omp/agent/` 旧目录。支持角色模型（如 `defaultModel`、`smallModel`）和 SQLite 凭据。
- **全界面中文与双语本地化**：提供全面中文化的 UI 交互体验，优化 CJK 排版、字体与搜索体验。
- **按项目找回历史对话**：打开网页即可按项目检索以前的 Zeta 会话，不必在终端里翻文件或记住会话路径。
- **放心探索不同方向**：从任意历史消息重新开始，或将会话 Fork 成独立路线，不会影响原来的对话。
- **侧边栏切换 Git worktree**：Explorer 和新会话跟随你所选的 checkout。
- **边聊边看项目文件**：左侧浏览文件，右侧预览源码、文档、图片、音频和 PDF，智能体工作时同步检查。
- **随时掌握会话状态**：顶部栏始终显示上下文占用、费用、压缩状态和系统提示，长会话不再是黑箱。
- **在界面内完成所有配置**：模型、登录/API key、模型测试、技能开关，无需离开浏览器。

## 注意事项

- **数据目录**：默认读取 `~/.zeta/agent/sessions`。可通过环境变量 `ZETA_CODING_AGENT_DIR` 指定其他 agent 目录（兼容旧版：同样支持 `OMP_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_DIR`，`ZETA_*` 优先级最高）。
- **会话文件**：路径形如 `~/.zeta/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 Zeta agent 目录下的 `models.json`，模型列表和默认值来自兼容配置。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：切换器何时出现、新 worktree 在哪里创建、删除会影响什么，见 [Zeta Web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；"Edit from here" 是同一会话文件里的分支。
- **Skills API**：`SKILLS_API_URL` 可覆盖默认的 `https://skills.sh` 接口地址，用于技能搜索和安装。
- **GitHub token**：设置 `GITHUB_TOKEN` 或 `GH_TOKEN` 可提升技能更新检查器的 GitHub API 速率限制（可选；不设置时仍可请求，但可能触发 rate limit）。
- **环境要求**：需要 Node.js >= 18.3.0。运行环境需安装 Git 并确保系统 `PATH` 中可调起 `git` 命令（用于 Git Worktree 和仓库浏览功能）。

## 来源与兼容性

Zeta Web 基于 OMP Web 快照，后者保留了 Pi Web 历史。下表列出 Zeta 的兼容表面和本地增强：

| 改动点 | 说明 |
|---|---|
| 兼容二进制 | 为现有脚本保留 `omp-web` |
| 代码语法主题选择器 | **新增** 独立代码块主题选择器，支持 **One Dark Pro** 等主流主题切换 |
| 数据与角色映射 | 支持 `~/.zeta/agent/` 下的 `models.db`、`config.yml` 角色模型及 SQLite API Key |
| 中文与国际化体验 | **增强** 完整双语界面与中文本地化交互优化 |
| 运行时依赖 | 使用兼容的 `@earendil-works/pi-*` 运行时包 |
| 会话与路径兼容性 | 适配兼容会话格式、工具协议及 `~/.zeta/agent/` 数据目录 |
| 默认端口 | 30141 |

其余内容——会话读取、AgentSession 生命周期、SSE 流式传输、Fork/分支逻辑、文件访问、worktree 管理——均继承自 pi-web，详见 [AGENTS.md](./AGENTS.md)。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30141](http://127.0.0.1:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/` 并影响正在运行的 dev server。发布流程再执行构建。

## 项目结构

```text
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  DirectoryPicker.tsx # 支持浏览和路径输入的工作目录选择器
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
bin/
  omp-web.js          # npm CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```

## 致谢

Zeta Web 基于以下上游项目，深表感谢：

- **[Pi](https://github.com/earendil-works/pi)** — 编码代理架构的奠基项目，由 [@mariozechner](https://github.com/mariozechner) 创建
- **[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)** — Zeta 的直接运行时上游，由 [@can1357](https://github.com/can1357) 维护
- **[Pi Web](https://github.com/agegr/pi-web)** — 浏览器界面架构的原始实现，由 [@agegr](https://github.com/agegr) 创建
- **[OMP Web](https://github.com/17380936778/omp-web)** — Web UI 的直接上游快照，由 [@17380936778](https://github.com/17380936778) 维护

感谢所有贡献者对这些项目的持续投入。

## 开源协议

MIT——与上游 [pi-web](https://github.com/agegr/pi-web) 项目保持一致。
