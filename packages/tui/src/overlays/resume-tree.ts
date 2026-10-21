/**
 * ANSI three-level resume tree: project → workspace → conversation.
 *
 * Renders the rows produced by the coding-agent resume view model; it never
 * groups sessions itself. The model arrives through {@link ResumeTreeSource},
 * which the host builds from `loadResumeDirectory` + `buildResumeView` (pi-tui
 * cannot depend on the coding-agent package). Scope cycling, collapse state,
 * search focus, pin actions and the delete confirmation live here; view
 * construction and persistence live in the host.
 */

import * as path from "node:path";
import { type Component, Input, matchesKey, padding, truncateToWidth, visibleWidth } from "../index";
import { tuiText, tuiTextFmt } from "../i18n";
import { matchesAppInterrupt, matchesSelectDown, matchesSelectUp } from "../keybinding-matchers";
import { routeSgrMouseInput, type SgrMouseEvent } from "../mouse";
import { theme } from "../theme/theme";
import type { ThemeColor } from "../theme/theme";

export type ResumeTreeScope = "workspace" | "project" | "all";

/** Persisted picker state (v2 file): scope plus local expansion. */
export interface ResumeTreePickerState {
	scope: ResumeTreeScope;
	collapsedProjects?: readonly string[];
	expandedProjects?: readonly string[];
	collapsedWorkspaces?: readonly string[];
	/** Absolute paths in the project/workspace/cwd labels; absent means false. */
	fullPaths?: boolean;
}
export type ResumeTreeStatus = "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";
export type ResumeTreeDeleteMode = "trash" | "permanent";

/** The session fields the tree reads from a conversation row. */
export interface ResumeTreeSession {
	path: string;
	id: string;
	cwd: string;
	size?: number;
	title?: string;
	modified: Date;
	firstMessage?: string;
}

export interface ResumeTreeConversation {
	session: ResumeTreeSession;
	key: string;
	id: string;
	path: string;
	title: string;
	cwd: string;
	projectKey: string;
	workspaceKey: string;
	created: Date;
	modified: Date;
	status?: ResumeTreeStatus;
	pinned: boolean;
	current: boolean;
	fork: boolean;
	/** Subagent marker from `session_init.agent`; forks never set it. */
	isSubagent?: boolean;
	agentName?: string;
	parentKey?: string;
	/** Direct subagent children, when the directory attached them. */
	subagents?: readonly ResumeTreeConversation[];
	messageCount: number;
}

export interface ResumeTreeWorkspace {
	key: string;
	path: string;
	name: string;
	/** User-configured alias, or null. The directory name never changes. */
	alias?: string | null;
	/** Alias when set, otherwise `name`. */
	displayName?: string;
	projectKey: string;
	branch: string | null;
	pinned: boolean;
	lastActivity: Date | null;
	counts: { conversations: number; pinnedConversations: number };
}

export interface ResumeTreeProject {
	key: string;
	root: string;
	name: string;
	alias: string | null;
	displayName: string;
	isDefault: boolean;
	pinned: boolean;
	collapsed: boolean;
	lastActivity: Date | null;
	counts: { conversations: number; workspaces: number; pinnedConversations: number };
}

export interface ResumeTreeProjectRow {
	type: "project";
	key: string;
	project: ResumeTreeProject;
	pinned: boolean;
	collapsed: boolean;
	conversationCount: number;
	totalConversationCount: number;
	workspaceCount: number;
	totalWorkspaceCount: number;
}

export interface ResumeTreeWorkspaceRow {
	type: "workspace";
	key: string;
	workspace: ResumeTreeWorkspace;
	projectKey: string;
	pinned: boolean;
	conversationCount: number;
	totalConversationCount: number;
}

export interface ResumeTreeConversationRow {
	type: "conversation";
	key: string;
	conversation: ResumeTreeConversation;
	projectKey: string;
	workspaceKey: string;
	pinned: boolean;
	current: boolean;
	pinnedOnly?: boolean;
}

export type ResumeTreeRow = ResumeTreeProjectRow | ResumeTreeWorkspaceRow | ResumeTreeConversationRow;

export interface ResumeTreeView {
	scope: { kind: ResumeTreeScope; projectKey?: string; workspaceKey?: string };
	query: { raw: string; terms?: readonly string[] };
	rows: readonly ResumeTreeRow[];
	conversations?: readonly ResumeTreeConversationRow[];
	counts: {
		conversations: number;
		workspaces?: number;
		projects?: number;
		totalConversations: number;
		totalWorkspaces?: number;
		totalProjects?: number;
	};
	/** Branch of the current session's workspace, when known. */
	referenceBranch?: string | null;
	/** Workspace key of the current session, when known. */
	currentWorkspaceKey?: string;
}

/** Names and per-scope conversation totals for the scope header. */
export interface ResumeTreeScopeSummary {
	workspaceName: string;
	projectName: string;
	counts: Record<ResumeTreeScope, number>;
}

/**
 * Host bridge. `buildView` must be a pure projection of the loaded directory;
 * `refresh`/`pin*`/`deleteConversation` perform I/O and resolve when the
 * source's internal state is current again.
 */
export interface ResumeTreeSource {
	readonly initialScope: ResumeTreeScope;
	buildView(input: { scope: ResumeTreeScope; query: string; currentSessionPath?: string }): ResumeTreeView | null;
	scopeSummary(): ResumeTreeScopeSummary;
	currentSessionPath?(): string | undefined;
	/** Remember the chosen scope across opens. */
	persistScope?(scope: ResumeTreeScope): void | Promise<void>;
	/** Restored v2 picker state (scope + expansion); absent means defaults. */
	pickerState?(): ResumeTreePickerState;
	/** Persist scope + expansion together (preferred over `persistScope`). */
	persistPickerState?(state: ResumeTreePickerState): void | Promise<void>;
	/** Re-read the directory; resolves once `buildView` reflects the new state. */
	refresh?(): Promise<void>;
	/** Partial scan failures (unreadable project folders) while rows are still listed. */
	scanWarningNames?(): readonly string[];
	/** A failed load: no rows available at all. */
	loadError?(): string | undefined;
	isLoading?(): boolean;
	pinConversation?(conversation: ResumeTreeConversation, pinned: boolean): Promise<void>;
	pinProject?(project: ResumeTreeProject, pinned: boolean): Promise<void>;
	pinWorkspace?(workspace: ResumeTreeWorkspace, pinned: boolean): Promise<void>;
	/** Set the workspace display alias; resolves the name the picker now shows. */
	renameWorkspace?(workspace: ResumeTreeWorkspace, alias: string | null): Promise<string | null>;
	openWorkspace?(workspace: ResumeTreeWorkspace): void | Promise<void>;
	/** Rename the persisted session title; resolves the stored name or null. */
	renameConversation?(conversation: ResumeTreeConversation, title: string): Promise<string | null>;
	/** False hides the conversation rename action (read-only/foreign session). */
	canRenameConversation?(conversation: ResumeTreeConversation): boolean;
	/** Scopes without a project header (workspace/project) resolve the project here. */
	projectByKey?(key: string): ResumeTreeProject | undefined;
	deleteConversation?(conversation: ResumeTreeConversation): Promise<boolean>;
	deleteMode: ResumeTreeDeleteMode;
}

export interface ResumeTreeOptions {
	source: ResumeTreeSource;
	getTerminalRows?: () => number;
	onSelect: (conversation: ResumeTreeConversation) => void;
	onCancel: () => void;
	onExit: () => void;
	onRequestRender?: () => void;
	/** Start with the search field focused (the default for a resume picker). */
	searchFocused?: boolean;
}

const CURRENT_LABEL_KEY = "resumeCurrentLabel";
const PINNED_LABEL_KEY = "resumePinnedLabel";

function statusWord(status: ResumeTreeStatus | undefined): { text: string; tone: ThemeColor } | undefined {
	switch (status) {
		case "complete":
			return { text: tuiText("ssStatusDone", "done"), tone: "success" };
		case "interrupted":
			return { text: tuiText("ssStatusInterrupted", "interrupted"), tone: "warning" };
		case "aborted":
			return { text: tuiText("ssStatusAborted", "aborted"), tone: "muted" };
		case "error":
			return { text: tuiText("ssStatusError", "error"), tone: "error" };
		case "pending":
			return { text: tuiText("ssStatusPending", "pending"), tone: "accent" };
		default:
			return undefined;
	}
}

