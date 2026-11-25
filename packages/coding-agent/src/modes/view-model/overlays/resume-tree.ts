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
import { type TspTone } from "@linxiraos/pi-wire";
import { tuiText, tuiTextFmt } from "@linxiraos/pi-tui";
import { currentTheme } from "@linxiraos/pi-tui/theme/runtime";
import { visibleWidth } from "@linxiraos/pi-tui/text/width";
import { truncateToWidth } from "../../../utils/text-width";

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
	/** Hidden by shared metadata; only visible with Show hidden. */
	hidden?: boolean;
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
	/** Hidden folder; metadata only. */
	hidden?: boolean;
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
	hidden?: boolean;
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

/** Display caps for the initial recent-first tree; a "more" row lifts them. */
export const RECENT_PROJECT_LIMIT = 5;
export const RECENT_CONVERSATION_LIMIT = 5;
export const MORE_PROJECTS_KEY = "\u0000resume:more-projects";
export const MORE_CONVERSATIONS_KEY_PREFIX = "\u0000resume:more-conversations:";

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
	/** Hide/unhide shared metadata; never deletes the transcript. */
	hideConversation?(conversation: ResumeTreeConversation, hidden: boolean): Promise<void>;
	hideWorkspace?(workspace: ResumeTreeWorkspace, hidden: boolean): Promise<void>;
	/** True when hidden rows are currently revealed. */
	readonly showHidden?: boolean;
	setShowHidden?(showHidden: boolean): void;
	/** Rows hidden by shared metadata (conversations + folders + projects). */
	hiddenCount?(): number;
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

function statusWord(status: ResumeTreeStatus | undefined): { text: string; tone: TspTone } | undefined {
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

function conversationFlags(row: ResumeTreeConversationRow): { text: string; tone: TspTone }[] {
	const flags: { text: string; tone: TspTone }[] = [];
	if (row.current) flags.push({ text: tuiText(CURRENT_LABEL_KEY, "current"), tone: "accent" });
	if (row.conversation.fork) flags.push({ text: tuiText("ssForkLabel", "fork"), tone: "muted" });
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
			.join(` ${currentTheme().symbols.symbol("sep.dot")} `);
		widths.flags = Math.max(widths.flags, visibleWidth(flags));
	}
	return widths;
}

