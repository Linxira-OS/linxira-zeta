# omp-web

[English](./README.md)

[Oh My Pi](https://github.com/badlogic/pi-mono) 编程智能体的浏览器界面——基于 [pi-web](https://github.com/agegr/pi-web) Fork 并改造，专门适配 Oh My Pi（omp）工作流。

> **来源说明**：本项目 Fork 自 [agegr/pi-web](https://github.com/agegr/pi-web)。核心架构、会话浏览、实时对话、文件预览均来自 pi-web 原作者的工作。本仓库的改动专注于与 Oh My Pi 环境的兼容性和工作流优化。

## 什么是 Oh My Pi？

Oh My Pi（omp）是构建在 pi 编程智能体之上的 coding harness，在 pi 核心能力之上添加了结构化智能体会话、技能管理、worktree 协调和更丰富的工具协议。`omp-web` 将 omp 的会话格式呈现在浏览器中：pi 写入的同一批 `.jsonl` 文件，由本地运行的 Next.js 服务器读取并渲染。

## 快速开始

**无需安装，直接运行：**

```bash
npx omp-web@latest
```

**或全局安装后使用：**

```bash
npm install -g omp-web
omp-web
```

**从源码运行（Git Clone）：**

```bash
git clone https://github.com/17380936778/omp-web.git
cd omp-web
npm install
npm run dev      # 启动开发服务器（端口 30141）
# 或构建后运行生产模式：
npm run build
npm start
```

启动后打开 [http://localhost:30141](http://localhost:30141)。服务就绪后会尝试自动打开浏览器。

**可选参数：**

```bash
omp-web --port 8080              # 自定义端口
omp-web --hostname 127.0.0.1     # 仅本机访问
omp-web -p 8080 -H 127.0.0.1     # 组合使用
omp-web --no-open                # 不自动打开浏览器

PORT=8080 omp-web                # 也支持环境变量
OMP_WEB_NO_OPEN=1 omp-web         # 适用于后台服务或开机自启
```

## HTTP 代理

omp-web 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx omp-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx omp-web@latest
```

## 功能介绍

- **按项目找回历史对话**：打开网页即可按项目检索以前的 omp 会话，不必在终端里翻文件或记住会话路径。
- **放心探索不同方向**：从任意历史消息重新开始，或将会话 Fork 成独立路线，不会影响原来的对话。
- **侧边栏切换 Git worktree**：Explorer 和新会话跟随你所选的 checkout。
- **边聊边看项目文件**：左侧浏览文件，右侧预览源码、文档、图片、音频和 PDF，智能体工作时同步检查。
- **随时掌握会话状态**：顶部栏始终显示上下文占用、费用、压缩状态和系统提示，长会话不再是黑箱。
- **在界面内完成所有配置**：模型、登录/API key、模型测试、技能开关，无需离开浏览器。

## 注意事项

- **数据目录**：默认读取 `~/.omp/agent/sessions`。可通过环境变量 `OMP_CODING_AGENT_DIR` 指定其他 omp agent 目录（兼容旧版：同样支持 `PI_CODING_AGENT_DIR`，优先级低于前者）。
- **会话文件**：路径形如 `~/.omp/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 omp agent 目录下的 `models.json`，模型列表和默认值来自 omp 的配置。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：切换器何时出现、新 worktree 在哪里创建、删除会影响什么，见 [omp-web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；"Edit from here" 是同一会话文件里的分支。
- **Skills API**：`SKILLS_API_URL` 可覆盖默认的 `https://skills.sh` 接口地址，用于技能搜索和安装。
- **GitHub token**：设置 `GITHUB_TOKEN` 或 `GH_TOKEN` 可提升技能更新检查器的 GitHub API 速率限制（可选；不设置时仍可请求，但可能触发 rate limit）。
- **环境要求**：需要 Node.js >= 18.3.0。运行环境需安装 Git 并确保系统 `PATH` 中可调起 `git` 命令（用于 Git Worktree 和仓库浏览功能）。

## 与 pi-web 的关系

omp-web 直接 Fork 自 [pi-web](https://github.com/agegr/pi-web)，下表列出了针对 Oh My Pi harness 所做的主要改动：

| 改动点 | 说明 |
|---|---|
| 包名与二进制 | 改为 `omp-web`，原为 `pi-web` |
| pi SDK 依赖 | 跟踪 omp 使用的 `@earendil-works/pi-*` 系列包 |
| 会话兼容性 | 适配 omp 会话格式和工具协议 |
| 默认端口 | 30141（与 omp 开发约定一致） |

其余内容——会话读取、AgentSession 生命周期、SSE 流式传输、Fork/分支逻辑、文件访问、worktree 管理——均继承自 pi-web，详见 [AGENTS.md](./AGENTS.md)。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

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
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
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

## 开源协议

MIT——与上游 [pi-web](https://github.com/agegr/pi-web) 项目保持一致。