/** Short relative age, localised through the shared session-picker keys. */
export function formatResumeAge(date: Date, now: number = Date.now()): string {
	const elapsed = Math.max(0, now - date.getTime());
	if (elapsed < 60_000) return tuiText("ssJustNow", "just now");
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 60) {
		const plural = minutes === 1 ? "" : "s";
		return tuiTextFmt("ssMinuteAgoFmt", "%s minute%s ago", minutes, plural);
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const plural = hours === 1 ? "" : "s";
		return tuiTextFmt("ssHourAgoFmt", "%s hour%s ago", hours, plural);
	}
	const days = Math.floor(hours / 24);
	if (days === 1) return tuiText("ssDayAgo", "1 day ago");
	return tuiTextFmt("ssDaysAgoFmt", "%s days ago", days);
}

/** Middle-ellipsis truncation for path-like text (`a/b/…/x/y`). */
export function middleEllipsis(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(text) <= maxWidth) return text;
	if (maxWidth <= 3) return truncateToWidth(text, maxWidth);
	const ellipsis = "…";
	const room = maxWidth - visibleWidth(ellipsis);
	const head = Math.ceil(room / 2);
	const tail = Math.floor(room / 2);
	return `${truncateToWidth(text, head)}${ellipsis}${takeTail(text, tail)}`;
}

/** Tail that starts at a path segment boundary when one is available. */
function takePathTail(text: string, width: number): string {
	const tail = takeTail(text, width);
	const separator = tail.search(/[\\/]/);
	return separator > 0 ? tail.slice(separator) : tail;
}

/** Last `width` columns of `text` (visible width, no ANSI). */
function takeTail(text: string, width: number): string {
	if (width <= 0) return "";
	const characters = [...text];
	let out = "";
	let used = 0;
	for (let index = characters.length - 1; index >= 0; index--) {
		const character = characters[index]!;
		const characterWidth = visibleWidth(character);
		if (used + characterWidth > width) break;
		out = character + out;
		used += characterWidth;
	}
	return out;
}

/** Pick the path API from the string's own shape, not the host platform. */
export function resumePathApi(value: string): typeof path.posix {
	const windows =
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith("\\\\") ||
		/^\/\/[^/]/.test(value) ||
		(value.includes("\\") && !value.startsWith("/"));
	return windows ? path.win32 : path.posix;
}

/** Full path spelled with its own platform's separators (drive, UNC or POSIX). */
export function absoluteResumePath(value: string): string {
	const api = resumePathApi(value);
	const normalized = api.normalize(value);
	return normalized === "." ? value : normalized;
}

/** Short parent/name tail or the full absolute path, per the picker toggle. */
export function formatResumePath(value: string, fullPaths: boolean): string {
	if (!value) return "";
	if (fullPaths) return absoluteResumePath(value);
	const normalized = value.replace(/[\\/]+$/, "") || value;
	const api = resumePathApi(normalized);
	const name = api.basename(normalized);
	const parent = api.basename(api.dirname(normalized));
	if (!parent || parent === name) return name || value;
	return api.join(parent, name);
}

/** Basename-first path tail (`parent/name`) keeping the platform separator. */
export function resumePathTail(value: string): string {
	return formatResumePath(value, false);
}

/**
 * Truncate from the left so the tail stays readable, keeping a drive/UNC root
 * when there is room for one (`D:\…\repo`, `\\server\share\…\repo`). The
 * returned string never exceeds `maxWidth` visible columns.
 */
export function truncateResumePath(value: string, maxWidth: number): string {
	const width = Math.max(0, Math.floor(maxWidth));
	if (width === 0) return "";
	if (visibleWidth(value) <= width) return value;
	const ellipsis = "…";
	if (width === 1) return ellipsis;
	const root = resumePathApi(value).parse(value).root;
	if (visibleWidth(root) > 1 && visibleWidth(root) + 2 < width) {
		const rest = value.slice(root.length).replace(/^[\\/]+/, "");
		return `${root}${ellipsis}${takePathTail(rest, width - visibleWidth(root) - 1)}`;
	}
	return `${ellipsis}${takePathTail(value, width - 1)}`;
}

/** Left-pad to a stable column width (never truncates). */
function padStartVisible(text: string, width: number): string {
	const pad = width - visibleWidth(text);
	return pad > 0 ? `${" ".repeat(pad)}${text}` : text;
}

/**
 * One dense line: `cursor + left` pinned left, `right` pinned to the last
 * column. When the two cannot both fit, `right` is dropped first so the row
 * never wraps.
 */
function alignRow(cursor: string, left: string, right: string, width: number): string {
	const available = Math.max(1, width - visibleWidth(cursor));
	const rightWidth = visibleWidth(right);
	const gap = 2;
	if (rightWidth > 0 && available - rightWidth - gap >= 8) {
		const leftText = truncateToWidth(left, available - rightWidth - gap);
		const fill = Math.max(gap, available - visibleWidth(leftText) - rightWidth);
		return `${cursor}${leftText}${" ".repeat(fill)}${right}`;
	}
	return `${cursor}${truncateToWidth(left, available)}`;
}

/**
 * Pick the widest right-hand variant this row can carry and return the space
 * left for its left-hand content, following {@link alignRow}'s fit rule.
 */
function leftBudgetFor(cursor: string, variants: readonly string[], width: number): { right: string; budget: number } {
	const available = Math.max(1, width - visibleWidth(cursor));
	for (const right of variants) {
		if (right && available - visibleWidth(right) - 2 >= 8) {
			return { right, budget: available - visibleWidth(right) - 2 };
		}
	}
	return { right: "", budget: available };
}

/**
 * A workspace branch is noise when it repeats the current workspace's branch;
 * it is kept for the current workspace or when it actually differs.
 */
export function shouldShowBranch(
	branch: string | null | undefined,
	referenceBranch: string | null | undefined,
	current: boolean,
	workspaceName?: string,
): boolean {
	if (!branch) return false;
	if (current) return true;
	if (workspaceName && branch === workspaceName) return false;
	return branch !== referenceBranch;
}

function conversationCountText(row: { conversationCount: number; totalConversationCount: number }): string {
	const visible = row.conversationCount;
	if (visible === row.totalConversationCount) {
		return visible === 1
			? tuiTextFmt("resumeConversationCountOne", "1 conversation", visible)
			: tuiTextFmt("resumeConversationCountFmt", "%d conversations", visible);
	}
	return tuiTextFmt("resumeConversationCountOfFmt", "%d of %d conversations", visible, row.totalConversationCount);
}

/** Fixed indentation: project 0 → workspace 1 step → conversation 2 steps. */
const PROJECT_INDENT = 0;
const WORKSPACE_INDENT = 2;
const CONVERSATION_INDENT = 4;
/** Two columns at the right edge: a space plus the menu affordance. */
const MENU_WIDTH = 2;

/** Stable right-hand column widths for the conversation list. */
export interface ConversationColumns {
	status: number;
	turns: number;
	age: number;
	flags: number;
}

function conversationAge(row: ResumeTreeConversationRow, now?: number): string {
	return formatResumeAge(row.conversation.modified, now);
}

function conversationTurns(row: ResumeTreeConversationRow): string {
	return row.conversation.messageCount === 1
		? tuiText("resumeTurnCountOne", "1 turn")
		: tuiTextFmt("resumeTurnCountFmt", "%d turns", row.conversation.messageCount);
}

function conversationFlags(row: ResumeTreeConversationRow): { text: string; tone: ThemeColor }[] {
	const flags: { text: string; tone: ThemeColor }[] = [];
	if (row.current) flags.push({ text: tuiText(CURRENT_LABEL_KEY, "current"), tone: "accent" });
	if (row.conversation.fork) flags.push({ text: tuiText("ssForkLabel", "fork"), tone: "dim" });
	if (row.pinned) flags.push({ text: tuiText(PINNED_LABEL_KEY, "pinned"), tone: "accent" });
	return flags;
}

/** Width of the status column, fixed across rows so every title starts together. */
export function statusColumnWidth(): number {
	let width = 0;
	for (const status of ["complete", "interrupted", "aborted", "error", "pending"] as const) {
		width = Math.max(width, visibleWidth(statusWord(status)?.text ?? ""));
	}
	return width;
}

/** Column widths across every visible conversation row, so columns stay put while scrolling. */
export function conversationColumns(rows: readonly ResumeTreeConversationRow[], now?: number): ConversationColumns {
	const widths: ConversationColumns = { status: statusColumnWidth(), turns: 0, age: 0, flags: 0 };
	for (const row of rows) {
		widths.turns = Math.max(widths.turns, visibleWidth(conversationTurns(row)));
		widths.age = Math.max(widths.age, visibleWidth(conversationAge(row, now)));
		const flags = conversationFlags(row)
			.map(flag => flag.text)
			.join(` ${theme.sep.dot} `);
		widths.flags = Math.max(widths.flags, visibleWidth(flags));
	}
	return widths;
}

/** `⋯` at the right edge of a menu-bearing row. */
function menuAffordance(): string {
	return theme.fg("muted", "⋯");
}