/** `⋯` at the right edge of a menu-bearing row. */
function menuAffordance(): string {
	return currentTheme().fg("muted", "⋯");
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
	const cursor = selected
		? currentTheme().fg("accent", `${currentTheme().symbols.symbol("nav.cursor")} `)
		: " ".repeat(2);
	const indent = " ".repeat(CONVERSATION_INDENT);
	if (row.key.startsWith(MORE_CONVERSATIONS_KEY_PREFIX)) {
		return truncateToWidth(`${cursor}${indent}${currentTheme().fg("muted", row.conversation.title)}`, options.width);
	}
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
				flags
					.map(flag => currentTheme().fg(flag.tone, flag.text))
					.join(` ${currentTheme().fg("dim", currentTheme().symbols.symbol("sep.dot"))} `),
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
	const joinParts = () =>
		parts.map(part => part.text).join(` ${currentTheme().fg("dim", currentTheme().symbols.symbol("sep.dot"))} `);
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
			detailText = `  ${currentTheme().fg("dim", truncateResumePath(detail, detailBudget))}`;
			titleWidth = leftBudget - visibleWidth(detailText);
		}
	}
	const title = truncateToWidth(row.conversation.title || row.conversation.id, Math.max(1, titleWidth));
	const statusText = status ? currentTheme().fg(status.tone, padStartVisible(status.text, columns.status)) : "";
	const left = `${statusText}${" ".repeat(Math.max(0, statusWidth - visibleWidth(statusText)))}${title}${detailText}`;
	const line = alignRow("", left, right, available);
	const rendered = selected ? currentTheme().style("strong", line) : line;
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
	const cursor = options.selected
		? currentTheme().fg("accent", `${currentTheme().symbols.symbol("nav.cursor")} `)
		: " ".repeat(2);
	const indent = " ".repeat(WORKSPACE_INDENT);
	const fold = options.collapsed ? "▸" : "▾";
	const name = row.workspace.displayName || row.workspace.alias || row.workspace.name || row.workspace.path;
	const branch = shouldShowBranch(row.workspace.branch, options.referenceBranch, options.current === true, name)
		? ` ${currentTheme().fg("warning", `[${row.workspace.branch}]`)}`
		: "";
	const nameStyled = currentTheme().style("strong", currentTheme().fg("accent", name));
	const right = `${currentTheme().fg("dim", conversationCountText(row))} ${menuAffordance()}`;
	const budget = leftBudgetFor(cursor, [right], options.width);
	const base = `${currentTheme().fg("muted", fold)} ${nameStyled}${branch}`;
	const path = options.showPath === false ? "" : formatResumePath(row.workspace.path, options.fullPaths === true);
	const pathBudget = budget.budget - visibleWidth(indent) - visibleWidth(base) - 2;
	const pathText =
		path && pathBudget >= 4 ? `  ${currentTheme().fg("dim", truncateResumePath(path, pathBudget))}` : "";
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
	const cursor = options.selected
		? currentTheme().fg("accent", `${currentTheme().symbols.symbol("nav.cursor")} `)
		: " ".repeat(2);
	if (row.key === MORE_PROJECTS_KEY) {
		return truncateToWidth(`${cursor}${currentTheme().fg("muted", row.project.displayName)}`, options.width);
	}
	const indent = " ".repeat(PROJECT_INDENT);
	const fold = options.collapsed ? "▸" : "▾";
	const pin = row.pinned ? `${currentTheme().symbols.icon("pin")} ` : "";
	const name = row.project.displayName || row.project.name;
	const workspaces =
		row.totalWorkspaceCount === 1
			? tuiText("resumeWorkspaceCountOne", "1 workspace")
			: tuiTextFmt("resumeWorkspaceCountFmt", "%d workspaces", row.totalWorkspaceCount);
	const count = currentTheme().fg("dim", conversationCountText(row));
	const activity = row.project.lastActivity
		? currentTheme().fg("dim", formatResumeAge(row.project.lastActivity, options.now))
		: "";
	const right = [count, currentTheme().fg("dim", workspaces), activity]
		.filter(Boolean)
		.join(` ${currentTheme().fg("dim", currentTheme().symbols.symbol("sep.dot"))} `);
	const compact = [count, currentTheme().fg("dim", workspaces)]
		.filter(Boolean)
		.join(` ${currentTheme().fg("dim", currentTheme().symbols.symbol("sep.dot"))} `);
	const budget = leftBudgetFor(cursor, [right, compact, count], options.width);
	const base = `${indent}${currentTheme().fg("muted", fold)} ${pin}${currentTheme().style("strong", currentTheme().fg("accent", name))}`;
	const path = formatResumePath(row.project.root, options.fullPaths === true);
	const pathBudget = budget.budget - visibleWidth(base) - 3; // ` (` + `)` + a space
	const pathTag =
		path && pathBudget >= 3 ? ` ${currentTheme().fg("dim", `(${truncateResumePath(path, pathBudget)})`)}` : "";
	return alignRow(cursor, base + pathTag, budget.right, options.width);
}

/** Full-width rule closing a project section header. */
export function renderProjectRule(width: number): string {
	return truncateToWidth(
		currentTheme().fg("dim", currentTheme().symbols.box.horizontal.repeat(Math.max(0, width))),
		width,
	);
}

/**
 * Full-width rule between two project sections. The header rule above binds a
 * project to its workspaces; this boundary rule uses a brighter theme color so
 * the eye can find where one project ends and the next begins.
 */
