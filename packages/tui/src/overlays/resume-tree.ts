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
import { theme } from "../theme/theme";
import type { ThemeColor } from "../theme/theme";

export type ResumeTreeScope = "workspace" | "project" | "all";
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

interface Segment {
	text: string;
	priority: number;
	tone?: ThemeColor;
	flex?: boolean;
	droppable?: boolean;
	/** Truncate in the middle (paths) instead of the end. */
	middle?: boolean;
	separator?: boolean;
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

function paint(segment: Segment): string {
	return segment.tone ? theme.fg(segment.tone, segment.text) : segment.text;
}

/**
 * Render segments into `width` columns, dropping the lowest-priority segments
 * first and shrinking flexible text last. A non-droppable segment (the status
 * word) survives every width.
 */
export function renderSegments(segments: readonly Segment[], width: number): string {
	const kept = segments.filter(segment => segment.text.length > 0);
	const measure = (): number => {
		const separator = ` ${theme.sep.dot} `;
		return kept.reduce(
			(total, segment, index) => total + visibleWidth(segment.text) + (index > 0 ? visibleWidth(separator) : 0),
			0,
		);
	};
	const candidates = kept
		.filter(segment => segment.droppable !== false && !segment.flex)
		.sort((a, b) => a.priority - b.priority);
	for (const candidate of candidates) {
		if (measure() <= width) break;
		const index = kept.indexOf(candidate);
		if (index >= 0) kept.splice(index, 1);
	}
	const flexible = kept.filter(segment => segment.flex).sort((a, b) => a.priority - b.priority);
	for (const segment of flexible) {
		const overflow = measure() - width;
		if (overflow <= 0) break;
		const current = visibleWidth(segment.text);
		const target = Math.max(1, current - overflow);
		if (segment.middle && target < 6) {
			// A path shortened to "…" carries no information; drop it instead and
			// let the remaining flexible text shrink.
			const index = kept.indexOf(segment);
			if (index >= 0) kept.splice(index, 1);
			continue;
		}
		segment.text = segment.middle ? middleEllipsis(segment.text, target) : truncateToWidth(segment.text, target);
	}
	if (measure() > width) {
		// Nothing droppable or flexible is left: hard-truncate the whole line.
		const rendered = kept.map(paint).join(` ${theme.fg("dim", theme.sep.dot)} `);
		return truncateToWidth(rendered, width);
	}
	return kept.map(paint).join(` ${theme.fg("dim", theme.sep.dot)} `);
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

/** One rendered conversation row (status word first, then title, age, turns, badges). */
export function renderConversationRow(
	row: ResumeTreeConversationRow,
	options: { width: number; selected: boolean; now?: number },
): string {
	const selected = options.selected;
	const cursor = selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(4);
	const status = statusWord(row.conversation.status);
	const segments: Segment[] = [];
	if (status) segments.push({ text: status.text, priority: 1_000, tone: status.tone, droppable: false });
	segments.push({
		text: row.conversation.title || row.conversation.id,
		priority: 900,
		flex: true,
	});
	segments.push({ text: formatResumeAge(row.conversation.modified, options.now), priority: 40, tone: "dim" });
	segments.push({
		text:
			row.conversation.messageCount === 1
				? tuiText("resumeTurnCountOne", "1 turn")
				: tuiTextFmt("resumeTurnCountFmt", "%d turns", row.conversation.messageCount),
		priority: 20,
		tone: "dim",
	});
	if (row.current) {
		segments.push({ text: tuiText(CURRENT_LABEL_KEY, "current"), priority: 70, tone: "accent" });
	}
	if (row.conversation.fork) {
		segments.push({ text: tuiText("ssForkLabel", "fork"), priority: 60, tone: "dim" });
	}
	if (row.pinned) {
		segments.push({ text: tuiText(PINNED_LABEL_KEY, "pinned"), priority: 80, tone: "accent" });
	}
	const available = Math.max(1, options.width - visibleWidth(cursor) - visibleWidth(indent));
	const line = renderSegments(segments, available);
	const rendered = selected ? theme.bold(line) : line;
	return `${cursor}${indent}${rendered}`;
}

/** One rendered workspace row: branch, path tail, conversation count. */
export function renderWorkspaceRow(
	row: ResumeTreeWorkspaceRow,
	options: { width: number; selected: boolean; collapsed: boolean },
): string {
	const cursor = options.selected ? theme.fg("accent", `${theme.nav.cursor} `) : padding(2);
	const indent = padding(2);
	const fold = options.collapsed ? "▸" : "▾";
	const segments: Segment[] = [
		{
			text: `${fold} ${row.workspace.branch ?? row.workspace.name}`,
			priority: 800,
			tone: options.selected ? "accent" : undefined,
			flex: true,
		},
	];
	if (row.workspace.path) {
		segments.push({
			text: resumePathTail(row.workspace.path),
			priority: 50,
			tone: "dim",
			flex: true,
			middle: true,
		});
	}
	segments.push({ text: conversationCountText(row), priority: 90, tone: "dim", droppable: false });
	const available = Math.max(1, options.width - visibleWidth(cursor) - visibleWidth(indent));
	return `${cursor}${indent}${renderSegments(segments, available)}`;
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
	const segments: Segment[] = [
		{ text: `${fold} ${pin}${name}`, priority: 900, flex: true, tone: options.selected ? "accent" : undefined },
		{ text: conversationCountText(row), priority: 80, tone: "dim", droppable: false },
	];
	const workspaces =
		row.totalWorkspaceCount === 1
			? tuiText("resumeWorkspaceCountOne", "1 workspace")
			: tuiTextFmt("resumeWorkspaceCountFmt", "%d workspaces", row.totalWorkspaceCount);
	segments.push({ text: workspaces, priority: 70, tone: "dim" });
	if (row.project.lastActivity) {
		segments.push({ text: formatResumeAge(row.project.lastActivity, options.now), priority: 30, tone: "dim" });
	}
	const available = Math.max(1, options.width - visibleWidth(cursor));
	return `${cursor}${renderSegments(segments, available)}`;
}

/** The three-tab scope control with per-scope counts. */
export function renderScopeHeader(scope: ResumeTreeScope, summary: ResumeTreeScopeSummary, width: number): string {
	const labels: { kind: ResumeTreeScope; label: string }[] = [
		{ kind: "workspace", label: tuiText("resumeScopeWorkspace", "this workspace") },
		{ kind: "project", label: tuiText("resumeScopeProject", "this repository") },
		{ kind: "all", label: tuiText("resumeScopeAll", "all projects") },
	];
	const parts: { text: string; priority: number }[] = [];
	for (const { kind, label } of labels) {
		const selected = kind === scope;
		const count = summary.counts[kind] ?? 0;
		const text = `${selected ? "[" : " "}${label}${selected ? "]" : " "}`;
		parts.push({
			text: selected ? theme.bold(theme.fg("accent", text)) : theme.fg("muted", text),
			priority: selected ? 1_000 : 100,
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
	return truncateToWidth(rendered, width);
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

interface ResumeTreeState {
	collapsedProjects: Set<string>;
	expandedProjects: Set<string>;
	collapsedWorkspaces: Set<string>;
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
	#view: ResumeTreeView | null = null;
	#viewQuery = "\0";
	#viewScope: ResumeTreeScope | null = null;
	#searchFocused: boolean;
	#selectedKey: string | undefined;
	#scrollOffset = 0;
	#deleteTarget: ResumeTreeConversationRow | null = null;
	/** Keys pressed on the skeleton while the host's first scan is in flight. */
	#pendingKeys: string[] | undefined;
	#busy = false;
	#notice: string | undefined;
	#expandedOnce = false;
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
		this.#search = new Input();
		this.#search.prompt = "/ ";
		this.#search.onSubmit = () => this.#activate();
		this.#search.onEscape = () => this.#clearSearch();
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
		this.#scope = order[(index + direction + order.length) % order.length]!;
		this.invalidate();
		void this.#source.persistScope?.(this.#scope);
		this.#rebuild();
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
		this.#clampScroll();
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

	handleInput(keyData: string): void {
		if (this.#busy) return;
		if (matchesKey(keyData, "ctrl+c")) {
			this.onExit();
			return;
		}
		// The host's first scan may still be in flight: the skeleton has no rows,
		// so acting on the key now would silently drop it. Hold keys until the
		// load lands, then replay them against the loaded rows.
		if (this.#pendingKeys) {
			this.#pendingKeys.push(keyData);
			return;
		}
		if (this.#viewFor() === null && this.#source.isLoading?.() && this.#source.refresh) {
			const pending: string[] = [keyData];
			this.#pendingKeys = pending;
			void this.#source.refresh().then(() => {
				// A later refresh may have replaced this queue; its own replay owns it.
				if (this.#pendingKeys !== pending) return;
				this.#pendingKeys = undefined;
				this.invalidate();
				this.#rebuild();
				this.onRequestRender?.();
				for (const key of pending) this.handleInput(key);
			});
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
		lines.push(renderScopeHeader(this.#scope, summary, width));
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
		const flat = flattenResumeRows(view.rows, this.#state, searching);
		if (flat.length === 0) {
			lines.push(...this.#emptyState(view, searching, width));
			return lines;
		}
		const selectedIndex = this.#selectedIndex(flat);
		const height = this.#listHeight();
		this.#clampScroll();
		const end = Math.min(flat.length, this.#scrollOffset + height);
		const now = Date.now();
		for (let index = this.#scrollOffset; index < end; index++) {
			const row = flat[index]!.row;
			const selected = index === selectedIndex;
			if (row.type === "project") {
				lines.push(
					renderProjectRow(row, {
						width,
						selected,
						collapsed: projectCollapsed(row, this.#state) && !searching,
						now,
					}),
				);
			} else if (row.type === "workspace") {
				lines.push(
					renderWorkspaceRow(row, {
						width,
						selected,
						collapsed: this.#state.collapsedWorkspaces.has(row.key) && !searching,
					}),
				);
			} else {
				lines.push(renderConversationRow(row, { width, selected, now }));
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