/**
 * One dense conversation row: `status | title | turns | age | flags | ⋯`.
 * The status cell and every metadata column have fixed widths computed once
 * per frame; the title is the only flexible cell, and nothing ever wraps.
 */
export function renderConversationRow(
	row: ResumeTreeConversationRow,
	options: {
		width: number;
		selected: boolean;
		now?: number;
		columns?: ConversationColumns;
		/** Show the conversation cwd as an absolute path instead of omitting it. */
		fullPaths?: boolean;
	},
): string {
	const selected = options.selected;
	const cursor = selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(CONVERSATION_INDENT);
	const columns = options.columns ?? conversationColumns([row], options.now);
	const status = statusWord(row.conversation.status);
	const flags = conversationFlags(row);
	const parts: { id: "turns" | "age" | "flags"; text: string }[] = [
		{ id: "turns", text: padStartVisible(conversationTurns(row), columns.turns) },
		{ id: "age", text: padStartVisible(conversationAge(row, options.now), columns.age) },
	];
	if (flags.length > 0) {
		parts.push({
			id: "flags",
			text: padStartVisible(
				flags.map(flag => theme.fg(flag.tone, flag.text)).join(` ${theme.fg("dim", theme.sep.dot)} `),
				columns.flags,
			),
		});
	}
	const available = Math.max(1, options.width - visibleWidth(cursor) - visibleWidth(indent));
	const statusWidth = columns.status + 2; // word + two-column gutter
	const menu = menuAffordance();
	// Drop metadata only when the title would otherwise be unreadable, in
	// priority order: flags, turns, age. The menu glyph never drops.
	const dropOrder: ("flags" | "turns" | "age")[] = ["flags", "turns", "age"];
	const joinParts = () => parts.map(part => part.text).join(` ${theme.fg("dim", theme.sep.dot)} `);
	while (parts.length > 0 && statusWidth + 8 + visibleWidth(joinParts()) + MENU_WIDTH + 1 > available) {
		const id = dropOrder.shift();
		if (!id) break;
		const index = parts.findIndex(part => part.id === id);
		if (index >= 0) parts.splice(index, 1);
	}
	const metadata = joinParts();
	const right = metadata ? `${metadata} ${menu}` : menu;
	const leftBudget = Math.max(1, available - statusWidth - visibleWidth(right) - 1);
	// Full mode adds the cwd as a dim detail after the title; the path takes a
	// bounded share of the flexible area so the title stays readable.
	const detail = options.fullPaths ? absoluteResumePath(row.conversation.cwd) : "";
	let detailText = "";
	let titleWidth = leftBudget;
	if (detail) {
		const detailBudget = Math.min(40, Math.floor(leftBudget * 0.45));
		if (detailBudget >= 8 && leftBudget - detailBudget - 2 >= 8) {
			detailText = `  ${theme.fg("dim", truncateResumePath(detail, detailBudget))}`;
			titleWidth = leftBudget - visibleWidth(detailText);
		}
	}
	const title = truncateToWidth(row.conversation.title || row.conversation.id, Math.max(1, titleWidth));
	const statusText = status ? theme.fg(status.tone, padStartVisible(status.text, columns.status)) : "";
	const left = `${statusText}${" ".repeat(Math.max(0, statusWidth - visibleWidth(statusText)))}${title}${detailText}`;
	const line = alignRow("", left, right, available);
	const rendered = selected ? theme.bold(line) : line;
	return truncateToWidth(`${cursor}${indent}${rendered}`, options.width);
}

/**
 * One workspace sub-header, indented one visible step: a coloured fold+name,
 * a branch chip when it adds information, and right-aligned counts + `⋯`.
 */
export function renderWorkspaceRow(
	row: ResumeTreeWorkspaceRow,
	options: {
		width: number;
		selected: boolean;
		collapsed: boolean;
		referenceBranch?: string | null;
		current?: boolean;
		/** Show absolute workspace paths instead of parent/name tails. */
		fullPaths?: boolean;
		/** Workspace scope has no use for the path label; callers can omit it. */
		showPath?: boolean;
	},
): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(WORKSPACE_INDENT);
	const fold = options.collapsed ? "▸" : "▾";
	const name = row.workspace.displayName || row.workspace.alias || row.workspace.name || row.workspace.path;
	const branch = shouldShowBranch(row.workspace.branch, options.referenceBranch, options.current === true, name)
		? ` ${theme.fg("warning", `[${row.workspace.branch}]`)}`
		: "";
	const nameStyled = theme.bold(theme.fg("accent", name));
	const right = `${theme.fg("dim", conversationCountText(row))} ${menuAffordance()}`;
	const budget = leftBudgetFor(cursor, [right], options.width);
	const base = `${theme.fg("muted", fold)} ${nameStyled}${branch}`;
	const path = options.showPath === false ? "" : formatResumePath(row.workspace.path, options.fullPaths === true);
	const pathBudget = budget.budget - visibleWidth(indent) - visibleWidth(base) - 2;
	const pathText = path && pathBudget >= 4 ? `  ${theme.fg("dim", truncateResumePath(path, pathBudget))}` : "";
	return alignRow(cursor, indent + base + pathText, budget.right, options.width);
}

/**
 * Project section header: pin + name + path tag on the left, counts/workspaces/
 * age right-aligned. The caller draws a full-width rule under it.
 */
export function renderProjectRow(
	row: ResumeTreeProjectRow,
	options: {
		width: number;
		selected: boolean;
		collapsed: boolean;
		now?: number;
		/** Show the absolute project root instead of the parent/name tail. */
		fullPaths?: boolean;
	},
): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(PROJECT_INDENT);
	const fold = options.collapsed ? "▸" : "▾";
	const pin = row.pinned ? `${theme.icon.pin} ` : "";
	const name = row.project.displayName || row.project.name;
	const workspaces =
		row.totalWorkspaceCount === 1
			? tuiText("resumeWorkspaceCountOne", "1 workspace")
			: tuiTextFmt("resumeWorkspaceCountFmt", "%d workspaces", row.totalWorkspaceCount);
	const count = theme.fg("dim", conversationCountText(row));
	const activity = row.project.lastActivity
		? theme.fg("dim", formatResumeAge(row.project.lastActivity, options.now))
		: "";
	const right = [count, theme.fg("dim", workspaces), activity]
		.filter(Boolean)
		.join(` ${theme.fg("dim", theme.sep.dot)} `);
	const compact = [count, theme.fg("dim", workspaces)].filter(Boolean).join(` ${theme.fg("dim", theme.sep.dot)} `);
	const budget = leftBudgetFor(cursor, [right, compact, count], options.width);
	const base = `${indent}${theme.fg("muted", fold)} ${pin}${theme.bold(theme.fg("accent", name))}`;
	const path = formatResumePath(row.project.root, options.fullPaths === true);
	const pathBudget = budget.budget - visibleWidth(base) - 3; // ` (` + `)` + a space
	const pathTag = path && pathBudget >= 3 ? ` ${theme.fg("dim", `(${truncateResumePath(path, pathBudget)})`)}` : "";
	return alignRow(cursor, base + pathTag, budget.right, options.width);
}

/** Full-width rule closing a project section header. */
export function renderProjectRule(width: number): string {
	return truncateToWidth(theme.fg("dim", theme.boxRound.horizontal.repeat(Math.max(0, width))), width);
}

/** A scope-segment hit range on the header line, in tree-local columns. */
export interface ResumeScopeHit {
	kind: ResumeTreeScope;
	start: number;
	end: number;
}

/** The three-tab scope control with per-scope counts, plus its clickable ranges. */
export function renderScopeHeaderHits(
	scope: ResumeTreeScope,
	summary: ResumeTreeScopeSummary,
	width: number,
): { text: string; hits: ResumeScopeHit[] } {
	const labels: { kind: ResumeTreeScope; label: string }[] = [
		{ kind: "workspace", label: tuiText("resumeScopeWorkspace", "this workspace") },
		{ kind: "project", label: tuiText("resumeScopeProject", "this repository") },
		{ kind: "all", label: tuiText("resumeScopeAll", "all projects") },
	];
	const parts: { text: string; priority: number; kind?: ResumeTreeScope; plain?: string }[] = [];
	for (const { kind, label } of labels) {
		const selected = kind === scope;
		const count = summary.counts[kind] ?? 0;
		const plain = `${selected ? "[" : " "}${label}${selected ? "]" : " "}`;
		parts.push({
			text: selected ? theme.bold(theme.fg("accent", plain)) : theme.fg("muted", plain),
			priority: selected ? 1_000 : 100,
			kind,
			plain,
		});
		parts.push({ text: theme.fg("dim", `${count}`), priority: selected ? 200 : 40 });
	}
	let rendered = parts.map(part => part.text).join(" ");
	const dropable = parts.filter(part => part.priority < 1_000).sort((a, b) => a.priority - b.priority);
	while (visibleWidth(rendered) > width && dropable.length > 0) {
		const part = dropable.shift()!;
		const index = parts.indexOf(part);
		if (index >= 0) parts.splice(index, 1);
		rendered = parts.map(entry => entry.text).join(" ");
	}
	if (visibleWidth(rendered) > width) return { text: truncateToWidth(rendered, width), hits: [] };
	const hits: ResumeScopeHit[] = [];
	let column = 0;
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index]!;
		const partWidth = visibleWidth(part.text);
		if (part.kind) {
			// The count immediately follows its label; both switch the scope.
			const count = parts[index + 1];
			const countWidth = count ? 1 + visibleWidth(count.text) : 0;
			hits.push({ kind: part.kind, start: column, end: column + partWidth - 1 + countWidth });
		}
		column += partWidth + (index < parts.length - 1 ? 1 : 0);
	}
	return { text: rendered, hits };
}