export function renderProjectSeparator(width: number): string {
	return truncateToWidth(
		currentTheme().fg("muted", currentTheme().symbols.box.horizontal.repeat(Math.max(0, width))),
		width,
	);
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
			text: selected
				? currentTheme().style("strong", currentTheme().fg("accent", plain))
				: currentTheme().fg("muted", plain),
			priority: selected ? 1_000 : 100,
			kind,
			plain,
		});
		parts.push({ text: currentTheme().fg("dim", `${count}`), priority: selected ? 200 : 40 });
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
	/** The user asked to see projects beyond the recent-five window. */
	showAllProjects?: boolean;
	/** Workspaces whose conversation list was expanded past the recent-five window. */
	expandedConversationGroups?: Set<string>;
}

type ResumeTreeMenuKind = "workspace" | "conversation";
type ResumeTreeMenuAction = "rename" | "toggle" | "open" | "pin" | "hide" | "delete";

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

	// Search must expose every matching conversation. The recent-first caps below
	// are only for browsing, never for a query's result set.
	if (searching) return flat;

	const totalByWorkspace = new Map<string, number>();
	for (const entry of flat) {
		if (entry.row.type !== "conversation") continue;
		totalByWorkspace.set(entry.row.workspaceKey, (totalByWorkspace.get(entry.row.workspaceKey) ?? 0) + 1);
	}

	const visible: FlatRow[] = [];
	let projectIndex = 0;
	let hiddenProjects = 0;
	let hiddenProject: ResumeTreeProjectRow | undefined;
	let skipProject = false;
	let currentWorkspace: string | undefined;
	const shownByWorkspace = new Map<string, number>();
	for (const entry of flat) {
		const row = entry.row;
		if (row.type === "project") {
			projectIndex++;
			if (!state.showAllProjects && projectIndex > RECENT_PROJECT_LIMIT) {
				hiddenProjects++;
				hiddenProject ??= row;
				skipProject = true;
				currentWorkspace = undefined;
				continue;
			}
			skipProject = false;
			visible.push(entry);
			currentWorkspace = undefined;
			continue;
		}
		if (skipProject) continue;
		if (row.type === "workspace") {
			visible.push(entry);
			currentWorkspace = row.key;
			continue;
		}
		if (!currentWorkspace) {
			visible.push(entry);
			continue;
		}
		const shown = shownByWorkspace.get(currentWorkspace) ?? 0;
		const total = totalByWorkspace.get(currentWorkspace) ?? 0;
		const expanded = state.expandedConversationGroups?.has(currentWorkspace) === true;
		if (!expanded && shown >= RECENT_CONVERSATION_LIMIT) continue;
		shownByWorkspace.set(currentWorkspace, shown + 1);
		visible.push(entry);
		if (!expanded && total > RECENT_CONVERSATION_LIMIT && shown + 1 === RECENT_CONVERSATION_LIMIT) {
			visible.push({ row: moreConversationsRow(row, total - RECENT_CONVERSATION_LIMIT) });
		}
	}

	if (hiddenProjects > 0 && hiddenProject) {
		visible.push({ row: moreProjectsRow(hiddenProject, hiddenProjects) });
	}
	return visible;
}

function moreProjectsRow(template: ResumeTreeProjectRow, count: number): ResumeTreeProjectRow {
	const label = tuiTextFmt("resumeMoreProjectsFmt", "+ %d more projects", count);
	return {
		...template,
		key: MORE_PROJECTS_KEY,
		project: {
			...template.project,
			name: label,
			displayName: label,
			alias: null,
			pinned: false,
			collapsed: false,
			lastActivity: null,
		},
		pinned: false,
		collapsed: false,
		conversationCount: 0,
		totalConversationCount: 0,
		workspaceCount: 0,
		totalWorkspaceCount: 0,
	};
}

