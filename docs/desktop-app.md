# 桌面应用（zetawork）

`zetawork` 桌面版把 GUI、终端（`zetawork`）、编码代理（`zetacode`）和 IDE（`zetaide`）
装在同一目录里，GUI 从自身目录解析伙伴程序，不读 PATH。

## 安装包

- **Windows**：`linxira-zeta-<版本>-setup-x64.exe`，NSIS，**当前用户安装**（无 UAC），
  默认装到 `%LOCALAPPDATA%\Programs\Linxira Zeta`。
  便携版是 `linxira-zeta-<版本>-windows-x64.zip`，同样带四个二进制，解压即可后端自起。
  - 安装界面可选 **English / 简体中文**；首次选择会记住，重装时沿用。
  - 默认创建**开始菜单**和**桌面**快捷方式；不需要桌面的可在组件页取消。
  - 卸载入口在“应用和功能”，同时删除两个快捷方式。
- **Linux**：`linxira-zeta-<版本>-x86_64.AppImage` 与 `linxira-zeta-<版本>-1-x86_64.pkg.tar.zst`
  （Arch）。安装后提供 `linxira-zeta.desktop`（`Exec=/usr/lib/zetawork/zetawork-gui`，`Terminal=false`）和图标。
  Arch 包同时把 `zetacode` 与 `zetaide` 以软链接放进 `/usr/bin`（指向
  `/usr/lib/zetawork/`），所以不启动桌面应用也能在 SSH 里用；桌面二进制本身
  仍不在 `PATH` 上。
- 同目录还会放 `zetacode.exe`、`zetaide.exe`、`zetawork.exe`、`WebView2Loader.dll`，
  无需单独安装。

## 启动与身份

- Windows 版是 **GUI 子系统**程序：双击/开始菜单启动**不会弹控制台窗口**。
- `zetawork-gui.exe --version` 在终端里仍会打印版本，供更新器和冒烟检查读取；
  重定向到文件同样有效。
- 任务栏身份固定为 `Zeta.Zetawork`，快捷方式与运行中的窗口归为同一应用。

## 托盘与通知

发布版编译了 `tray` 与 `os-notify`：托盘图标常驻，菜单可唤回窗口、查看会话数、退出。
Windows 用 `Shell_NotifyIcon`；Linux 用 StatusNotifierItem（D-Bus，KSNI 后端）——
KDE 的 X11 与 Wayland 会话、XFCE、LXQt 直接支持，GNOME 需要 AppIndicator 扩展。
没有宿主的会话里托盘降级为“无托盘”（设置 → 常规会说明原因），
关窗仍然后台驻留，再运行一次 `zetawork` 即可唤回。通知策略见 设置 → 通知。

## 快捷键与命令面板

桌面命令（新建大标签页、拆分面板、新建终端、聚焦模式、打开设置、切换侧栏、保存、命令面板）
来自同一张注册表：命令面板里能搜到并运行它们，`设置 → 快捷键` 列出的就是键盘实际监听的那份键位。
右侧输入框可以改键：写成 `ctrl+shift+k` 这样，能解析就立即生效；写不成、或与别的命令撞车时
行尾显示 `?`，原来的键继续生效。改动写进 `~/.zeta/zetawork.toml` 的
`keys = "id=chord; id=chord"` 一行；清空某一行即回到出厂键位。

### 左栏键盘操作

点中左栏任意一行后，左栏获得焦点，焦点行画一圈主题色描边（focus ring）。
`↑` / `↓` 在可见行之间移动：默认项目的固定区 → 项目 → 该项目展开的各工作区 → Agent 标签页 → 会话，
到顶/到底即停住；行被刷新移除时焦点回到同方向的第一/最后一行。

| 键 | 作用 |
| --- | --- |
| `↑` / `↓` | 移动焦点，不改变选中项，也不读取或删除任何东西 |
| `Enter` | 激活焦点行：打开项目、工作区或会话；Agent 行切到对应标签页并把输入行指向它 |
| `F2` | 重命名项目或工作区（本机项目没有可持久化的名字，按键无效果；无法持久化命名的标签页给出提示） |
| `Delete` | **仅从视图移除**：项目只从注册表移除，工作区只从 UI 移除，会话只关闭标签页；目录和会话记录都不动 |
| `Shift+Delete` | **关闭并归档**（会话或 Agent 标签页）：先停止，再归档到网关，可从 会话管理 → 已归档 恢复 |
| `Ctrl+Shift+Delete` | **删除会话**：打开 会话管理 并把该行置于“确认删除”，再点一次才执行网关的软删除；运行中的会话拒绝 |

焦点只在自己可见时处理按键：输入框、弹出菜单、重命名/添加编辑器或模态框持有键盘时，左栏让出按键；
左栏折叠成 rail 后也不拦截这些快捷键。完整语义见
`docs/gui-sessions-and-worktrees.md` 的“移除、关闭、归档与删除”。

## 更新

`zetacode update --desktop --check` 只打印一行 JSON；`zetacode update --desktop`
下载安装包、校验 SHA-256 后静默安装。

## 卸载

Windows：应用和功能 → Linxira Zeta → 卸载（会结束正在运行的 GUI）。
Linux：删除 AppImage 文件或 `pacman -R linxira-zeta`。
