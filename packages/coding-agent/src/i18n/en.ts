import type { Messages } from "./messages";

/** English catalogue — the default. */
export const en = {
	welcomeBack: "Welcome back!",
	welcomeNoRecentSessions: "No recent sessions",
	welcomeNoLspServers: "No LSP servers",
	welcomeTipsTitle: "Tips",
	welcomeLspServersTitle: "LSP Servers",
	welcomeRecentSessionsTitle: "Recent sessions",
	welcomePromptActionsHint: " for prompt actions",
	welcomeCommandsHint: " for commands",
	welcomeRunBashHint: " to run bash",
	welcomeRunPythonHint: " to run python",
	welcomeTipLabel: "Tip: ",
	welcomeNewTag: "NEW!",
	welcomeNerdFontJoke: "Please use nerdfont 😭.",
	languageCurrentFmt: "Current language: %s",
	languageHint: "Usage: /language [en|zh]",
	languageUnknownFmt: "Unknown language: %s",
	languageChangedFmt: "Language set to %s",
	languageListRowFmt: "%s (%s)",
	languageEnLabel: "English",
	languageZhLabel: "中文",
	cmdLanguage: "Set the CLI display language",
} satisfies Messages;
