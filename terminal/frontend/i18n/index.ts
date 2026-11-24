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
