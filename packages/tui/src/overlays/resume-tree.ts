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
export type ResumeTreeSubagentsMode = "grouped" | "inline" | "hidden";

/** Persisted picker state (v2 file): scope plus local expansion. */
export interface ResumeTreePickerState {
	scope: ResumeTreeScope;
	collapsedProjects?: readonly string[];
	expandedProjects?: readonly string[];
	collapsedWorkspaces?: readonly string[];
	expandedSubagents?: readonly string[];
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
	/** 2 for a top-level conversation; deeper for grouped subagents. */
	depth?: number;
	pinned: boolean;
	current: boolean;
	pinnedOnly?: boolean;
	/** Grouped subagent rows nested under this conversation. */
	subagents?: readonly ResumeTreeConversationRow[];
}

/** The collapsed/expanded summary row placed under a parent conversation. */
export interface ResumeTreeSubagentsRow {
	type: "subagents";
	key: string;
	parentKey: string;
	projectKey: string;
	depth: number;
	count: number;
	expanded: boolean;
}

/** Rows the model produces (the summary row is synthesized by the tree). */
export type ResumeTreeModelRow = ResumeTreeProjectRow | ResumeTreeWorkspaceRow | ResumeTreeConversationRow;

export type ResumeTreeRow = ResumeTreeModelRow | ResumeTreeSubagentsRow;