/** The three-tab scope control with per-scope counts. */
export function renderScopeHeader(scope: ResumeTreeScope, summary: ResumeTreeScopeSummary, width: number): string {
	return renderScopeHeaderHits(scope, summary, width).text;
}

interface FlatRow {
	row: ResumeTreeRow;
	/** Visible when every ancestor group is expanded. */
	parentKey?: string;
}

/** Project and workspace keys can be the same path, so identity includes the level. */
function rowIdentity(row: ResumeTreeRow): string {
	return `${row.type}:${row.key}`;
}

/** Project rows keep their model-side collapsed flag unless the user overrode it. */
function projectCollapsed(row: ResumeTreeProjectRow, state: ResumeTreeState): boolean {
	return state.expandedProjects.has(row.key) ? false : state.collapsedProjects.has(row.key) || row.collapsed;
}

export interface ResumeTreeState {
	collapsedProjects: Set<string>;
	expandedProjects: Set<string>;
	collapsedWorkspaces: Set<string>;
}

type ResumeTreeMenuKind = "workspace" | "conversation";
type ResumeTreeMenuAction = "rename" | "toggle" | "open" | "pin" | "delete";

interface ResumeTreeMenuItem {
	id: ResumeTreeMenuAction;
	label: string;
	disabled?: boolean;
}

interface ResumeTreeMenu {
	kind: ResumeTreeMenuKind;
	rowKey: string;
	items: ResumeTreeMenuItem[];
	index: number;
	workspace?: ResumeTreeWorkspace;
	conversation?: ResumeTreeConversation;
}

interface ResumeTreeRename {
	rowKey: string;
	kind: ResumeTreeMenuKind;
	value: string;
	workspace?: ResumeTreeWorkspace;
	conversation?: ResumeTreeConversation;
}

/** A clickable button range on one rendered line. */
interface ResumeButtonHit {
	start: number;
	end: number;
}

/** Flatten model rows under the current local collapse state (headers always stay). */
export function flattenResumeRows(
	rows: readonly ResumeTreeRow[],
	state: ResumeTreeState,
	searching: boolean,
): FlatRow[] {
	const flat: FlatRow[] = [];
	let collapsedProject: string | undefined;
	let collapsedWorkspace: string | undefined;
	for (const row of rows) {
		if (row.type === "project") {
			flat.push({ row });
			collapsedProject = searching || !projectCollapsed(row, state) ? undefined : row.key;
			collapsedWorkspace = undefined;
			continue;
		}
		if (row.type === "workspace") {
			if (collapsedProject) continue;
			flat.push({ row, parentKey: row.projectKey });
			collapsedWorkspace = state.collapsedWorkspaces.has(row.key) && !searching ? row.key : undefined;
			continue;
		}
		if (collapsedProject || collapsedWorkspace) continue;
		flat.push({ row, parentKey: row.workspaceKey });
	}
	return flat;
}

/**
 * The ANSI resume tree component. The host mounts it inside its panel chrome;
 * this component renders the scope control, search field, banners and rows.
 */