function moreConversationsRow(template: ResumeTreeConversationRow, count: number): ResumeTreeConversationRow {
	const label = tuiTextFmt("resumeMoreConversationsFmt", "+ %d more conversations", count);
	const key = `${MORE_CONVERSATIONS_KEY_PREFIX}${template.workspaceKey}`;
	return {
		...template,
		key,
		conversation: {
			...template.conversation,
			key,
			id: key,
			path: key,
			title: label,
			messageCount: 0,
			current: false,
			fork: false,
			isSubagent: false,
		},
		pinned: false,
		current: false,
	};
}

/** Rename in progress: the row and its uncommitted value. */
export interface ResumeTreeRenameState {
	readonly key: string;
	readonly kind: "workspace" | "conversation";
	readonly value: string;
}

/** Search observer of the resume tree: the query plus its focus. */
export interface ResumeTreeSearchState {
	readonly query: string;
	readonly focused: boolean;
}

/**
 * The resume tree's state: scope, path format, collapse sets, search, view
 * caching, selection and the pin/rename/hide/delete actions.
 *
 * Row rendering lives in the host UI; `flattenResumeRows` and the row
 * formatters above stay here because they are shared by every host.
 */
export class ResumeTreeModel {
	readonly #options: ResumeTreeOptions;
	readonly #source: ResumeTreeSource;
	#state: ResumeTreeState = {
		collapsedProjects: new Set(),
		expandedProjects: new Set(),
		collapsedWorkspaces: new Set(),
		showAllProjects: false,
		expandedConversationGroups: new Set(),
	};
	#scope: ResumeTreeScope;
	#fullPaths = false;
	#query = "";
	#searchFocused: boolean;
	#view: ResumeTreeView | null = null;
	#viewQuery = "\0";
	#viewScope: ResumeTreeScope | null = null;
	#selectedKey: string | undefined;
	#busy = false;
	#notice: string | undefined;
	#expandedOnce = false;
	#deleteTarget: ResumeTreeConversationRow | null = null;
	#rename: ResumeTreeRenameState | undefined;
	#disposed = false;

	constructor(options: ResumeTreeOptions) {
		this.#options = options;
		this.#source = options.source;
		this.#scope = options.source.initialScope;
		this.#searchFocused = options.searchFocused ?? true;
		const restored = options.source.pickerState?.();
		if (restored) {
			this.#scope = restored.scope;
			this.#fullPaths = restored.fullPaths === true;
			for (const key of restored.collapsedProjects ?? []) this.#state.collapsedProjects.add(key);
			for (const key of restored.expandedProjects ?? []) this.#state.expandedProjects.add(key);
			for (const key of restored.collapsedWorkspaces ?? []) this.#state.collapsedWorkspaces.add(key);
		}
	}

	get scope(): ResumeTreeScope {
		return this.#scope;
	}
	get fullPaths(): boolean {
		return this.#fullPaths;
	}
	get search(): ResumeTreeSearchState {
		return { query: this.#query, focused: this.#searchFocused };
	}
	get view(): ResumeTreeView | null {
		return this.#viewFor();
	}
	get visibleRows(): readonly FlatRow[] {
		return this.#visibleRows();
	}
	get selectedKey(): string | undefined {
		return this.#selectedKey;
	}
	get selectedRow(): ResumeTreeRow | undefined {
		return this.#visibleRows().find(entry => rowIdentity(entry.row) === this.#selectedKey)?.row;
	}
	get notice(): string | undefined {
		return this.#notice;
	}
	get busy(): boolean {
		return this.#busy;
	}
	get deleteTarget(): ResumeTreeConversationRow | null {
		return this.#deleteTarget;
	}
	get rename(): ResumeTreeRenameState | undefined {
		return this.#rename;
	}
	get showHidden(): boolean {
		return this.#source.showHidden === true;
	}
	get hiddenCount(): number {
		return this.#source.hiddenCount?.() ?? 0;
	}
	get deleteMode(): ResumeTreeDeleteMode {
		return this.#source.deleteMode;
	}
	get scanWarningNames(): readonly string[] {
		return this.#source.scanWarningNames?.() ?? [];
	}
	get loadError(): string | undefined {
		return this.#source.loadError?.();
	}
	get loading(): boolean {
		return this.#source.isLoading?.() ?? false;
	}
	get scopeSummary(): ResumeTreeScopeSummary {
		return this.#source.scopeSummary();
	}

	dispose(): void {
		this.#disposed = true;
	}

	/** Rebuild the cached view (call after the host refreshes its directory). */
	invalidate(): void {
		this.#view = null;
		this.#viewQuery = "\0";
	}

	/** Adopt a host-refreshed view while keeping selection and collapse state. */
	setView(view: ResumeTreeView | null): void {
		this.#view = view;
		this.#viewScope = this.#scope;
		this.#viewQuery = this.#query;
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
		this.#requestRender();
	}

	/** Toggle absolute paths; workspace scope only explains why it is redundant. */
	toggleFullPaths(): void {
		if (this.#scope === "workspace") {
			this.#notice = tuiText(
				"resumeFullPathsWorkspaceHint",
				"Full paths matter outside this workspace — press f after Tab",
			);
			this.#requestRender();
			return;
		}
		this.#fullPaths = !this.#fullPaths;
		this.#notice = undefined;
		this.#persistState();
		this.#requestRender();
	}

	/** Re-read the directory through the host source. */
	async refresh(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		this.#notice = undefined;
		this.#requestRender();
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
			this.#requestRender();
		}
	}

	/** Focus the search field. */
	focusSearch(): void {
		this.#searchFocused = true;
		this.#requestRender();
	}

	/** Replace the query; the view is rebuilt on the next read. */
	setQuery(query: string): void {
		this.#query = query;
		this.#searchFocused = query.length > 0;
		this.#rebuild();
		this.#requestRender();
	}

	/** Escape: clear the query, else close the picker. */
	cancel(): void {
		if (this.#query.length === 0) {
			this.#options.onCancel();
			return;
		}
		this.#query = "";
		this.#searchFocused = false;
		this.invalidate();
		this.#rebuild();
		this.#requestRender();
	}

	/** Leave the picker for the caller's exit path. */
	exit(): void {
		this.#options.onExit();
	}

	/** Move the selection by `delta` visible rows. */
	move(delta: number): void {
		this.#searchFocused = false;
		const flat = this.#visibleRows();
		if (flat.length === 0) return;
		const index = this.#selectedIndex(flat);
		this.#selectedKey = rowIdentity(flat[Math.max(0, Math.min(flat.length - 1, index + delta))]!.row);
		this.#requestRender();
	}

	/** Page the selection by `size` rows. */
	page(direction: 1 | -1, size: number): void {
		this.move(direction * Math.max(2, Math.floor(size / 2)));
	}

	/** Select the row `delta` visible rows away without changing pane focus. */
	selectIndex(index: number): void {
		const flat = this.#visibleRows();
		const entry = flat[Math.max(0, Math.min(flat.length - 1, index))];
		if (entry) this.#selectedKey = rowIdentity(entry.row);
		this.#requestRender();
	}

	/** Enter: resume the selected conversation; a header folds instead. */
	activate(): void {
		const row = this.selectedRow;
		if (!row) return;
		if (row.type === "conversation") {
			if (row.key.startsWith(MORE_CONVERSATIONS_KEY_PREFIX)) {
				this.#state.expandedConversationGroups?.add(row.workspaceKey);
				this.#rebuild();
				this.#requestRender();
				return;
			}
			this.#options.onSelect(row.conversation);
			return;
		}
		this.toggleSelectedCollapse();
	}

	/** Space/right/left: fold or unfold the selected project or workspace. */
	toggleSelectedCollapse(): void {
		const row = this.selectedRow;
		if (!row) return;
		if (row.type === "conversation") {
			if (row.key.startsWith(MORE_CONVERSATIONS_KEY_PREFIX)) {
				this.#state.expandedConversationGroups?.add(row.workspaceKey);
				this.#rebuild();
			}
			this.#requestRender();
			return;
		}
		if (row.type === "project") {
			if (row.key === MORE_PROJECTS_KEY) {
				this.#state.showAllProjects = true;
				this.#rebuild();
				this.#requestRender();
				return;
			}
			if (projectCollapsed(row, this.#state)) {
				this.#state.collapsedProjects.delete(row.key);
				this.#state.expandedProjects.add(row.key);
			} else {
				this.#state.expandedProjects.delete(row.key);
				this.#state.collapsedProjects.add(row.key);
			}
		} else {
			if (this.#state.collapsedWorkspaces.has(row.key)) this.#state.collapsedWorkspaces.delete(row.key);
			else this.#state.collapsedWorkspaces.add(row.key);
		}
		this.#rebuild();
		this.#requestRender();
	}

	/** Left: collapse the selection, or jump to its parent group. */
	collapseOrParent(): void {
		const row = this.selectedRow;
		if (!row) return;
		if (row.type === "project" && !projectCollapsed(row, this.#state)) {
			this.toggleSelectedCollapse();
			return;
		}
		if (row.type === "workspace" && !this.#state.collapsedWorkspaces.has(row.key)) {
			this.toggleSelectedCollapse();
			return;
		}
		const parentKey =
			row.type === "conversation" ? row.workspaceKey : row.type === "workspace" ? row.projectKey : undefined;
		if (!parentKey) return;
		const flat = this.#visibleRows();
		const parent = flat.find(entry => entry.row.key === parentKey && entry.row.type !== "conversation");
		if (parent) this.#selectedKey = rowIdentity(parent.row);
		this.#requestRender();
	}

	/** Right: unfold the selection, or step into its first child. */
	expandOrChild(): void {
		const row = this.selectedRow;
		if (!row) return;
		if (row.type === "project" && projectCollapsed(row, this.#state)) {
			this.toggleSelectedCollapse();
			return;
		}
		if (row.type === "workspace" && this.#state.collapsedWorkspaces.has(row.key)) {
			this.toggleSelectedCollapse();
			return;
		}
		const flat = this.#visibleRows();
		const index = this.#selectedIndex(flat);
		const child = flat[index + 1];
		if (child && (child.parentKey === row.key || child.row.type === "workspace")) {
			this.#selectedKey = rowIdentity(child.row);
			this.#requestRender();
		}
	}

	/** `a`: pin or unpin the selected row (workspace or conversation). */
	async pinSelected(): Promise<void> {
		const row = this.selectedRow;
		if (!row) return;
		try {
			if (row.type === "conversation") {
				await this.#source.pinConversation?.(row.conversation, !row.pinned);
			} else if (row.type === "workspace") {
				await this.#source.pinWorkspace?.(row.workspace, !row.pinned);
			} else if (row.type === "project") {
				await this.#source.pinProject?.(row.project, !row.pinned);
			}
			await this.refresh();
		} catch (error) {
			this.#notice = error instanceof Error ? error.message : String(error);
			this.#requestRender();
		}
	}

	/** Hide/unhide the selected row via shared metadata. */
	async hideSelected(): Promise<void> {
		const row = this.selectedRow;
		if (!row) return;
		try {
			if (row.type === "conversation") await this.#source.hideConversation?.(row.conversation, true);
			else if (row.type === "workspace") await this.#source.hideWorkspace?.(row.workspace, true);
			await this.refresh();
		} catch (error) {
			this.#notice = error instanceof Error ? error.message : String(error);
			this.#requestRender();
		}
	}

	/** Toggle shared-hidden rows. */
	toggleShowHidden(): void {
		this.#source.setShowHidden?.(!this.showHidden);
		this.invalidate();
		this.#rebuild();
		this.#requestRender();
	}

	/** Start renaming the selected workspace or conversation. */
	beginRename(value: string): boolean {
		const row = this.selectedRow;
		if (!row || row.type === "project") return false;
		if (row.type === "conversation" && this.#source.canRenameConversation?.(row.conversation) === false) return false;
		this.#rename = {
			key: row.key,
			kind: row.type,
			value,
		};
		this.#requestRender();
		return true;
	}

	/** Update the rename draft. */
	setRenameValue(value: string): void {
		if (this.#rename) this.#rename = { ...this.#rename, value };
	}

	cancelRename(): void {
		this.#rename = undefined;
		this.#requestRender();
	}

	/** Commit the rename through the source; closes on success. */
	async commitRename(): Promise<boolean> {
		const rename = this.#rename;
		const row = this.selectedRow;
		if (!rename || !row) return false;
		try {
			if (rename.kind === "conversation" && row.type === "conversation") {
				await this.#source.renameConversation?.(row.conversation, rename.value);
			} else if (rename.kind === "workspace" && row.type === "workspace") {
				await this.#source.renameWorkspace?.(row.workspace, rename.value || null);
			}
			this.#rename = undefined;
			await this.refresh();
			return true;
		} catch (error) {
			this.#notice = error instanceof Error ? error.message : String(error);
			this.#requestRender();
			return false;
		}
	}

	/** Ask for delete confirmation of the selected conversation. */
	requestDelete(): boolean {
		const row = this.selectedRow;
		if (!row || row.type !== "conversation") return false;
		this.#deleteTarget = row;
		this.#requestRender();
		return true;
	}

	cancelDelete(): void {
		this.#deleteTarget = null;
		this.#requestRender();
	}

	/** Delete the pending conversation (`trash` or `permanent` per the source). */
	async confirmDelete(): Promise<boolean> {
		const target = this.#deleteTarget;
		if (!target) return false;
		try {
			const deleted = await this.#source.deleteConversation?.(target.conversation);
			this.#deleteTarget = null;
			if (deleted !== false) await this.refresh();
			return deleted !== false;
		} catch (error) {
			this.#notice = error instanceof Error ? error.message : String(error);
			this.#deleteTarget = null;
			this.#requestRender();
			return false;
		}
	}

	#visibleRows(): FlatRow[] {
		const view = this.#viewFor();
		if (!view) return [];
		const searching = view.query.raw.trim().length > 0;
		return flattenResumeRows(view.rows, this.#state, searching);
	}

	#viewFor(): ResumeTreeView | null {
		if (this.#view && this.#viewScope === this.#scope && this.#viewQuery === this.#query) return this.#view;
		this.#view = this.#source.buildView({
			scope: this.#scope,
			query: this.#query,
			currentSessionPath: this.#source.currentSessionPath?.(),
		});
		this.#viewScope = this.#scope;
		this.#viewQuery = this.#query;
		if (!this.#expandedOnce) {
			// Seed local collapse state from the model so the first paint agrees
			// with the persisted project flags.
			for (const row of this.#view?.rows ?? []) {
				if (row.type === "project" && row.collapsed) this.#state.collapsedProjects.add(row.key);
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
			// Open on something actionable: headers only fold, so a picker that
			// starts on a project header makes Enter and Delete look dead.
			const firstConversation = flat.find(entry => entry.row.type === "conversation") ?? flat[0]!;
			this.#selectedKey = rowIdentity(firstConversation.row);
		}
	}

	#selectedIndex(flat: readonly FlatRow[]): number {
		if (this.#selectedKey === undefined) return 0;
		const index = flat.findIndex(entry => rowIdentity(entry.row) === this.#selectedKey);
		return index < 0 ? 0 : index;
	}

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

	#requestRender(): void {
		if (!this.#disposed) this.#options.onRequestRender?.();
	}
}
