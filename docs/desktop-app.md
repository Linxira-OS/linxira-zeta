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
- 同目录还会放 `zetacode.exe`、`zetaide.exe`、`zetawork.exe`、`WebView2Loader.dll`，
  无需单独安装。

## 启动与身份

- Windows 版是 **GUI 子系统**程序：双击/开始菜单启动**不会弹控制台窗口**。
- `zetawork-gui.exe --version` 在终端里仍会打印版本，供更新器和冒烟检查读取；
  重定向到文件同样有效。
- 任务栏身份固定为 `Zeta.Zetawork`，快捷方式与运行中的窗口归为同一应用。

## 托盘与通知

发布版编译了 `tray` 与 `os-notify`：托盘图标常驻，菜单可唤回窗口、查看会话数、退出。
Linux 上没有 StatusNotifier 宿主时托盘降级为“无托盘”（设置 → 常规会说明原因），
关窗仍然后台驻留，再运行一次 `zetawork` 即可唤回。通知策略见 设置 → 通知。

## 更新

`zetacode update --desktop --check` 只打印一行 JSON；`zetacode update --desktop`
下载安装包、校验 SHA-256 后静默安装。

## 卸载

Windows：应用和功能 → Linxira Zeta → 卸载（会结束正在运行的 GUI）。
Linux：删除 AppImage 文件或 `pacman -R linxira-zeta`。
