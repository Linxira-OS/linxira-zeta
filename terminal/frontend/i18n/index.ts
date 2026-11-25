// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from "react";

/**
 * Zeta Terminal i18n.
 *
 * Keep every user-visible string here instead of inline JSX text. `en` is the
 * source of truth; `zhCN` must satisfy the same key set at compile time.
 */

export const en = {
    "app.name": "Zeta Terminal",
    "app.tagline": "Open-source terminal, built into Zeta",
    "app.tagline2": "Linux and Windows, one workflow",

    "about.title": "About Zeta Terminal",
    "about.clientVersion": "Client version {version}",
    "about.updateChannel": "Update channel: {channel}",
    "about.github": "GitHub",
    "about.website": "Website",
    "about.openSource": "Open source",
    "about.docs": "Documentation",
    "about.sponsor": "Sponsor",
    "about.copyright": "© {year} Linxira OS",

    "help.title": "Help",
    "help.reset": "Reset",
    "help.openDevTools": "Open DevTools",
    "help.closeDevTools": "Close DevTools",
    "help.setZoom": "Set zoom factor",

    "settings.title": "Zeta Config",
    "settings.files": "Settings files",
    "settings.visual": "Visual",
    "settings.rawJson": "Raw JSON",
    "settings.save": "Save",
    "settings.saving": "Saving...",
    "settings.unsaved": "Unsaved changes",
    "settings.general": "General",
    "settings.connections": "Connections",
    "settings.widgets": "Sidebar widgets",
    "settings.aiModes": "AI modes",
    "settings.backgrounds": "Tab backgrounds",
    "settings.secrets": "Secrets",
    "settings.presets": "Presets",
    "settings.aiPresets": "AI presets",
    "settings.sshHosts": "SSH hosts",
    "settings.sshHostsWsl": "SSH hosts and WSL distros",
    "settings.localModels": "Local models and BYOK",

    "shell.title": "Shell",
    "shell.default": "Default shell",
    "shell.nu": "Nushell",
    "shell.bash": "Bash",
    "shell.zsh": "Zsh",
    "shell.fish": "Fish",
    "shell.pwsh": "PowerShell 7+",
    "shell.wsl": "WSL",
    "shell.gitbash": "Git Bash",
    "shell.installNu": "Install Nushell",
    "shell.unsupported": "PowerShell 7 or newer is required. Windows PowerShell 5.1 and cmd.exe are not supported.",

    "common.cancel": "Cancel",
    "common.ok": "Ok",
    "common.close": "Close",
    "common.closeEsc": "Close (ESC)",
    "common.copy": "Copy",
    "common.loading": "Loading...",

    "conn.reconnect": "Reconnect to {name}",
    "conn.local": "Local",
    "conn.remote": "Remote",
    "conn.disconnect": "Disconnect {name}",
    "conn.editConnections": "Edit Connections",
    "conn.newConnection": "{name} (New Connection)",
    "conn.connectPlaceholder": "Connect to (username@host)...",

    "block.view.noView": "(No View)",
    "block.view.terminal": "Terminal",
    "block.view.preview": "Preview",
    "block.view.web": "Web",
    "block.view.waveai": "WaveAI",
    "block.view.help": "Help",
    "block.view.tips": "Tips",
    "block.view.processes": "Processes",
    "block.magnify": "Magnify",
    "block.minimize": "Minimize",
    "block.unmagnify": "Un-Magnify Block",
    "block.magnifyBlock": "Magnify Block",
    "block.copyBlockId": "Copy BlockId",
    "block.close": "Close Block",
    "block.settings": "Settings",
    "block.splitHorizontally": "Split Horizontally",
    "block.splitVertically": "Split Vertically",
    "block.addToLayout": "Add to Layout",
    "block.errorRenderingHeader": "Error Rendering View Header: {error}",
    "block.noView": "No View",
    "block.noViewComponent": "No View Component",

    "durable.learnMore": "Learn More",
    "durable.standardTitle": "Standard SSH Session",
    "durable.standardDesc": "Standard SSH sessions end when the connection drops. Durable sessions keep your shell state, running programs, and history alive through network changes, computer sleep, and Wave restarts.",
    "durable.restartAsDurable": "Restart as Durable",
    "durable.attachedTitle": "Durable Session (Attached)",
    "durable.attachedDesc": "Your shell state, running programs, and history are protected. This session will survive network disconnects.",
    "durable.detachedTitle": "Durable Session (Detached)",
    "durable.detachedDesc": "Connection lost, but your session is still running on the remote server. Wave will automatically reconnect when the connection is restored.",
    "durable.awaitingConnectionTitle": "Durable Session (Awaiting Connection)",
    "durable.awaitingConnectionDesc": "Configured for a durable session. The session will start when the connection is established.",
    "durable.awaitingStartTitle": "Durable Session (Awaiting Start)",
    "durable.awaitingStartDesc": "Configured for a durable session, but session hasn't started yet. Click below to start it manually.",
    "durable.startSession": "Start Session",
    "durable.startingTitle": "Durable Session (Starting)",
    "durable.startingDesc": "The durable session is starting.",
    "durable.endedTitle": "Durable Session (Ended)",
    "durable.endedDesc": "The durable session has ended. This block is still configured for durable sessions.",
    "durable.endedExitedTitle": "Durable Session (Ended, Exited)",
    "durable.endedExitedDesc": "The shell was terminated and is no longer running. This block is still configured for durable sessions.",
    "durable.endedLostTitle": "Durable Session (Ended, Lost)",
    "durable.endedLostDesc": "The session was lost or not found on the remote server. This may have occurred due to a system reboot or the session being manually terminated.",
    "durable.failedTitle": "Durable Session (Failed to Start)",
    "durable.failedDesc": "The durable session failed to start.",
    "durable.restartSession": "Restart Session",
    "durable.restartStandard": "Restart as Standard",

    "connstatus.stalledTitle": "Connection Stalled",
    "connstatus.stalled": "Connection to \"{name}\" is stalled",
    "connstatus.stalledElapsed": " (no activity for {time})",
    "connstatus.disconnect": "Disconnect",
    "connstatus.connectedGitBash": "Connected to Git Bash",
    "connstatus.connectedLocal": "Connected to Local Machine",
    "connstatus.connected": "Connected to {name}",
    "connstatus.connecting": "Connecting to {name}",
    "connstatus.error": "Error connecting to {name}",
    "connstatus.disconnected": "Disconnected from {name}",
    "connstatus.degraded": "Connection degraded: {name}",
    "connstatus.stalledRemote": "Connection stalled: {name}",
    "connstatus.wshMissing": "wsh is not installed for this connection",
    "connstatus.reconnect": "Reconnect",
    "connstatus.disconnectedQuoted": "Disconnected from \"{name}\"",
    "connstatus.connectingQuoted": "Connecting to \"{name}\"...",
    "connstatus.wshError": "unable to use wsh: {error}",
    "connstatus.disableWsh": "always disable wsh",
    "connstatus.moreThanDay": "more than a day",
    "connstatus.errorLabel": "error: {error}",

    "tab.closeTab": "Close Tab",
    "tab.addTab": "Add Tab",
    "tab.newTab": "New Tab",
    "tab.toggleAi": "Toggle Wave AI Panel",
    "tab.workspaceSwitcher": "Workspace Switcher",
    "tab.switchWorkspace": "Switch workspace",
    "tab.openWorkspace": "Open workspace",
    "tab.createWorkspace": "Create new workspace",
    "tab.saveWorkspace": "Save workspace",
    "tab.editWorkspace": "Edit workspace",
    "tab.currentWorkspace": "This is your current workspace",
    "tab.workspaceOpen": "This workspace is open",
    "tab.deleteWorkspace": "Delete workspace",
    "tab.nameAria": "Tab name",
    "tab.closeAria": "Close tab",
    "tab.loading": "Tab Loading",
    "tab.notFound": "Tab Not Found",
    "tab.rename": "Rename Tab",
    "tab.copyId": "Copy TabId",
    "tab.flag": "Flag Tab",
    "tab.backgrounds": "Backgrounds",
    "tab.default": "Default",
    "tab.none": "None",
    "tab.tabBarPosition": "Tab Bar Position",
    "tab.positionTop": "Top",
    "tab.positionLeft": "Left",
    "tab.color.green": "Green",
    "tab.color.teal": "Teal",
    "tab.color.blue": "Blue",
    "tab.color.purple": "Purple",
    "tab.color.red": "Red",
    "tab.color.orange": "Orange",
    "tab.color.yellow": "Yellow",

    "update.ready": "Update",
    "update.downloading": "Downloading",
    "update.installing": "Installing",
    "update.clickToInstall": "Click to Install Update",

    "element.search": "Search",
    "element.searchResults": "Search Results",
    "element.previousResult": "Previous Result (Shift+Enter)",
    "element.nextResult": "Next Result (Enter)",
    "element.closeSearch": "Close (Esc)",
    "element.regex": "Regular Expression",
    "element.wholeWord": "Whole Word",
    "element.caseSensitive": "Case Sensitive",
    "element.tableOfContents": "Table of Contents",
    "element.loadingDiagram": "Loading diagram...",
    "element.diagramError": "Failed to render diagram: {error}",
    "element.emoji.search": "Search emojis...",
    "element.emoji.none": "No emojis found",

    "quicktips.headerIcons": "Header Icons",
    "quicktips.magnifyBlock": "Magnify a Block",
    "quicktips.connectRemote": "Connect to a remote server",
    "quicktips.blockSettings": "Block Settings",
    "quicktips.closeBlock": "Close Block",
    "quicktips.importantKeybindings": "Important Keybindings",
    "quicktips.mainKeybindings": "Main Keybindings",
    "quicktips.newTab": "New Tab",
    "quicktips.newTerminalBlock": "New Terminal Block",
    "quicktips.openWaveAi": "Open Wave AI Panel",
    "quicktips.tabSwitching": "Tab Switching ({key})",
    "quicktips.switchNthTab": "Switch To Nth Tab",
    "quicktips.previousTab": "Previous Tab",
    "quicktips.nextTab": "Next Tab",
    "quicktips.blockNavigation": "Block Navigation (Ctrl-Shift)",
    "quicktips.navigateBlocks": "Navigate Between Blocks",
    "quicktips.focusNthBlock": "Focus Nth Block",
    "quicktips.focusWaveAi": "Focus Wave AI",
    "quicktips.splitBlocks": "Split Blocks",
    "quicktips.splitRight": "Split Right",
    "quicktips.splitBelow": "Split Below",
    "quicktips.splitDirection": "Split in Direction",
    "quicktips.wshCommands": "wsh commands",
    "quicktips.previewFiles": "Preview files, directories, or web URLs",
    "quicktips.editConfig": "Edit config and code files",
    "quicktips.moreTips": "More Tips",
    "quicktips.tabs": "Tabs",
    "quicktips.tabsTip": "Right click any tab to change backgrounds or rename.",
    "quicktips.webView": "Web View",
    "quicktips.webViewTip": "Click the gear in the web view to set your homepage",
    "quicktips.terminal": "Terminal",
    "quicktips.terminalTip": "Click the gear in the terminal to set your terminal theme and font size",
    "quicktips.needMoreHelp": "Need More Help?",
    "quicktips.github": "Zeta Terminal on GitHub",
    "quicktips.configOptions": "Configuration Options",
    "quicktips.allKeybindings": "All Keybindings",
    "quicktips.fullDocs": "Full Documentation",
    "quicktips.numberKeys": "Number (1-9)",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const zhCN: Messages = {
    "app.name": "Zeta 终端",
    "app.tagline": "开源终端，内置 Zeta 工作流",
    "app.tagline2": "Linux 与 Windows，一套体验",

    "about.title": "关于 Zeta 终端",
    "about.clientVersion": "客户端版本 {version}",
    "about.updateChannel": "更新通道：{channel}",
    "about.github": "GitHub",
    "about.website": "官网",
    "about.openSource": "开源",
    "about.docs": "文档",
    "about.sponsor": "赞助",
    "about.copyright": "© {year} Linxira OS",

    "help.title": "帮助",
    "help.reset": "重置",
    "help.openDevTools": "打开开发者工具",
    "help.closeDevTools": "关闭开发者工具",
    "help.setZoom": "设置缩放比例",

    "settings.title": "Zeta 配置",
    "settings.files": "设置文件",
    "settings.visual": "可视化",
    "settings.rawJson": "原始 JSON",
    "settings.save": "保存",
    "settings.saving": "保存中…",
    "settings.unsaved": "未保存的更改",
    "settings.general": "常规",
    "settings.connections": "连接",
    "settings.widgets": "侧边栏组件",
    "settings.aiModes": "AI 模式",
    "settings.backgrounds": "标签页背景",
    "settings.secrets": "密钥",
    "settings.presets": "预设",
    "settings.aiPresets": "AI 预设",
    "settings.sshHosts": "SSH 主机",
    "settings.sshHostsWsl": "SSH 主机与 WSL 发行版",
    "settings.localModels": "本地模型与自有密钥",

    "shell.title": "Shell",
    "shell.default": "默认 Shell",
    "shell.nu": "Nushell",
    "shell.bash": "Bash",
    "shell.zsh": "Zsh",
    "shell.fish": "Fish",
    "shell.pwsh": "PowerShell 7+",
    "shell.wsl": "WSL",
    "shell.gitbash": "Git Bash",
    "shell.installNu": "安装 Nushell",
    "shell.unsupported": "需要 PowerShell 7 或更高版本；不支持 Windows PowerShell 5.1 和 cmd.exe。",

    "common.cancel": "取消",
    "common.ok": "确定",
    "common.close": "关闭",
    "common.closeEsc": "关闭（ESC）",
    "common.copy": "复制",
    "common.loading": "加载中…",

    "conn.reconnect": "重新连接到 {name}",
    "conn.local": "本地",
    "conn.remote": "远程",
    "conn.disconnect": "断开连接 {name}",
    "conn.editConnections": "编辑连接",
    "conn.newConnection": "{name}（新连接）",
    "conn.connectPlaceholder": "连接到（username@host）…",

    "block.view.noView": "（无视图）",
    "block.view.terminal": "终端",
    "block.view.preview": "预览",
    "block.view.web": "网页",
    "block.view.waveai": "WaveAI",
    "block.view.help": "帮助",
    "block.view.tips": "提示",
    "block.view.processes": "进程",
    "block.magnify": "放大",
    "block.minimize": "还原",
    "block.unmagnify": "还原区块",
    "block.magnifyBlock": "放大区块",
    "block.copyBlockId": "复制区块 ID",
    "block.close": "关闭区块",
    "block.settings": "设置",
    "block.splitHorizontally": "水平拆分",
    "block.splitVertically": "垂直拆分",
    "block.addToLayout": "添加到布局",
    "block.errorRenderingHeader": "渲染视图标题出错：{error}",
    "block.noView": "无视图",
    "block.noViewComponent": "无视图组件",

    "durable.learnMore": "了解更多",
    "durable.standardTitle": "标准 SSH 会话",
    "durable.standardDesc": "标准 SSH 会话在连接断开时结束。持久会话可在网络变化、电脑休眠和 Wave 重启后保留 Shell 状态、正在运行的程序和命令历史。",
    "durable.restartAsDurable": "重启为持久会话",
    "durable.attachedTitle": "持久会话（已连接）",
    "durable.attachedDesc": "你的 Shell 状态、正在运行的程序和命令历史均受到保护。此会话可在网络断开后继续存活。",
    "durable.detachedTitle": "持久会话（已分离）",
    "durable.detachedDesc": "连接已断开，但会话仍在远程服务器上运行。连接恢复后 Wave 会自动重新连接。",
    "durable.awaitingConnectionTitle": "持久会话（等待连接）",
    "durable.awaitingConnectionDesc": "已配置为持久会话。连接建立后会话将自动启动。",
    "durable.awaitingStartTitle": "持久会话（等待启动）",
    "durable.awaitingStartDesc": "已配置为持久会话，但尚未启动。点击下方按钮手动启动。",
    "durable.startSession": "启动会话",
    "durable.startingTitle": "持久会话（启动中）",
    "durable.startingDesc": "持久会话正在启动。",
    "durable.endedTitle": "持久会话（已结束）",
    "durable.endedDesc": "持久会话已结束。此区块仍配置为持久会话。",
    "durable.endedExitedTitle": "持久会话（已结束，已退出）",
    "durable.endedExitedDesc": "Shell 已终止，不再运行。此区块仍配置为持久会话。",
    "durable.endedLostTitle": "持久会话（已结束，已丢失）",
    "durable.endedLostDesc": "会话在远程服务器上丢失或未找到。可能是系统重启或会话被手动终止所致。",
    "durable.failedTitle": "持久会话（启动失败）",
    "durable.failedDesc": "持久会话启动失败。",
    "durable.restartSession": "重启会话",
    "durable.restartStandard": "重启为标准会话",

    "connstatus.stalledTitle": "连接停滞",
    "connstatus.stalled": "与“{name}”的连接已停滞",
    "connstatus.stalledElapsed": "（已 {time} 无活动）",
    "connstatus.disconnect": "断开连接",
    "connstatus.connectedGitBash": "已连接到 Git Bash",
    "connstatus.connectedLocal": "已连接到本机",
    "connstatus.connected": "已连接到 {name}",
    "connstatus.connecting": "正在连接到 {name}",
    "connstatus.error": "连接到 {name} 时出错",
    "connstatus.disconnected": "已断开与 {name} 的连接",
    "connstatus.degraded": "连接质量下降：{name}",
    "connstatus.stalledRemote": "连接停滞：{name}",
    "connstatus.wshMissing": "此连接未安装 wsh",
    "connstatus.reconnect": "重新连接",
    "connstatus.disconnectedQuoted": "已断开与“{name}”的连接",
    "connstatus.connectingQuoted": "正在连接到“{name}”…",
    "connstatus.wshError": "无法使用 wsh：{error}",
    "connstatus.disableWsh": "始终禁用 wsh",
    "connstatus.moreThanDay": "超过一天",
    "connstatus.errorLabel": "错误：{error}",

    "tab.closeTab": "关闭标签页",
    "tab.addTab": "添加标签页",
    "tab.newTab": "新建标签页",
    "tab.toggleAi": "切换 Wave AI 面板",
    "tab.workspaceSwitcher": "工作区切换器",
    "tab.switchWorkspace": "切换工作区",
    "tab.openWorkspace": "打开工作区",
    "tab.createWorkspace": "新建工作区",
    "tab.saveWorkspace": "保存工作区",
    "tab.editWorkspace": "编辑工作区",
    "tab.currentWorkspace": "这是当前工作区",
    "tab.workspaceOpen": "此工作区已打开",
    "tab.deleteWorkspace": "删除工作区",
    "tab.nameAria": "标签页名称",
    "tab.closeAria": "关闭标签页",
    "tab.loading": "标签页加载中",
    "tab.notFound": "未找到标签页",
    "tab.rename": "重命名标签页",
    "tab.copyId": "复制标签页 ID",
    "tab.flag": "标记标签页",
    "tab.backgrounds": "背景",
    "tab.default": "默认",
    "tab.none": "无",
    "tab.tabBarPosition": "标签栏位置",
    "tab.positionTop": "顶部",
    "tab.positionLeft": "左侧",
    "tab.color.green": "绿色",
    "tab.color.teal": "青色",
    "tab.color.blue": "蓝色",
    "tab.color.purple": "紫色",
    "tab.color.red": "红色",
    "tab.color.orange": "橙色",
    "tab.color.yellow": "黄色",

    "update.ready": "更新",
    "update.downloading": "下载中",
    "update.installing": "安装中",
    "update.clickToInstall": "点击安装更新",

    "element.search": "搜索",
    "element.searchResults": "搜索结果",
    "element.previousResult": "上一个结果（Shift+Enter）",
    "element.nextResult": "下一个结果（Enter）",
    "element.closeSearch": "关闭（Esc）",
    "element.regex": "正则表达式",
    "element.wholeWord": "全词匹配",
    "element.caseSensitive": "区分大小写",
    "element.tableOfContents": "目录",
    "element.loadingDiagram": "正在加载图表…",
    "element.diagramError": "图表渲染失败：{error}",
    "element.emoji.search": "搜索表情…",
    "element.emoji.none": "未找到表情",

    "quicktips.headerIcons": "标题栏图标",
    "quicktips.magnifyBlock": "放大区块",
    "quicktips.connectRemote": "连接远程服务器",
    "quicktips.blockSettings": "区块设置",
    "quicktips.closeBlock": "关闭区块",
    "quicktips.importantKeybindings": "常用快捷键",
    "quicktips.mainKeybindings": "主要快捷键",
    "quicktips.newTab": "新建标签页",
    "quicktips.newTerminalBlock": "新建终端区块",
    "quicktips.openWaveAi": "打开 Wave AI 面板",
    "quicktips.tabSwitching": "标签页切换（{key}）",
    "quicktips.switchNthTab": "切换到第 N 个标签页",
    "quicktips.previousTab": "上一个标签页",
    "quicktips.nextTab": "下一个标签页",
    "quicktips.blockNavigation": "区块导航（Ctrl-Shift）",
    "quicktips.navigateBlocks": "在区块间导航",
    "quicktips.focusNthBlock": "聚焦第 N 个区块",
    "quicktips.focusWaveAi": "聚焦 Wave AI",
    "quicktips.splitBlocks": "拆分区块",
    "quicktips.splitRight": "向右拆分",
    "quicktips.splitBelow": "向下拆分",
    "quicktips.splitDirection": "按方向拆分",
    "quicktips.wshCommands": "wsh 命令",
    "quicktips.previewFiles": "预览文件、目录或网页链接",
    "quicktips.editConfig": "编辑配置和代码文件",
    "quicktips.moreTips": "更多技巧",
    "quicktips.tabs": "标签页",
    "quicktips.tabsTip": "右键点击任意标签页即可更改背景或重命名。",
    "quicktips.webView": "网页视图",
    "quicktips.webViewTip": "点击网页视图中的齿轮设置主页",
    "quicktips.terminal": "终端",
    "quicktips.terminalTip": "点击终端中的齿轮设置终端主题和字体大小",
    "quicktips.needMoreHelp": "需要更多帮助？",
    "quicktips.github": "GitHub 上的 Zeta Terminal",
    "quicktips.configOptions": "配置选项",
    "quicktips.allKeybindings": "所有快捷键",
    "quicktips.fullDocs": "完整文档",
    "quicktips.numberKeys": "数字 (1-9)",
};

export type Locale = "en" | "zh-CN";

const dictionaries: Record<Locale, Messages> = {
    en,
    "zh-CN": zhCN,
};

const storageKey = "zeta:locale";
const listeners = new Set<() => void>();
let currentLocale: Locale = detectLocale();

function detectLocale(): Locale {
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "en" || saved === "zh-CN") {
            return saved;
        }
        if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
            return "zh-CN";
        }
    } catch {
        // localStorage can be unavailable in tests/SSR.
    }
    return "en";
}

export function getLocale(): Locale {
    return currentLocale;
}

export function setLocale(locale: Locale): void {
    if (locale === currentLocale) {
        return;
    }
    currentLocale = locale;
    try {
        localStorage.setItem(storageKey, locale);
    } catch {
        // Ignore storage failures; the in-memory locale still applies.
    }
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeLocale(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
    let message = dictionaries[currentLocale][key] ?? en[key] ?? key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            message = message.split(`{${name}}`).join(String(value));
        }
    }
    return message;
}

/** React binding: re-renders when the locale changes. */
export function useI18n(): { locale: Locale; t: typeof t; setLocale: typeof setLocale } {
    const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
    return { locale, t, setLocale };
}