export interface ResumeTreeView {
	scope: { kind: ResumeTreeScope; projectKey?: string; workspaceKey?: string };
	query: { raw: string; terms?: readonly string[] };
	rows: readonly ResumeTreeModelRow[];
	conversations?: readonly ResumeTreeConversationRow[];
	counts: {
		conversations: number;
		workspaces?: number;
		projects?: number;
		totalConversations: number;
		totalWorkspaces?: number;
		totalProjects?: number;
		hiddenSubagents?: number;
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
	/** `resume.subagents`; grouped when absent. */
	subagentsMode?(): ResumeTreeSubagentsMode;
	/** Re-read the directory; resolves once `buildView` reflects the new state. */
	refresh?(): Promise<void>;
	/** Partial scan failures (unreadable project folders) while rows are still listed. */
	scanWarningNames?(): readonly string[];
	/** A failed load: no rows available at all. */
	loadError?(): string | undefined;
	isLoading?(): boolean;
	pinConversation?(conversation: ResumeTreeConversation, pinned: boolean): Promise<void>;
	pinProject?(project: ResumeTreeProject, pinned: boolean): Promise<void>;
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

/** Basename-first path tail (`…/parent/name`) for workspace rows. */
export function resumePathTail(value: string): string {
	const normalized = value.replace(/[\\/]+$/, "");
	const name = path.basename(normalized);
	const parent = path.basename(path.dirname(normalized));
	if (!parent || parent === name) return name || value;
	return `${parent}/${name}`;
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
function alignRowVariants(cursor: string, left: string, variants: readonly string[], width: number): string {
	const available = Math.max(1, width - visibleWidth(cursor));
	for (const right of variants) {
		if (right && available - visibleWidth(right) - 2 >= 8) return alignRow(cursor, left, right, width);
	}
	return alignRow(cursor, left, "", width);
}

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
	if (row.conversation.isSubagent && row.conversation.agentName) {
		flags.push({ text: row.conversation.agentName, tone: "muted" });
	}
	if (row.pinned) flags.push({ text: tuiText(PINNED_LABEL_KEY, "pinned"), tone: "accent" });
	return flags;
}

/** Column widths across every visible conversation row, so columns stay put while scrolling. */
export function conversationColumns(rows: readonly ResumeTreeConversationRow[], now?: number): ConversationColumns {
	const widths: ConversationColumns = { status: 0, turns: 0, age: 0, flags: 0 };
	for (const row of rows) {
		const status = statusWord(row.conversation.status)?.text ?? "";
		widths.status = Math.max(widths.status, visibleWidth(status));
		widths.turns = Math.max(widths.turns, visibleWidth(conversationTurns(row)));
		widths.age = Math.max(widths.age, visibleWidth(conversationAge(row, now)));
		const flags = conversationFlags(row)
			.map(flag => flag.text)
			.join(` ${theme.sep.dot} `);
		widths.flags = Math.max(widths.flags, visibleWidth(flags));
	}
	return widths;
}

/**
 * One dense conversation row, `status · title · turns · age · flags`, with the
 * metadata right-aligned in stable columns. Narrow widths drop flags, then
 * age, then turns; status and the title always survive.
 */
export function renderConversationRow(
	row: ResumeTreeConversationRow,
	options: {
		width: number;
		selected: boolean;
		now?: number;
		columns?: ConversationColumns;
	},
): string {
	const selected = options.selected;
	const cursor = selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const depth = row.depth ?? 2;
	const indent = padding(Math.max(0, depth * 2));
	const columns = options.columns ?? conversationColumns([row], options.now);
	const status = statusWord(row.conversation.status);
	const flags = conversationFlags(row);
	const parts: { id: "turns" | "age" | "flags"; text: string; width: number }[] = [
		{ id: "turns", text: padStartVisible(conversationTurns(row), columns.turns), width: columns.turns },
		{ id: "age", text: padStartVisible(conversationAge(row, options.now), columns.age), width: columns.age },
	];
	if (flags.length > 0) {
		parts.push({
			id: "flags",
			text: padStartVisible(
				flags.map(flag => theme.fg(flag.tone, flag.text)).join(` ${theme.fg("dim", theme.sep.dot)} `),
				columns.flags,
			),
			width: columns.flags,
		});
	}
	const available = Math.max(1, options.width - visibleWidth(cursor) - visibleWidth(indent));
	const gap = 2;
	// Keep the status column (when the row has one) plus a readable title.
	// Flags go first, then turns, then age; the title always survives.
	const dropOrder: ("flags" | "turns" | "age")[] = ["flags", "turns", "age"];
	while (
		parts.length > 0 &&
		visibleWidth(parts.map(part => part.text).join(` ${theme.fg("dim", theme.sep.dot)} `)) + gap + 10 >
			available - columns.status
	) {
		const id = dropOrder.shift();
		if (!id) break;
		const index = parts.findIndex(part => part.id === id);
		if (index >= 0) parts.splice(index, 1);
	}
	const right = parts.map(part => part.text).join(` ${theme.fg("dim", theme.sep.dot)} `);
	const statusText = status ? theme.fg(status.tone, padStartVisible(status.text, columns.status)) : "";
	const statusWidth = status ? columns.status + (columns.status > 0 ? 1 : 0) : 0;
	const titleWidth = Math.max(1, available - statusWidth - visibleWidth(right) - (right ? gap : 0));
	const title = truncateToWidth(row.conversation.title || row.conversation.id, titleWidth);
	const left = `${statusText}${statusText ? " " : ""}${title}`;
	const line = alignRow("", left, right, available);
	const rendered = selected ? theme.bold(line) : line;
	return `${cursor}${indent}${rendered}`;
}

/** The `↳ subagents ×N` summary row (collapsed unless the user expanded it). */
export function renderSubagentsRow(row: ResumeTreeSubagentsRow, options: { width: number; selected: boolean }): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(Math.max(0, row.depth * 2));
	const fold = row.expanded ? "▾" : "▸";
	const label = tuiTextFmt("resumeSubagentsFmt", "subagents ×%d", row.count);
	const text = `${theme.fg("dim", "↳")} ${theme.fg("muted", fold)} ${theme.fg(options.selected ? "accent" : "muted", label)}`;
	const available = Math.max(1, options.width - visibleWidth(cursor) - visibleWidth(indent));
	return `${cursor}${indent}${truncateToWidth(text, available)}`;
}

/** One rendered workspace row: name (branch only when it adds information), count. */
export function renderWorkspaceRow(
	row: ResumeTreeWorkspaceRow,
	options: {
		width: number;
		selected: boolean;
		collapsed: boolean;
		referenceBranch?: string | null;
		current?: boolean;
	},
): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(2);
	const fold = options.collapsed ? "▸" : "▾";
	const name = row.workspace.name || row.workspace.path;
	const branch = shouldShowBranch(row.workspace.branch, options.referenceBranch, options.current === true, name)
		? theme.fg("dim", ` ${theme.sep.dot} ${row.workspace.branch}`)
		: "";
	const left = `${fold} ${options.selected ? theme.fg("accent", name) : name}${branch}`;
	const count = theme.fg("dim", conversationCountText(row));
	const right = row.workspace.path
		? `${theme.fg("dim", resumePathTail(row.workspace.path))} ${theme.fg("dim", theme.sep.dot)} ${count}`
		: count;
	return alignRowVariants(cursor, indent + left, [right, count], options.width);
}

/** One rendered project header: pin marker, name, counts, last activity. */
export function renderProjectRow(
	row: ResumeTreeProjectRow,
	options: { width: number; selected: boolean; collapsed: boolean; now?: number },
): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const fold = options.collapsed ? "▸" : "▾";
	const pin = row.pinned ? `${theme.icon.pin} ` : "";
	const name = row.project.displayName || row.project.name;
	const left = `${fold} ${pin}${options.selected ? theme.fg("accent", name) : name}`;
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
	return alignRowVariants(cursor, left, [right, compact, count], options.width);
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
	/** Parents whose grouped subagent summary is expanded. */
	expandedSubagents?: Set<string>;
}

