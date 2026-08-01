import type { Messages } from "./messages";

/** Chinese (Simplified) catalogue. */
export const zh = {
	welcomeBack: "欢迎回来！",
	welcomeNoRecentSessions: "暂无最近会话",
	welcomeNoLspServers: "无 LSP 服务器",
	welcomeTipsTitle: "提示",
	welcomeLspServersTitle: "LSP 服务器",
	welcomeRecentSessionsTitle: "最近会话",
	welcomePromptActionsHint: " 触发提示词操作",
	welcomeCommandsHint: " 打开命令",
	welcomeRunBashHint: " 运行 bash",
	welcomeRunPythonHint: " 运行 python",
	welcomeTipLabel: "提示：",
	welcomeNewTag: "新！",
	welcomeNerdFontJoke: "请使用 nerdfont 😭。",
	languageCurrentFmt: "当前语言：%s",
	languageHint: "用法：/language [en|zh]",
	languageUnknownFmt: "未知语言：%s",
	languageChangedFmt: "语言已切换为 %s",
	languageListRowFmt: "%s（%s）",
	languageEnLabel: "英语",
	languageZhLabel: "中文",
	cmdLanguage: "设置 CLI 界面语言",
} satisfies Messages;
