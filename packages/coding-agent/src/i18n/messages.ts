/**
 * Translatable CLI strings.
 *
 * Architecture (mirrors the pi/reasonix i18n pattern): a single flat
 * `Messages` interface of string fields, plus one full catalogue per language
 * (`en.ts`, `zh.ts`). Call sites read `M.SomeField` from `../i18n`; fields
 * whose values embed dynamic content are marked with a `*Fmt` suffix and
 * passed through a formatter at the call site.
 *
 * Adding a field requires updating every catalogue file — TypeScript's
 * `satisfies Messages` makes a missing field a compile error, and
 * `messages.test.ts` verifies the runtime key sets stay identical and
 * non-empty so a translation can never silently ship as a blank line.
 *
 * Scope: user-facing CLI/TUI surface only — welcome, setup wizard, slash
 * command descriptions, status lines, approvals, user-facing CLI errors.
 * System prompts, internal error wrappers, and agent runtime telemetry stay
 * English so model behaviour and developer logs are language-stable.
 *
 * Catalogue values do not include trailing newlines — call sites add framing
 * whitespace, so the same field works wherever it appears.
 */
export interface Messages {
	// welcome box
	welcomeBack: string; // heading above the logo
	welcomeNoRecentSessions: string; // "No recent sessions" row
	welcomeNoLspServers: string; // "No LSP servers" row
	welcomeTipsTitle: string; // right-column "Tips" heading
	welcomeLspServersTitle: string; // right-column "LSP Servers" heading
	welcomeRecentSessionsTitle: string; // right-column "Recent sessions" heading
	welcomePromptActionsHint: string; // "#" hint suffix
	welcomeCommandsHint: string; // "/" hint suffix
	welcomeRunBashHint: string; // "!" hint suffix
	welcomeRunPythonHint: string; // "$" hint suffix
	welcomeTipLabel: string; // "Tip: " label before the tip body
	welcomeNewTag: string; // rainbow tag replacing the "[NEW]" tip marker
	welcomeNerdFontJoke: string; // unicode-symbol joke tip

	// /language command
	languageCurrentFmt: string; // "Current language: %s"
	languageHint: string; // usage line for /language
	languageUnknownFmt: string; // "Unknown language: %s"
	languageChangedFmt: string; // "/language <tag>" succeeded, %s = tag
	languageListRowFmt: string; // "%s (%s)" listing row, %s = tag, %s = local name
	languageEnLabel: string; // local name of English
	languageZhLabel: string; // local name of Chinese
	cmdLanguage: string; // /language menu description
}