/** The summary row for a conversation's grouped subagents. */
export function subagentsRowKey(parentKey: string): string {
	return `subagents:${parentKey}`;
}

/** Flatten model rows under the current local collapse state (headers always stay). */
export function flattenResumeRows(
	rows: readonly ResumeTreeRow[],
	state: ResumeTreeState,
	searching: boolean,
	mode: ResumeTreeSubagentsMode = "grouped",
): FlatRow[] {
	const flat: FlatRow[] = [];
	const pushConversation = (row: ResumeTreeConversationRow, parentKey: string) => {
		flat.push({ row, parentKey });
		const children = row.subagents ?? [];
		if (mode !== "grouped" || children.length === 0) return;
		const expanded = searching || (state.expandedSubagents?.has(row.key) ?? false);
		flat.push({
			row: {
				type: "subagents",
				key: subagentsRowKey(row.key),
				parentKey: row.key,
				projectKey: row.projectKey,
				depth: (row.depth ?? 2) + 1,
				count: children.length,
				expanded,
			},
			parentKey: row.key,
		});
		if (!expanded) return;
		for (const child of children) pushConversation(child, row.key);
	};
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
		if (row.type === "subagents") {
			flat.push({ row, parentKey: row.parentKey });
			continue;
		}
		pushConversation(row, row.workspaceKey);
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
		expandedSubagents: new Set(),
	};
	#scope: ResumeTreeScope;
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
	/** Row hit map captured from the last render (`row → action`). */
	#hitRows = new Map<number, { kind: "conversation" | "toggle"; key: string }>();
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
			for (const key of restored.collapsedProjects ?? []) this.#state.collapsedProjects.add(key);
			for (const key of restored.expandedProjects ?? []) this.#state.expandedProjects.add(key);
			for (const key of restored.collapsedWorkspaces ?? []) this.#state.collapsedWorkspaces.add(key);
			for (const key of restored.expandedSubagents ?? []) this.#state.expandedSubagents!.add(key);
		}
		this.#search = new Input();
		this.#search.prompt = "/ ";
		this.#search.onSubmit = () => this.#activate();
		this.#search.onEscape = () => this.#clearSearch();
	}

	/** `resume.subagents`, read through the host source. */
	#subagentsMode(): ResumeTreeSubagentsMode {
		return this.#source.subagentsMode?.() ?? "grouped";
	}

	/** Persist scope + local expansion together (the host owns the file). */
	#persistState(): void {
		const state: ResumeTreePickerState = {
			scope: this.#scope,
			collapsedProjects: [...this.#state.collapsedProjects],
			expandedProjects: [...this.#state.expandedProjects],
			collapsedWorkspaces: [...this.#state.collapsedWorkspaces],
			expandedSubagents: [...(this.#state.expandedSubagents ?? [])],
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
		return flattenResumeRows(view.rows, this.#state, searching, this.#subagentsMode());
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

	#clampScroll(): void {
		const flat = this.#visibleRows();
		const height = this.#listHeight();
		const index = this.#selectedIndex(flat);
		if (index < this.#scrollOffset) this.#scrollOffset = index;
		else if (index >= this.#scrollOffset + height) this.#scrollOffset = index - height + 1;
		const max = Math.max(0, flat.length - height);
		if (this.#scrollOffset > max) this.#scrollOffset = max;
	}

	#selectRow(row: ResumeTreeRow): void {
		if (row.type === "conversation") {
			this.onSelect(row.conversation);
			return;
		}
		this.#toggleCollapse(row);
	}

	#toggleCollapse(row: ResumeTreeProjectRow | ResumeTreeWorkspaceRow | ResumeTreeSubagentsRow): void {
		if (row.type === "project") {
			const expanded = !projectCollapsed(row, this.#state);
			this.#state.collapsedProjects.delete(row.key);
			this.#state.expandedProjects.delete(row.key);
			if (expanded) this.#state.collapsedProjects.add(row.key);
			else this.#state.expandedProjects.add(row.key);
		} else if (row.type === "workspace") {
			if (this.#state.collapsedWorkspaces.has(row.key)) this.#state.collapsedWorkspaces.delete(row.key);
			else this.#state.collapsedWorkspaces.add(row.key);
		} else {
			this.#toggleSubagents(row.parentKey);
		}
		this.#persistState();
		this.#clampScroll();
		this.onRequestRender?.();
	}

	#toggleSubagents(parentKey: string): void {
		const expanded = this.#state.expandedSubagents!;
		if (expanded.has(parentKey)) expanded.delete(parentKey);
		else expanded.add(parentKey);
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
		if (row.type === "subagents") {
			if (row.expanded) this.#toggleSubagents(row.parentKey);
			else this.#selectedKey = `conversation:${row.parentKey}`;
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
		if (row.type === "subagents") {
			if (!row.expanded) {
				this.#toggleSubagents(row.parentKey);
				return;
			}
			const child = flat[index + 1];
			if (child?.row.type === "conversation") this.#selectedKey = rowIdentity(child.row);
			return;
		}
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

	#activate(): void {
		if (this.#deleteTarget) {
			void this.#confirmDelete();
			return;
		}
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
		if (event.wheel !== null) {
			this.#move(event.wheel * 3);
			this.onRequestRender?.();
			return true;
		}
		if (!event.leftClick) return true;
		const line = event.row - (offset.row ?? this.#lineOffset);
		const column = event.col - (offset.col ?? this.#columnOffset);
		if (line === 0) {
			const segment = this.#scopeHits.find(hit => column >= hit.start && column <= hit.end);
			if (segment) this.setScope(segment.kind);
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
			if (row.type === "project" || row.type === "workspace" || row.type === "subagents") {
				this.#toggleCollapse(row);
			}
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
		if (this.#deleteTarget) {
			if (matchesAppInterrupt(keyData) || keyData === "n") {
				this.#deleteTarget = null;
				this.onRequestRender?.();
			} else if (keyData === "y" || matchesKey(keyData, "enter") || keyData === "\n") {
				void this.#confirmDelete();
			}
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
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			this.#activate();
			return;
		}
		if (matchesKey(keyData, "delete") || (matchesKey(keyData, "backspace") && this.#search.getValue() === "")) {
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
		if (this.#deleteTarget) {
			const target = this.#deleteTarget;
			const title = target.conversation.title || target.conversation.id;
			const text =
				this.#source.deleteMode === "permanent"
					? tuiTextFmt("resumeDeletePermanentFmt", "Permanently delete “%s”?", title)
					: tuiTextFmt("resumeDeleteTrashFmt", "Move “%s” to trash?", title);
			lines.push(truncateToWidth(theme.fg("warning", `  ${text}`), width));
			lines.push(
				truncateToWidth(
					theme.fg(
						"dim",
						`  ${this.#source.deleteMode === "permanent" ? tuiText("resumeDeletePermanentHint", "This cannot be undone.") : tuiText("resumeDeleteTrashHint", "The conversation can be restored from the trash.")} · ${tuiText("resumeConfirmKeys", "y confirm · n cancel")}`,
					),
					width,
				),
			);
			return lines;
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
		const hiddenSubagents = view.counts.hiddenSubagents ?? 0;
		if (hiddenSubagents > 0) {
			lines.push(
				truncateToWidth(
					theme.fg("dim", `  ${tuiTextFmt("resumeHiddenSubagentsFmt", "%d subagents hidden", hiddenSubagents)}`),
					width,
				),
			);
		}
		const mode = this.#subagentsMode();
		const flat = flattenResumeRows(view.rows, this.#state, searching, mode);
		if (flat.length === 0) {
			lines.push(...this.#emptyState(view, searching, width));
			return lines;
		}
		const selectedIndex = this.#selectedIndex(flat);
		const height = this.#listHeight();
		this.#clampScroll();
		const end = Math.min(flat.length, this.#scrollOffset + height);
		const now = Date.now();
		const conversationRows = flat
			.map(entry => entry.row)
			.filter((row): row is ResumeTreeConversationRow => row.type === "conversation");
		const columns = conversationColumns(conversationRows, now);
		for (let index = this.#scrollOffset; index < end; index++) {
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
					}),
				);
			} else if (row.type === "workspace") {
				this.#hitRows.set(lineIndex, { kind: "toggle", key: rowIdentity(row) });
				lines.push(
					renderWorkspaceRow(row, {
						width,
						selected,
						collapsed: this.#state.collapsedWorkspaces.has(row.key) && !searching,
						referenceBranch: view.referenceBranch,
						current: view.currentWorkspaceKey === row.key,
					}),
				);
			} else if (row.type === "subagents") {
				this.#hitRows.set(lineIndex, { kind: "toggle", key: rowIdentity(row) });
				lines.push(renderSubagentsRow(row, { width, selected }));
			} else {
				this.#hitRows.set(lineIndex, { kind: "conversation", key: rowIdentity(row) });
				lines.push(renderConversationRow(row, { width, selected, now, columns }));
			}
		}
		return lines;
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