export class ResumeTreeComponent implements Component {
	readonly #source: ResumeTreeSource;
	readonly #search: Input;
	readonly #getTerminalRows: () => number;
	readonly #state: ResumeTreeState = {
		collapsedProjects: new Set(),
		expandedProjects: new Set(),
		collapsedWorkspaces: new Set(),
	};
	#scope: ResumeTreeScope;
	#fullPaths = false;
	#view: ResumeTreeView | null = null;
	#viewQuery = "\0";
	#viewScope: ResumeTreeScope | null = null;
	#searchFocused: boolean;
	#selectedKey: string | undefined;
	#scrollOffset = 0;
	#deleteTarget: ResumeTreeConversationRow | null = null;
	#busy = false;
	#notice: string | undefined;
	#expandedOnce = false;
	#menu: ResumeTreeMenu | undefined;
	#rename: ResumeTreeRename | undefined;
	/** Row hit map captured from the last render (`row → action`). */
	#hitRows = new Map<number, { kind: "conversation" | "toggle"; key: string }>();
	/** Lines whose last column is the row's `⋯` menu affordance. */
	#menuHits = new Map<number, { kind: ResumeTreeMenuKind; key: string; start: number }>();
	/** Menu item lines captured from the last render. */
	#menuItemHits = new Map<number, number>();
	/** Rename/delete modal button ranges, keyed by rendered line. */
	#renameButtonHits = new Map<number, { confirm?: ResumeButtonHit; cancel?: ResumeButtonHit }>();
	#deleteButtonHits = new Map<number, { confirm?: ResumeButtonHit; cancel?: ResumeButtonHit }>();
	/** Scope-segment hit ranges on the header line. */
	#scopeHits: ResumeScopeHit[] = [];
	/** Local line/column offset of this component inside the fullscreen frame. */
	#lineOffset = 0;
	#columnOffset = 0;
	#lastClick: { key: string; time: number } | undefined;
	readonly onSelect: (conversation: ResumeTreeConversation) => void;
	readonly onCancel: () => void;
	readonly onExit: () => void;
	onRequestRender?: () => void;

	constructor(options: ResumeTreeOptions) {
		this.#source = options.source;
		this.#scope = options.source.initialScope;
		this.#getTerminalRows = options.getTerminalRows ?? (() => 24);
		this.#searchFocused = options.searchFocused ?? true;
		this.onSelect = options.onSelect;
		this.onCancel = options.onCancel;
		this.onExit = options.onExit;
		this.onRequestRender = options.onRequestRender;
		const restored = options.source.pickerState?.();
		if (restored) {
			this.#scope = restored.scope;
			this.#fullPaths = restored.fullPaths === true;
			for (const key of restored.collapsedProjects ?? []) this.#state.collapsedProjects.add(key);
			for (const key of restored.expandedProjects ?? []) this.#state.expandedProjects.add(key);
			for (const key of restored.collapsedWorkspaces ?? []) this.#state.collapsedWorkspaces.add(key);
		}
		this.#search = new Input();
		this.#search.prompt = "/ ";
		this.#search.onSubmit = () => this.#activate();
		this.#search.onEscape = () => this.#clearSearch();
	}

	/** Persist scope + local expansion together (the host owns the file). */
	#persistState(): void {
		const state: ResumeTreePickerState = {
			scope: this.#scope,
			collapsedProjects: [...this.#state.collapsedProjects],
			expandedProjects: [...this.#state.expandedProjects],
			collapsedWorkspaces: [...this.#state.collapsedWorkspaces],
			fullPaths: this.#fullPaths,
		};
		if (this.#source.persistPickerState) void this.#source.persistPickerState(state);
		else void this.#source.persistScope?.(this.#scope);
	}

	/** Rebuild the cached view (call after the host refreshes its directory). */
	invalidate(): void {
		this.#view = null;
		this.#viewQuery = "\0";
	}

	get scope(): ResumeTreeScope {
		return this.#scope;
	}

	get fullPaths(): boolean {
		return this.#fullPaths;
	}

	/**
	 * Toggle absolute paths. In workspace scope the path is redundant, so the
	 * key surfaces a one-line hint and leaves the setting untouched; the
	 * project/all scopes actually flip and persist it.
	 */
	toggleFullPaths(): void {
		if (this.#scope === "workspace") {
			this.#notice = tuiText(
				"resumeFullPathsWorkspaceHint",
				"Full paths matter outside this workspace — press f after Tab",
			);
			this.onRequestRender?.();
			return;
		}
		this.#fullPaths = !this.#fullPaths;
		this.#notice = undefined;
		this.#persistState();
		this.onRequestRender?.();
	}

	/** Adopt a host-refreshed view while keeping selection and collapse state. */
	setView(view: ResumeTreeView | null): void {
		this.#view = view;
		this.#viewScope = this.#scope;
		this.#viewQuery = this.#search.getValue();
	}

	/** Cycle workspace → project → all → workspace. */
	cycleScope(direction: 1 | -1 = 1): void {
		const order: ResumeTreeScope[] = ["workspace", "project", "all"];
		const index = order.indexOf(this.#scope);
		this.setScope(order[(index + direction + order.length) % order.length]!);
	}

	/** Switch to a scope (the scope segments and Tab share this path). */
	setScope(scope: ResumeTreeScope): void {
		if (scope === this.#scope) return;
		this.#scope = scope;
		this.#notice = undefined;
		this.invalidate();
		this.#persistState();
		this.#rebuild();
		this.onRequestRender?.();
	}

	/** Re-read the directory through the host source. */
	async refresh(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		this.#notice = undefined;
		this.onRequestRender?.();
		try {
			await this.#source.refresh?.();
			this.invalidate();
			this.#rebuild();
		} catch (error) {
			this.#notice = tuiTextFmt(
				"ssErrorPrefixFmt",
				"Error: %s",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.#busy = false;
			this.onRequestRender?.();
		}
	}

	/** Focus the search field (the `/` key, and the initial state). */
	focusSearch(): void {
		this.#searchFocused = true;
	}

	#clearSearch(): void {
		if (this.#search.getValue().length === 0) {
			this.onCancel();
			return;
		}
		this.#search.setValue("");
		this.#searchFocused = false;
		this.invalidate();
		this.#rebuild();
	}

	#visibleRows(): FlatRow[] {
		const view = this.#viewFor();
		if (!view) return [];
		const searching = view.query.raw.trim().length > 0;
		return flattenResumeRows(view.rows, this.#state, searching);
	}

	#viewFor(): ResumeTreeView | null {
		const query = this.#search.getValue();
		if (this.#view && this.#viewScope === this.#scope && this.#viewQuery === query) return this.#view;
		this.#view = this.#source.buildView({
			scope: this.#scope,
			query,
			currentSessionPath: this.#source.currentSessionPath?.(),
		});
		this.#viewScope = this.#scope;
		this.#viewQuery = query;
		if (!this.#expandedOnce) {
			// Seed local collapse state from the model so the first paint agrees
			// with the persisted project flags.
			const view = this.#view;
			if (view) {
				for (const row of view.rows) {
					if (row.type === "project" && row.collapsed) this.#state.collapsedProjects.add(row.key);
				}
			}
			this.#expandedOnce = true;
		}
		return this.#view;
	}

	#rebuild(): void {
		const flat = this.#visibleRows();
		if (flat.length === 0) {
			this.#selectedKey = undefined;
			return;
		}
		if (!this.#selectedKey || !flat.some(entry => rowIdentity(entry.row) === this.#selectedKey)) {
			this.#selectedKey = rowIdentity(flat[0]!.row);
		}
		this.#clampScroll();
	}

	#selectedIndex(flat: readonly FlatRow[]): number {
		if (this.#selectedKey === undefined) return 0;
		const index = flat.findIndex(entry => rowIdentity(entry.row) === this.#selectedKey);
		return index < 0 ? 0 : index;
	}

	#move(delta: number): void {
		this.#searchFocused = false;
		const flat = this.#visibleRows();
		if (flat.length === 0) return;
		const next = Math.max(0, Math.min(flat.length - 1, this.#selectedIndex(flat) + delta));
		this.#selectedKey = rowIdentity(flat[next]!.row);
		this.#clampScroll();
	}

	#pageSize(): number {
		return Math.max(2, Math.floor(this.#listHeight() / 2));
	}

	#listHeight(): number {
		return Math.max(3, this.#getTerminalRows() - 9);
	}

	/** Rendered line count for one row: a project header carries a rule under it. */
	#rowLines(row: ResumeTreeRow): number {
		return row.type === "project" ? 2 : 1;
	}

	#clampScroll(): void {
		const flat = this.#visibleRows();
		const height = this.#listHeight();
		const index = this.#selectedIndex(flat);
		let start = Math.min(this.#scrollOffset, index);
		const linesFrom = (from: number, to: number) => {
			let total = 0;
			for (let cursor = from; cursor < to; cursor++) total += this.#rowLines(flat[cursor]!.row);
			return total;
		};
		while (start < index && linesFrom(start, index) + this.#rowLines(flat[index]!.row) > height) start++;
		if (start > index) start = index;
		this.#scrollOffset = Math.max(0, Math.min(start, Math.max(0, flat.length - 1)));
	}

	#selectRow(row: ResumeTreeRow): void {
		if (row.type === "conversation") {
			this.onSelect(row.conversation);
			return;
		}
		this.#toggleCollapse(row);
	}

	#toggleCollapse(row: ResumeTreeProjectRow | ResumeTreeWorkspaceRow): void {
		if (row.type === "project") {
			const expanded = !projectCollapsed(row, this.#state);
			this.#state.collapsedProjects.delete(row.key);
			this.#state.expandedProjects.delete(row.key);
			if (expanded) this.#state.collapsedProjects.add(row.key);
			else this.#state.expandedProjects.add(row.key);
		} else if (this.#state.collapsedWorkspaces.has(row.key)) {
			this.#state.collapsedWorkspaces.delete(row.key);
		} else {
			this.#state.collapsedWorkspaces.add(row.key);
		}
		this.#persistState();
		this.#clampScroll();
		this.onRequestRender?.();
	}

	#collapseOrParent(): void {
		this.#searchFocused = false;
		const flat = this.#visibleRows();
		const index = this.#selectedIndex(flat);
		const entry = flat[index];
		if (!entry) return;
		const row = entry.row;
		if (row.type === "conversation") {
			this.#selectedKey = `workspace:${row.workspaceKey}`;
			return;
		}
		if (row.type === "workspace") {
			if (!this.#state.collapsedWorkspaces.has(row.key)) {
				this.#state.collapsedWorkspaces.add(row.key);
				return;
			}
			this.#selectedKey = `project:${row.projectKey}`;
			return;
		}
		if (!projectCollapsed(row, this.#state)) {
			this.#state.collapsedProjects.add(row.key);
			this.#state.expandedProjects.delete(row.key);
		}
	}

	#expandOrChild(): void {
		this.#searchFocused = false;
		const flat = this.#visibleRows();
		const index = this.#selectedIndex(flat);
		const entry = flat[index];
		if (!entry) return;
		const row = entry.row;
		if (row.type === "project") {
			if (projectCollapsed(row, this.#state)) {
				this.#state.collapsedProjects.delete(row.key);
				this.#state.expandedProjects.add(row.key);
				return;
			}
			const child = flat[index + 1];
			if (child && child.row.type !== "conversation") this.#selectedKey = rowIdentity(child.row);
			return;
		}
		if (row.type === "workspace") {
			if (this.#state.collapsedWorkspaces.has(row.key)) {
				this.#state.collapsedWorkspaces.delete(row.key);
				return;
			}
			const child = flat[index + 1];
			if (child?.row.type === "conversation") this.#selectedKey = rowIdentity(child.row);
		}
	}

	/** Open the small action menu for a workspace or conversation row. */
	#openMenu(row: ResumeTreeWorkspaceRow | ResumeTreeConversationRow): void {
		const isWorkspace = row.type === "workspace";
		const items: ResumeTreeMenuItem[] = [];
		if (isWorkspace) {
			items.push({
				id: "rename",
				label: tuiText("resumeMenuRename", "rename"),
				disabled: !this.#source.renameWorkspace,
			});
			items.push({
				id: "toggle",
				label: this.#state.collapsedWorkspaces.has(row.key)
					? tuiText("resumeMenuExpand", "expand")
					: tuiText("resumeMenuCollapse", "collapse"),
			});
			items.push({
				id: "open",
				label: tuiText("resumeMenuOpen", "open in file manager"),
				disabled: !this.#source.openWorkspace,
			});
			items.push({
				id: "pin",
				label: row.workspace.pinned ? tuiText("resumeUnpinAction", "Unpin") : tuiText("resumePinAction", "Pin"),
				disabled: !this.#source.pinWorkspace,
			});
		} else {
			items.push({
				id: "rename",
				label: tuiText("resumeMenuRename", "rename"),
				disabled:
					!this.#source.renameConversation || this.#source.canRenameConversation?.(row.conversation) === false,
			});
			items.push({
				id: "pin",
				label: row.pinned ? tuiText("resumeUnpinAction", "Unpin") : tuiText("resumePinAction", "Pin"),
				disabled: !this.#source.pinConversation,
			});
			items.push({
				id: "delete",
				label:
					this.#source.deleteMode === "trash"
						? tuiText("resumeDeleteTrash", "Move to trash")
						: tuiText("resumeDeletePermanent", "Delete"),
				disabled: !this.#source.deleteConversation,
			});
		}
		this.#menu = {
			kind: isWorkspace ? "workspace" : "conversation",
			rowKey: rowIdentity(row),
			items,
			index: Math.max(
				0,
				items.findIndex(item => !item.disabled),
			),
			...(isWorkspace ? { workspace: row.workspace } : { conversation: row.conversation }),
		};
		this.#searchFocused = false;
		this.onRequestRender?.();
	}

	/** Open the menu for the selected row (`m`, or the right-edge affordance). */
	#openSelectedMenu(): void {
		const flat = this.#visibleRows();
		const row = flat[this.#selectedIndex(flat)]?.row;
		if (row?.type === "workspace" || row?.type === "conversation") this.#openMenu(row);
	}

	#moveMenuItem(delta: 1 | -1): void {
		const menu = this.#menu;
		if (!menu) return;
		if (menu.items.every(item => item.disabled)) return;
		let index = menu.index;
		for (let attempt = 0; attempt < menu.items.length; attempt++) {
			index = (index + delta + menu.items.length) % menu.items.length;
			if (!menu.items[index]!.disabled) break;
		}
		menu.index = index;
		this.onRequestRender?.();
	}

	async #runMenuItem(): Promise<void> {
		const menu = this.#menu;
		if (!menu) return;
		const item = menu.items[menu.index];
		if (!item || item.disabled) return;
		this.#menu = undefined;
		if (item.id === "rename") {
			this.#beginRename(menu.kind, menu.rowKey, menu.workspace, menu.conversation);
			return;
		}
		const flat = this.#visibleRows();
		const entry = flat.find(candidate => rowIdentity(candidate.row) === menu.rowKey);
		const row = entry?.row;
		if (item.id === "toggle" && row?.type === "workspace") {
			this.#toggleCollapse(row);
			return;
		}
		if (item.id === "open" && menu.workspace) {
			await this.#source.openWorkspace?.(menu.workspace);
			this.onRequestRender?.();
			return;
		}
		if (item.id === "pin") {
			await this.#pinRow(menu);
			return;
		}
		if (item.id === "delete" && row?.type === "conversation") {
			this.#deleteTarget = row;
			this.onRequestRender?.();
		}
	}

	async #pinRow(menu: ResumeTreeMenu): Promise<void> {
		if (menu.kind === "workspace" && menu.workspace) {
			await this.#source.pinWorkspace?.(menu.workspace, !menu.workspace.pinned);
		} else if (menu.conversation) {
			await this.#source.pinConversation?.(menu.conversation, !menu.conversation.pinned);
		}
		await this.#refreshAfterMutation();
	}

	/** Open the rename sub-input for a workspace or conversation row. */
	#beginRename(
		kind: ResumeTreeMenuKind,
		rowKey: string,
		workspace?: ResumeTreeWorkspace,
		conversation?: ResumeTreeConversation,
	): void {
		if (kind === "workspace") {
			if (!workspace || !this.#source.renameWorkspace) return;
		} else if (
			!conversation ||
			!this.#source.renameConversation ||
			this.#source.canRenameConversation?.(conversation) === false
		) {
			return;
		}
		this.#rename = {
			rowKey,
			kind,
			value: kind === "workspace" ? (workspace!.alias ?? workspace!.name) : conversation!.title || conversation!.id,
			...(workspace ? { workspace } : {}),
			...(conversation ? { conversation } : {}),
		};
		this.#menu = undefined;
		this.#searchFocused = false;
		this.#notice = undefined;
		this.onRequestRender?.();
	}

	/** Ctrl+R: rename the selected workspace/conversation; project rows are inert. */
	#renameSelected(): void {
		const flat = this.#visibleRows();
		const row = flat[this.#selectedIndex(flat)]?.row;
		if (row?.type === "workspace") this.#beginRename("workspace", rowIdentity(row), row.workspace);
		else if (row?.type === "conversation") {
			this.#beginRename("conversation", rowIdentity(row), undefined, row.conversation);
		}
	}

	async #commitRename(): Promise<void> {
		const rename = this.#rename;
		if (!rename || this.#busy) return;
		const value = rename.value.trim();
		if (!value) {
			this.#notice = tuiText("resumeRenameEmpty", "A name is required.");
			this.onRequestRender?.();
			return;
		}
		let stored: string | null = null;
		try {
			stored =
				rename.kind === "workspace"
					? ((await this.#source.renameWorkspace?.(rename.workspace!, value)) ?? null)
					: ((await this.#source.renameConversation?.(rename.conversation!, value)) ?? null);
		} catch (error) {
			this.#notice = tuiTextFmt(
				"resumeRenameFailedFmt",
				"Rename failed: %s",
				error instanceof Error ? error.message : String(error),
			);
			this.onRequestRender?.();
			return;
		}
		if (stored === null) {
			this.#notice = tuiText("resumeRenameFailed", "The name was not changed.");
			this.onRequestRender?.();
			return;
		}
		this.#rename = undefined;
		await this.#refreshAfterMutation();
		this.#verifyRename(rename, stored);
	}

	/** Confirm the refreshed row shows what was stored; otherwise say so. */
	#verifyRename(rename: ResumeTreeRename, stored: string): void {
		const row = this.#view?.rows.find(candidate => rowIdentity(candidate) === rename.rowKey);
		if (!row) return;
		const shown =
			row.type === "conversation"
				? row.conversation.title
				: row.type === "workspace"
					? (row.workspace.displayName ?? row.workspace.name)
					: row.project.displayName;
		this.#notice =
			shown !== stored
				? tuiTextFmt("resumeRenameMismatchFmt", "Renamed, but the list still shows “%s”", shown)
				: undefined;
		this.onRequestRender?.();
	}

	async #refreshAfterMutation(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		try {
			await this.#source.refresh?.();
			this.invalidate();
			this.#rebuild();
		} catch (error) {
			this.#notice = tuiTextFmt(
				"ssErrorPrefixFmt",
				"Error: %s",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.#busy = false;
			this.onRequestRender?.();
		}
	}

	/** The rename box owns every key; the search text is never touched. */
	#handleRenameKey(keyData: string): void {
		const rename = this.#rename;
		if (!rename) return;
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			void this.#commitRename();
			return;
		}
		if (matchesAppInterrupt(keyData) || matchesKey(keyData, "escape")) {
			this.#rename = undefined;
			this.onRequestRender?.();
			return;
		}
		if (matchesKey(keyData, "backspace") || keyData === "\x7f") {
			rename.value = [...rename.value].slice(0, -1).join("");
			this.onRequestRender?.();
			return;
		}
		// Printable characters (including a pasted run) are literal text: `/`,
		// `m`, `p`, `f` and `r` keep their letter meaning only outside this box.
		if (
			keyData.length > 0 &&
			!keyData.startsWith("\x1b") &&
			[...keyData].every(char => char >= " " && char !== "\x7f")
		) {
			rename.value += keyData;
			this.onRequestRender?.();
		}
	}

	/** The delete modal owns every key except Ctrl+C (handled globally). */
	#handleDeleteKey(keyData: string): void {
		if (matchesAppInterrupt(keyData) || matchesKey(keyData, "escape") || keyData === "n") {
			this.#deleteTarget = null;
			this.onRequestRender?.();
			return;
		}
		if (keyData === "y" || matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			void this.#confirmDelete();
		}
	}

	#handleMenuKey(keyData: string): void {
		const menu = this.#menu;
		if (!menu) return;
		if (matchesSelectUp(keyData)) {
			this.#moveMenuItem(-1);
			return;
		}
		if (matchesSelectDown(keyData)) {
			this.#moveMenuItem(1);
			return;
		}
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			void this.#runMenuItem();
			return;
		}
		if (matchesAppInterrupt(keyData) || matchesKey(keyData, "escape") || keyData === "m") {
			this.#menu = undefined;
			this.onRequestRender?.();
		}
	}

	#activate(): void {
		const flat = this.#visibleRows();
		const row = flat[this.#selectedIndex(flat)]?.row;
		if (row) this.#selectRow(row);
	}

	#requestDelete(): void {
		const flat = this.#visibleRows();
		const row = flat[this.#selectedIndex(flat)]?.row;
		if (row?.type !== "conversation") return;
		this.#deleteTarget = row;
		this.onRequestRender?.();
	}

	async #confirmDelete(): Promise<void> {
		const target = this.#deleteTarget;
		if (!target || this.#busy) return;
		this.#deleteTarget = null;
		this.#busy = true;
		try {
			await this.#source.deleteConversation?.(target.conversation);
			await this.#source.refresh?.();
			this.invalidate();
			this.#rebuild();
		} catch (error) {
			this.#notice = tuiTextFmt(
				"ssErrorPrefixFmt",
				"Error: %s",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.#busy = false;
			this.onRequestRender?.();
		}
	}

	/** Pin the selected conversation (`p`) or its project (`P`). */
	async pinSelected(project: boolean): Promise<void> {
		const flat = this.#visibleRows();
		const row = flat[this.#selectedIndex(flat)]?.row;
		if (!row) return;
		this.#busy = true;
		try {
			if (project) {
				const projectKey = row.type === "project" ? row.key : row.projectKey;
				const target = row.type === "project" ? row.project : this.#source.projectByKey?.(projectKey);
				if (target && !target.isDefault) await this.#source.pinProject?.(target, !target.pinned);
			} else if (row.type === "conversation") {
				await this.#source.pinConversation?.(row.conversation, !row.pinned);
			}
			await this.#source.refresh?.();
			this.invalidate();
			this.#rebuild();
		} finally {
			this.#busy = false;
			this.onRequestRender?.();
		}
	}

	/**
	 * Hit-test an SGR mouse report against the rows the last render recorded.
	 * The fullscreen picker paints from screen row 0, so callers pass the
	 * component's frame offset (`row` of the first rendered line, `col` of its
	 * first content column). Keyboard handling never depends on this path.
	 */
	handleMouse(data: string, offset: { row?: number; col?: number } = {}): boolean {
		return routeSgrMouseInput(data, event => this.#routeMouse(event, offset));
	}

	#routeMouse(event: SgrMouseEvent, offset: { row?: number; col?: number }): boolean {
		const line = event.row - (offset.row ?? this.#lineOffset);
		const column = event.col - (offset.col ?? this.#columnOffset);
		if (this.#rename || this.#deleteTarget) {
			if (!event.leftClick) return true;
			const hits = this.#rename ? this.#renameButtonHits : this.#deleteButtonHits;
			const hit = hits.get(line);
			if (hit?.confirm && column >= hit.confirm.start && column <= hit.confirm.end) {
				if (this.#rename) void this.#commitRename();
				else void this.#confirmDelete();
			} else if (hit?.cancel && column >= hit.cancel.start && column <= hit.cancel.end) {
				if (this.#rename) this.#rename = undefined;
				else this.#deleteTarget = null;
				this.onRequestRender?.();
			}
			// Clicks elsewhere keep the modal open.
			return true;
		}
		if (event.wheel !== null) {
			this.#move(event.wheel * 3);
			this.onRequestRender?.();
			return true;
		}
		if (!event.leftClick) return true;
		if (this.#menu) {
			const itemIndex = this.#menuItemHits.get(line);
			if (itemIndex !== undefined) {
				this.#menu.index = itemIndex;
				void this.#runMenuItem();
				return true;
			}
			this.#menu = undefined;
		}
		if (line === 0) {
			const segment = this.#scopeHits.find(hit => column >= hit.start && column <= hit.end);
			if (segment) this.setScope(segment.kind);
			return true;
		}
		const menuHit = this.#menuHits.get(line);
		if (menuHit && column >= menuHit.start) {
			const flat = this.#visibleRows();
			const entry = flat.find(candidate => rowIdentity(candidate.row) === menuHit.key);
			if (entry && (entry.row.type === "workspace" || entry.row.type === "conversation")) {
				this.#selectedKey = menuHit.key;
				this.#openMenu(entry.row);
			}
			return true;
		}
		const hit = this.#hitRows.get(line);
		if (!hit) return true;
		const flat = this.#visibleRows();
		const entry = flat.find(candidate => rowIdentity(candidate.row) === hit.key);
		if (!entry) return true;
		this.#searchFocused = false;
		this.#selectedKey = hit.key;
		this.#clampScroll();
		if (hit.kind === "toggle") {
			const row = entry.row;
			if (row.type === "project" || row.type === "workspace") this.#toggleCollapse(row);
			return true;
		}
		const now = Date.now();
		const doubleClick =
			this.#lastClick !== undefined && this.#lastClick.key === hit.key && now - this.#lastClick.time <= 400;
		this.#lastClick = doubleClick ? undefined : { key: hit.key, time: now };
		if (doubleClick && entry.row.type === "conversation") this.onSelect(entry.row.conversation);
		else this.onRequestRender?.();
		return true;
	}

	handleInput(keyData: string): void {
		if (this.#busy) return;
		if (keyData.startsWith("\x1b[<")) {
			this.handleMouse(keyData);
			return;
		}
		if (matchesKey(keyData, "ctrl+c")) {
			this.onExit();
			return;
		}
		if (this.#rename) {
			this.#handleRenameKey(keyData);
			return;
		}
		if (this.#deleteTarget) {
			this.#handleDeleteKey(keyData);
			return;
		}
		if (matchesKey(keyData, "ctrl+r")) {
			this.#renameSelected();
			return;
		}
		if (this.#menu) {
			this.#handleMenuKey(keyData);
			return;
		}
		if (!this.#searchFocused && keyData === "m") {
			this.#openSelectedMenu();
			return;
		}
		if (matchesKey(keyData, "tab")) {
			this.cycleScope(1);
			return;
		}
		if (keyData === "\x1b[Z") {
			this.cycleScope(-1);
			return;
		}
		if (matchesSelectUp(keyData)) {
			this.#move(-1);
			return;
		}
		if (matchesSelectDown(keyData)) {
			this.#move(1);
			return;
		}
		if (matchesKey(keyData, "pageUp")) {
			this.#move(-this.#pageSize());
			return;
		}
		if (matchesKey(keyData, "pageDown")) {
			this.#move(this.#pageSize());
			return;
		}
		if (matchesKey(keyData, "left")) {
			this.#collapseOrParent();
			return;
		}
		if (matchesKey(keyData, "right")) {
			this.#expandOrChild();
			return;
		}
		if (matchesKey(keyData, "ctrl+enter") || matchesKey(keyData, "ctrl+return")) {
			this.#requestDelete();
			return;
		}
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			this.#activate();
			return;
		}
		if (matchesKey(keyData, "delete")) {
			this.#requestDelete();
			return;
		}
		if (!this.#searchFocused && keyData === "/") {
			this.focusSearch();
			return;
		}
		if (!this.#searchFocused && keyData === "r") {
			void this.refresh();
			return;
		}
		if (matchesKey(keyData, "ctrl+f")) {
			this.toggleFullPaths();
			return;
		}
		if (!this.#searchFocused && (keyData === "p" || keyData === "P")) {
			void this.pinSelected(keyData === "P");
			return;
		}
		if (matchesAppInterrupt(keyData)) {
			this.#clearSearch();
			return;
		}
		if (this.#searchFocused) {
			const before = this.#search.getValue();
			this.#search.handleInput(keyData);
			if (this.#search.getValue() !== before) {
				this.invalidate();
				this.#rebuild();
			}
		}
	}

	render(width: number): readonly string[] {
		const lines: string[] = [];
		const view = this.#viewFor();
		const summary = this.#source.scopeSummary();
		this.#search.placeholder =
			this.#scope === "all"
				? tuiText("resumeSearchAll", "Search all conversations…")
				: tuiTextFmt(
						this.#scope === "workspace" ? "resumeSearchInWorkspace" : "resumeSearchInProject",
						"Search conversations in %s…",
						this.#scope === "workspace" ? summary.workspaceName : summary.projectName,
					);
		this.#hitRows = new Map();
		this.#menuHits = new Map();
		this.#menuItemHits = new Map();
		this.#renameButtonHits = new Map();
		this.#deleteButtonHits = new Map();
		const scopeHeader = renderScopeHeaderHits(this.#scope, summary, width);
		this.#scopeHits = scopeHeader.hits;
		this.#lineOffset = 0;
		lines.push(scopeHeader.text);
		if (this.#search.getValue().length === 0) {
			lines.push(truncateToWidth(`/ ${theme.fg("dim", this.#search.placeholder)}`, width));
		} else {
			lines.push(...this.#search.render(width));
		}
		const warningNames = this.#source.scanWarningNames?.() ?? [];
		const warning =
			warningNames.length > 0
				? tuiTextFmt(
						"resumeScanWarningFmt",
						"Some conversation folders could not be read: %s. Showing what was found.",
						warningNames.join(", "),
					)
				: undefined;
		const error = this.#source.loadError?.();
		if (this.#notice || error || warning) {
			const message = this.#notice ?? error ?? `${warning!} · ${tuiText("resumeRetryHint", "r retries")}`;
			lines.push(truncateToWidth(theme.fg(error ? "error" : "warning", `  ${message}`), width));
		}
		if (this.#rename) {
			const start = lines.length;
			lines.push(...this.#renderRenameBox(width, start));
		}
		if (this.#deleteTarget) {
			const start = lines.length;
			lines.push(...this.#renderDeleteBox(width, start));
		}
		lines.push("");
		const loading = !view || this.#source.isLoading?.();
		if (loading && !view) {
			lines.push(truncateToWidth(theme.fg("dim", `  ${tuiText("resumeLoading", "Loading conversations…")}`), width));
			const skeletonWidth = Math.max(4, Math.min(width - 4, 36));
			for (let index = 0; index < 3; index++) {
				lines.push(theme.fg("dim", `  ${"░".repeat(skeletonWidth)}`));
			}
			return lines;
		}
		if (!view) return lines;
		const searching = view.query.raw.trim().length > 0;
		if (searching && view.counts.totalConversations > view.counts.conversations) {
			const hidden = view.counts.totalConversations - view.counts.conversations;
			lines.push(
				truncateToWidth(
					theme.fg(
						"muted",
						`  ${tuiTextFmt("resumeHiddenByFilterFmt", "%d conversations hidden by filter", hidden)}`,
					),
					width,
				),
			);
		}
		const flat = flattenResumeRows(view.rows, this.#state, searching);
		if (flat.length === 0) {
			lines.push(...this.#emptyState(view, searching, width));
			return lines;
		}
		const selectedIndex = this.#selectedIndex(flat);
		const height = this.#listHeight();
		this.#clampScroll();
		const now = Date.now();
		const conversationRows = flat
			.map(entry => entry.row)
			.filter((row): row is ResumeTreeConversationRow => row.type === "conversation");
		const columns = conversationColumns(conversationRows, now);
		const bodyStart = lines.length;
		// Workspace scope shows one workspace, so absolute paths (and even the
		// path tail) add nothing there; the persisted choice still applies once
		// the user moves to project/all.
		const fullPaths = this.#scope !== "workspace" && this.#fullPaths;
		for (let index = this.#scrollOffset; index < flat.length; index++) {
			if (lines.length - bodyStart >= height && index !== selectedIndex) break;
			const row = flat[index]!.row;
			const selected = index === selectedIndex;
			const lineIndex = lines.length;
			if (row.type === "project") {
				this.#hitRows.set(lineIndex, { kind: "toggle", key: rowIdentity(row) });
				lines.push(
					renderProjectRow(row, {
						width,
						selected,
						collapsed: projectCollapsed(row, this.#state) && !searching,
						now,
						fullPaths,
					}),
				);
				const ruleIndex = lines.length;
				this.#hitRows.set(ruleIndex, { kind: "toggle", key: rowIdentity(row) });
				lines.push(renderProjectRule(width));
			} else if (row.type === "workspace") {
				this.#hitRows.set(lineIndex, { kind: "toggle", key: rowIdentity(row) });
				this.#menuHits.set(lineIndex, { kind: "workspace", key: rowIdentity(row), start: Math.max(0, width - 1) });
				lines.push(
					renderWorkspaceRow(row, {
						width,
						selected,
						collapsed: this.#state.collapsedWorkspaces.has(row.key) && !searching,
						referenceBranch: view.referenceBranch,
						current: view.currentWorkspaceKey === row.key,
						fullPaths,
						showPath: this.#scope !== "workspace",
					}),
				);
			} else {
				this.#hitRows.set(lineIndex, { kind: "conversation", key: rowIdentity(row) });
				this.#menuHits.set(lineIndex, {
					kind: "conversation",
					key: rowIdentity(row),
					start: Math.max(0, width - 1),
				});
				lines.push(renderConversationRow(row, { width, selected, now, columns, fullPaths }));
			}
		}
		if (this.#menu) {
			const menu = this.#menu;
			const kindLabel =
				menu.kind === "workspace"
					? tuiText("resumeMenuWorkspace", "workspace")
					: tuiText("resumeMenuConversation", "conversation");
			lines.push(truncateToWidth(`  ${theme.fg("accent", `┌ ${kindLabel}`)}`, width));
			menu.items.forEach((item, itemIndex) => {
				const itemLine = lines.length;
				this.#menuItemHits.set(itemLine, itemIndex);
				const cursor = itemIndex === menu.index ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
				const label = item.disabled ? theme.fg("dim", item.label) : item.label;
				const marker = itemIndex === menu.index ? theme.fg("accent", "›") : padding(1);
				lines.push(truncateToWidth(`  │ ${cursor}${marker} ${label}`, width));
			});
			lines.push(truncateToWidth(`  ${theme.fg("dim", "└ Esc")}`, width));
		}
		return lines;
	}

	/**
	 * A small modal box with clickable confirm/cancel buttons. `start` is the
	 * line index in the current frame; button ranges are recorded for mouse
	 * hit-testing. Every line is truncated, never wrapped.
	 */
	#renderModalBox(
		title: string,
		body: readonly string[],
		width: number,
		start: number,
		hits: Map<number, { confirm?: ResumeButtonHit; cancel?: ResumeButtonHit }>,
	): string[] {
		const lines = [truncateToWidth(`  ${theme.fg("accent", `┌ ${title}`)}`, width)];
		for (const line of body) lines.push(truncateToWidth(`  ${theme.fg("dim", "│")} ${line}`, width));
		const prefix = `  ${theme.fg("dim", "└")} `;
		const confirm = `[${tuiText("resumeConfirmButton", "Confirm")}]`;
		const cancel = `[${tuiText("resumeCancelButton", "Cancel")}]`;
		const confirmStart = visibleWidth(prefix);
		const confirmEnd = confirmStart + visibleWidth(confirm) - 1;
		const cancelStart = confirmEnd + 3;
		const cancelEnd = cancelStart + visibleWidth(cancel) - 1;
		hits.set(start + 1 + body.length, {
			confirm: { start: confirmStart, end: confirmEnd },
			cancel: { start: cancelStart, end: cancelEnd },
		});
		lines.push(truncateToWidth(`${prefix}${theme.fg("accent", confirm)}  ${theme.fg("muted", cancel)}`, width));
		return lines;
	}

	#renderRenameBox(width: number, start: number): string[] {
		const rename = this.#rename!;
		const title =
			rename.kind === "workspace"
				? tuiText("resumeRenameWorkspaceTitle", "Rename workspace")
				: tuiText("resumeRenameConversationTitle", "Rename conversation");
		return this.#renderModalBox(
			`✎ ${title}`,
			[`${rename.value}${theme.fg("accent", "▌")}`, tuiText("resumeRenameHint", "Enter saves · Esc cancels")],
			width,
			start,
			this.#renameButtonHits,
		);
	}

	#renderDeleteBox(width: number, start: number): string[] {
		const target = this.#deleteTarget!;
		const title = target.conversation.title || target.conversation.id;
		const permanent = this.#source.deleteMode === "permanent";
		const question = permanent
			? tuiTextFmt("resumeDeletePermanentFmt", "Permanently delete “%s”?", title)
			: tuiTextFmt("resumeDeleteTrashFmt", "Move “%s” to trash?", title);
		const hint = permanent
			? tuiText("resumeDeletePermanentHint", "This cannot be undone.")
			: tuiText("resumeDeleteTrashHint", "The conversation can be restored from the trash.");
		return this.#renderModalBox(
			tuiText("resumeDeleteTitle", "Delete conversation"),
			[question, theme.fg("dim", hint), theme.fg("dim", tuiText("resumeConfirmKeys", "y confirm · n cancel"))],
			width,
			start,
			this.#deleteButtonHits,
		);
	}

	#emptyState(view: ResumeTreeView, searching: boolean, width: number): string[] {
		const raw = view.query.raw.trim();
		if (searching) {
			return [
				truncateToWidth(
					theme.fg("muted", `  ${tuiTextFmt("resumeNoMatchFmt", "No conversations match “%s”", raw)}`),
					width,
				),
				truncateToWidth(theme.fg("dim", `  ${tuiText("resumeClearSearchHint", "Esc clears the search")}`), width),
			];
		}
		const empty =
			this.#scope === "workspace"
				? tuiText("resumeEmptyWorkspace", "No conversations in this workspace.")
				: this.#scope === "project"
					? tuiText("resumeEmptyProject", "No conversations in this repository.")
					: tuiText("resumeEmptyAll", "No conversations yet.");
		return [
			truncateToWidth(theme.fg("muted", `  ${empty}`), width),
			truncateToWidth(theme.fg("dim", `  ${tuiText("resumeSwitchScopeHint", "Tab switches scope")}`), width),
		];
	}

	dispose(): void {
		this.#deleteTarget = null;
	}
}
