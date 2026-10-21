/**
 * Native (`picker`) mapping of the resume directory model.
 *
 * The coding-agent owns the data model (`ResumeDirectory` / `buildResumeView`:
 * project → workspace → conversation). pi-tui cannot import it (dependency
 * direction), so this module declares structurally compatible `*Like` types
 * and accepts a {@link ResumeSourceLike} the host builds from its real
 * directory and view builder (the ANSI tree passes the same object). Nothing
 * here re-groups conversations: the rows come from the model, and this module
 * only turns them into picker props.
 */
import type { TspPickerGroup, TspPickerItem, TspPickerScope, TspSpan, TspTone } from "@linxiraos/pi-wire";
import type { SessionSelectorStatus } from "./session-selector";
import { tuiText, tuiTextFmt } from "../i18n";
import { compact, kv, md, node, span } from "../native/describe";
import { pickerAge, pickerDate, pickerHits } from "../native/picker";
import type { NativeChild } from "../native/node";
import { plainText } from "../native/spans";
import { theme } from "../theme/theme";
import { shortenPath } from "../render/render-utils";

export type ResumeScopeKindLike = "workspace" | "project" | "all";

export interface ResumeScopeLike {
	readonly kind: ResumeScopeKindLike;
	readonly key?: string;
	readonly projectKey?: string;
	readonly workspaceKey?: string;
}

export type ResumeScopeInputLike = ResumeScopeKindLike | ResumeScopeLike;

/** Parsed query, as far as the native renderer reads it (the ANSI tree passes a subset). */
export interface ResumeQueryLike {
	readonly raw: string;
	readonly terms?: readonly string[];
	readonly project?: readonly string[];
	readonly workspace?: readonly string[];
	readonly branch?: readonly string[];
	readonly status?: readonly string[];
	readonly current?: boolean | null;
	readonly fork?: boolean | null;
	readonly pinned?: boolean | null;
}

/** The session fields the picker reads; the host's `SessionInfo` supplies all of them. */
export interface ResumeSessionLike {
	readonly path: string;
	readonly id: string;
	readonly cwd: string;
	readonly title?: string;
	readonly modified: Date;
	readonly size?: number;
	readonly firstMessage?: string;
	readonly allMessagesText?: string;
	readonly status?: SessionSelectorStatus;
	readonly parentSessionPath?: string;
	readonly created?: Date;
	readonly messageCount?: number;
	readonly assistantTurns?: number;
	/** Last model recorded in the session (`provider/modelId`), when one was persisted. */
	readonly model?: string;
}

export interface ResumeConversationLike {
	readonly session: ResumeSessionLike;
	readonly key: string;
	readonly id: string;
	readonly path: string;
	readonly title: string;
	readonly cwd: string;
	readonly projectKey: string;
	readonly workspaceKey: string;
	readonly created: Date;
	readonly modified: Date;
	readonly status?: SessionSelectorStatus;
	readonly pinned: boolean;
	readonly current: boolean;
	readonly fork: boolean;
	readonly messageCount: number;
}

export interface ResumeWorkspaceLike {
	readonly key: string;
	readonly path: string;
	readonly name: string;
	readonly projectKey: string;
	readonly branch: string | null;
	readonly isWorktree?: boolean;
	readonly pinned: boolean;
	readonly lastActivity: Date | null;
	readonly conversations: readonly ResumeConversationLike[];
	readonly counts: { readonly conversations: number; readonly pinnedConversations: number };
}

export interface ResumeProjectLike {
	readonly key: string;
	readonly root: string;
	readonly name: string;
	readonly alias: string | null;
	readonly displayName: string;
	readonly isDefault: boolean;
	readonly pinned: boolean;
	readonly removable?: boolean;
	readonly collapsed: boolean;
	readonly lastActivity: Date | null;
	readonly workspaces?: readonly ResumeWorkspaceLike[];
	readonly conversations?: readonly ResumeConversationLike[];
	readonly counts: {
		readonly conversations: number;
		readonly workspaces: number;
		readonly pinnedConversations: number;
	};
}

export interface ResumeDirectoryLike {
	readonly projects: readonly ResumeProjectLike[];
	readonly workspaces: readonly ResumeWorkspaceLike[];
	readonly conversations: readonly ResumeConversationLike[];
	readonly defaultProjectKey: string;
	readonly defaultWorkspaceKey: string;
	readonly counts: {
		readonly projects: number;
		readonly workspaces: number;
		readonly conversations: number;
		readonly pinnedConversations: number;
	};
}

export interface ResumeProjectRowLike {
	readonly type: "project";
	readonly key: string;
	readonly project: ResumeProjectLike;
	readonly depth?: 0;
	readonly pinned: boolean;
	readonly collapsed: boolean;
	readonly conversationCount: number;
	readonly totalConversationCount: number;
	readonly workspaceCount: number;
	readonly totalWorkspaceCount: number;
}

export interface ResumeWorkspaceRowLike {
	readonly type: "workspace";
	readonly key: string;
	readonly workspace: ResumeWorkspaceLike;
	readonly projectKey: string;
	readonly depth?: 1;
	readonly pinned: boolean;
	readonly conversationCount: number;
	readonly totalConversationCount: number;
}

export interface ResumeConversationRowLike {
	readonly type: "conversation";
	readonly key: string;
	readonly conversation: ResumeConversationLike;
	readonly projectKey: string;
	readonly workspaceKey: string;
	readonly depth?: 2;
	readonly pinned: boolean;
	readonly current: boolean;
	readonly score?: number;
	readonly pinnedOnly?: boolean;
}

export type ResumeViewRowLike = ResumeProjectRowLike | ResumeWorkspaceRowLike | ResumeConversationRowLike;

export interface ResumeViewCountsLike {
	readonly conversations: number;
	readonly workspaces?: number;
	readonly projects?: number;
	readonly pinnedConversations?: number;
	readonly totalConversations: number;
	readonly totalWorkspaces?: number;
	readonly totalProjects?: number;
}

export interface ResumeViewLike {
	readonly scope: ResumeScopeLike;
	readonly query: ResumeQueryLike;
	readonly rows: readonly ResumeViewRowLike[];
	/** Conversation rows; the ANSI tree leaves it out and read `rows` instead. */
	readonly conversations?: readonly ResumeConversationRowLike[];
	readonly counts: ResumeViewCountsLike;
}

export interface ResumeViewOptionsLike {
	scope?: ResumeScopeInputLike;
	query?: string;
	currentSessionPath?: string;
}

/** Names and per-scope conversation totals for the segmented control. */
export interface ResumeScopeSummaryLike {
	readonly workspaceName: string;
	readonly projectName: string;
	readonly counts: Readonly<Record<ResumeScopeKindLike, number>>;
}

/**
 * The host's resume model: the loaded directory plus its pure view builder.
 * Shared with the ANSI tree, which supplies the same object; `directory` is
 * null until the first scan finishes, and `buildView` returns null then.
 */
export interface ResumeSourceLike {
	readonly directory: ResumeDirectoryLike | null;
	readonly initialScope?: ResumeScopeKindLike;
	readonly deleteMode?: "trash" | "permanent";
	buildView(options: ResumeViewOptionsLike): ResumeViewLike | null;
	scopeSummary?(): ResumeScopeSummaryLike;
	persistScope?(scope: ResumeScopeKindLike): void | Promise<void>;
	refresh?(): Promise<void>;
	pinConversation?(conversation: ResumeConversationLike, pinned: boolean): void | Promise<void>;
	deleteConversation?(conversation: ResumeConversationLike): boolean | Promise<boolean>;
	isLoading?(): boolean;
	loadError?(): string | undefined;
}

export const RESUME_SCOPE_ORDER: readonly ResumeScopeKindLike[] = ["workspace", "project", "all"];

/** The scope after `kind` in the three-way cycle (Tab). */
export function nextResumeScope(kind: ResumeScopeKindLike): ResumeScopeKindLike {
	const index = RESUME_SCOPE_ORDER.indexOf(kind);
	return RESUME_SCOPE_ORDER[(index + 1) % RESUME_SCOPE_ORDER.length]!;
}

/** The segmented control's label for a scope kind. */
export function resumeScopeLabel(kind: ResumeScopeKindLike): string {
	switch (kind) {
		case "workspace":
			return tuiText("resumeScopeWorkspace", "this workspace");
		case "project":
			return tuiText("resumeScopeProject", "this repository");
		case "all":
			return tuiText("resumeScopeAll", "all projects");
	}
}

/**
 * Per-scope conversation totals for the segmented control. The host summary
 * wins when present (the ANSI tree already computes it); otherwise the active
 * scope's own pre-query total is reused and the other scopes cost one
 * empty-query view each, so the model's scope resolution (current session →
 * default workspace) decides the group, not this module.
 */
export function resumeScopeTabs(
	source: ResumeSourceLike,
	active: ResumeViewLike,
	currentSessionPath: string | undefined,
): TspPickerScope[] {
	const summary = source.scopeSummary?.();
	if (summary) {
		return RESUME_SCOPE_ORDER.map(kind => ({
			id: kind,
			label: resumeScopeLabel(kind),
			count: summary.counts[kind] ?? 0,
		}));
	}
	const counts = new Map<ResumeScopeKindLike, number>();
	counts.set(active.scope.kind, active.counts.totalConversations);
	for (const kind of RESUME_SCOPE_ORDER) {
		if (counts.has(kind)) continue;
		const view = kind === "all" ? undefined : source.buildView({ scope: kind, query: "", currentSessionPath });
		counts.set(kind, view ? view.counts.totalConversations : (source.directory?.counts.conversations ?? 0));
	}
	return RESUME_SCOPE_ORDER.map(kind => ({
		id: kind,
		label: resumeScopeLabel(kind),
		count: counts.get(kind) ?? 0,
	}));
}

function statusWord(status: SessionSelectorStatus | undefined): string | undefined {
	switch (status) {
		case "complete":
			return tuiText("ssStatusDone", "done");
		case "interrupted":
			return tuiText("ssStatusInterrupted", "interrupted");
		case "aborted":
			return tuiText("ssStatusAborted", "aborted");
		case "error":
			return tuiText("ssStatusError", "error");
		case "pending":
			return tuiText("ssStatusPending", "pending");
		default:
			return undefined;
	}
}

function statusTone(status: SessionSelectorStatus | undefined): TspTone | undefined {
	switch (status) {
		case "complete":
			return "success";
		case "interrupted":
			return "warning";
		case "aborted":
		case "error":
			return "error";
		case "pending":
			return "pending";
		default:
			return undefined;
	}
}

function statusDot(status: SessionSelectorStatus | undefined): string | undefined {
	switch (status) {
		case "complete":
			return theme.status.success;
		case "interrupted":
			return theme.status.warning;
		case "aborted":
			return theme.status.aborted;
		case "error":
			return theme.status.error;
		case "pending":
			return theme.status.pending;
		default:
			return undefined;
	}
}

/** `word + dot` for the preview's status row. */
function statusSpans(status: SessionSelectorStatus | undefined): TspSpan[] | undefined {
	const word = statusWord(status);
	if (!word) return undefined;
	const tone = statusTone(status) ?? "muted";
	const glyph = statusDot(status);
	return glyph ? [span(`${glyph} `, tone), span(word, tone)] : [span(word, tone)];
}

function cwdSpans(cwd: string): TspSpan[] {
	const short = shortenPath(cwd);
	const cut = short.lastIndexOf("/") + 1;
	return cut > 0 && cut < short.length
		? [span(short.slice(0, cut), "path dim"), span(short.slice(cut), "path")]
		: [span(short, "path")];
}

function conversationMessage(conversation: ResumeConversationLike): string {
	return plainText(conversation.session.firstMessage ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

function conversationLabel(conversation: ResumeConversationLike): string {
	const title = conversation.title ? plainText(conversation.title).trim() : "";
	return title || conversationMessage(conversation) || conversation.id;
}

/** The view's conversation rows, whether the host projected them separately or left only `rows`. */
function viewConversations(view: ResumeViewLike): readonly ResumeConversationRowLike[] {
	return (
		view.conversations ?? view.rows.filter((row): row is ResumeConversationRowLike => row.type === "conversation")
	);
}

/** Assistant turns the session persisted; older listings fall back to the message count. */
export function resumeTurnCount(conversation: ResumeConversationLike): number {
	return conversation.session.assistantTurns ?? conversation.messageCount ?? 0;
}

export interface ResumeItemOptions {
	/** Show each conversation's working directory (multi-worktree scopes). */
	readonly showCwd?: boolean;
	readonly now?: number;
}

/** One conversation card: the existing facts plus turns, branch and model. */
export function resumePickerItem(
	row: ResumeConversationRowLike,
	workspace: ResumeWorkspaceLike | undefined,
	options: ResumeItemOptions = {},
): TspPickerItem {
	const conversation = row.conversation;
	const message = conversationMessage(conversation);
	const title = conversation.title ? plainText(conversation.title).trim() : "";
	const badges: { text: string; tone?: TspTone; title?: string }[] = [];
	if (conversation.fork) badges.push({ text: "fork" });
	if (conversation.current) badges.push({ text: "current", tone: "accent" });
	const when = pickerDate(conversation.modified);
	const detail = options.showCwd && conversation.cwd ? cwdSpans(conversation.cwd) : title ? message : undefined;
	const dot = statusTone(conversation.status);
	const branch = workspace?.branch ?? undefined;
	const model = conversation.session.model;
	return {
		id: conversation.path,
		label: conversationLabel(conversation),
		...(detail ? { detail } : {}),
		facts: {
			when: pickerAge(conversation.modified, options.now),
			turns: resumeTurnCount(conversation),
			...(branch ? { branch } : {}),
			...(model ? { model } : {}),
		},
		...(dot ? { dot } : {}),
		...(conversation.pinned ? { icon: "pin" } : {}),
		...(badges.length > 0 ? { badges } : {}),
		title: options.showCwd && message ? `${message}\n${when}` : when,
	};
}

/** Project and workspace section heads followed by their conversations, from the model's rows. */
export function resumePickerOrder(view: ResumeViewLike): (string | TspPickerGroup)[] {
	const order: (string | TspPickerGroup)[] = [];
	for (const row of view.rows) {
		switch (row.type) {
			case "project":
				order.push({
					group: `project:${row.key}`,
					label: row.project.displayName,
					count: row.conversationCount,
				});
				break;
			case "workspace":
				order.push({
					group: `workspace:${row.key}`,
					label: row.workspace.branch ? `${row.workspace.name} · ${row.workspace.branch}` : row.workspace.name,
					count: row.conversationCount,
				});
				break;
			case "conversation":
				order.push(row.conversation.path);
				break;
		}
	}
	return order;
}

/** Free-text hit ranges for the displayed rows (structured tokens never highlight). */
export function resumePickerHits(
	view: ResumeViewLike,
	items: ReadonlyMap<string, TspPickerItem>,
): Record<string, readonly (readonly [number, number])[]> | undefined {
	const terms = view.query.terms ?? [];
	if (terms.length === 0) return undefined;
	let hits: Record<string, readonly (readonly [number, number])[]> | undefined;
	for (const row of viewConversations(view)) {
		const label = items.get(row.conversation.path)?.label;
		if (typeof label !== "string") continue;
		const ranges = pickerHits(label, terms);
		if (ranges.length > 0) (hits ??= {})[row.conversation.path] = ranges;
	}
	return hits;
}

/** Catalogue items for every conversation in the target scope (identity stable while typing). */
export function resumePickerItems(
	catalogue: ResumeViewLike,
	directory: ResumeDirectoryLike,
	options: ResumeItemOptions = {},
): { items: TspPickerItem[]; byPath: Map<string, TspPickerItem> } {
	const workspaces = new Map(directory.workspaces.map(workspace => [workspace.key, workspace]));
	const byPath = new Map<string, TspPickerItem>();
	const items = viewConversations(catalogue).map(row => {
		const item = resumePickerItem(row, workspaces.get(row.workspaceKey), options);
		byPath.set(item.id, item);
		return item;
	});
	return { items, byPath };
}

/** The selected conversation path: the caller's when still visible, else the first row. */
export function resumePickerSelection(view: ResumeViewLike, preferred: string | null | undefined): string | null {
	const conversations = viewConversations(view);
	if (preferred && conversations.some(row => row.conversation.path === preferred)) return preferred;
	return conversations[0]?.conversation.path ?? null;
}

/**
 * The same view with locally deleted conversations (and the section heads
 * left empty by them) removed. Deletes are host-driven; the directory is not
 * rebuilt per keystroke, so the picker hides the removed rows itself.
 */
export function resumeViewWithout(view: ResumeViewLike, hidden: ReadonlySet<string>): ResumeViewLike {
	if (hidden.size === 0) return view;
	const conversations = viewConversations(view).filter(row => !hidden.has(row.conversation.path));
	const rows = view.rows.filter(row => {
		switch (row.type) {
			case "conversation":
				return !hidden.has(row.conversation.path);
			case "workspace":
				return conversations.some(entry => entry.workspaceKey === row.workspace.key);
			case "project":
				return conversations.some(entry => entry.projectKey === row.project.key);
		}
	});
	return { ...view, rows, conversations, counts: { ...view.counts, conversations: conversations.length } };
}

export interface ResumePickerModel {
	readonly view: ResumeViewLike;
	readonly catalogue: ResumeViewLike;
	readonly items: readonly TspPickerItem[];
	readonly order: readonly (string | TspPickerGroup)[];
	readonly hits?: Readonly<Record<string, readonly (readonly [number, number])[]>>;
	readonly tabs: readonly TspPickerScope[];
	readonly selected: string | null;
	readonly current: readonly string[];
	readonly total: number;
	/** Conversations the filter hides (the ANSI tree stays on screen while filtering). */
	readonly hidden: number;
	readonly empty: string;
	readonly placeholder: string;
}

export interface ResumePickerModelOptions {
	readonly scope: ResumeScopeInputLike;
	readonly query: string;
	readonly currentSessionPath?: string;
	readonly hidden?: ReadonlySet<string>;
	readonly showCwd?: boolean;
	readonly now?: number;
	/** Selection to keep when it survives the query; the first row otherwise. */
	readonly preferredPath?: string | null;
}

/**
 * Everything the native sheet needs for one scope + query: the model's
 * filtered view (rows, counts, tokens), a stable catalogue built without the
 * query, the picker items for it, section order, hits, scope tabs and copy.
 */
export function buildResumePickerModel(
	source: ResumeSourceLike,
	options: ResumePickerModelOptions,
): ResumePickerModel | undefined {
	if (!source.directory) return undefined;
	const filtered = source.buildView({
		scope: options.scope,
		query: options.query,
		currentSessionPath: options.currentSessionPath,
	});
	if (!filtered) return undefined;
	const hidden = options.hidden ?? new Set<string>();
	const view = resumeViewWithout(filtered, hidden);
	const catalogueView =
		options.query.length === 0
			? filtered
			: source.buildView({ scope: options.scope, query: "", currentSessionPath: options.currentSessionPath });
	if (!catalogueView) return undefined;
	const catalogue = resumeViewWithout(catalogueView, hidden);
	const { items, byPath } = resumePickerItems(catalogue, source.directory, {
		showCwd: options.showCwd,
		now: options.now,
	});
	const conversations = viewConversations(catalogue);
	return {
		view,
		catalogue,
		items,
		order: resumePickerOrder(view),
		hits: resumePickerHits(view, byPath),
		tabs: resumeScopeTabs(source, view, options.currentSessionPath),
		selected: resumePickerSelection(view, options.preferredPath),
		current: conversations.filter(row => row.conversation.current || row.current).map(row => row.conversation.path),
		total: conversations.length,
		hidden: Math.max(0, conversations.length - viewConversations(view).length),
		empty: resumeEmptyText(view),
		placeholder: resumePlaceholder(source, options.scope),
	};
}

/** True when the view carries any filter (free text or structured token). */
export function resumeQueryActive(view: ResumeViewLike): boolean {
	const query = view.query;
	return (
		(query.terms?.length ?? 0) > 0 ||
		(query.project?.length ?? 0) > 0 ||
		(query.workspace?.length ?? 0) > 0 ||
		(query.branch?.length ?? 0) > 0 ||
		(query.status?.length ?? 0) > 0 ||
		query.current != null ||
		query.fork != null ||
		query.pinned != null
	);
}

/** The empty pane's copy: no matches while filtering, else the scope's own empty wording. */
export function resumeEmptyText(view: ResumeViewLike): string {
	if (resumeQueryActive(view)) {
		return tuiTextFmt("resumeNoMatchFmt", "No conversations match “%s”", view.query.raw.trim());
	}
	switch (view.scope.kind) {
		case "workspace":
			return tuiText("resumeEmptyWorkspace", "No conversations in this workspace.");
		case "project":
			return tuiText("resumeEmptyProject", "No conversations in this repository.");
		case "all":
			return tuiText("resumeEmptyAll", "No conversations yet.");
	}
}

/** The search field's placeholder for the active scope (names come from the host summary). */
export function resumePlaceholder(source: ResumeSourceLike, scope: ResumeScopeInputLike): string {
	const kind = typeof scope === "string" ? scope : scope.kind;
	if (kind === "all") return tuiText("resumeSearchAll", "Search all conversations…");
	const summary = source.scopeSummary?.();
	const name = kind === "workspace" ? summary?.workspaceName : summary?.projectName;
	return name
		? tuiTextFmt(
				kind === "workspace" ? "resumeSearchInWorkspace" : "resumeSearchInProject",
				"Search conversations in %s…",
				name,
			)
		: tuiText("resumeSearchAll", "Search all conversations…");
}

const PREVIEW_EXCERPT_CHARS = 1200;

/** The selected conversation's preview: project, workspace, branch, status, model, then the excerpt. */
export function resumeConversationPreview(
	conversation: ResumeConversationLike,
	project: ResumeProjectLike | undefined,
	workspace: ResumeWorkspaceLike | undefined,
): NativeChild[] {
	const first = (conversation.session.firstMessage ?? "").trim();
	const allMessages = conversation.session.allMessagesText ?? "";
	const rest = allMessages.startsWith(first) ? allMessages.slice(first.length).trim() : "";
	const excerpt = compact([
		first.length > 0 &&
			md(first.length > PREVIEW_EXCERPT_CHARS ? `${first.slice(0, PREVIEW_EXCERPT_CHARS)}…` : first, {
				tone: "user",
			}),
		rest.length > 0 && md(rest.length > PREVIEW_EXCERPT_CHARS ? `…${rest.slice(-PREVIEW_EXCERPT_CHARS)}` : rest),
	]);
	const created =
		conversation.created && !Number.isNaN(conversation.created.getTime()) ? conversation.created : undefined;
	const model = conversation.session.model;
	return compact([
		node("text", { text: conversationLabel(conversation), role: "zeta.picker.title" }),
		kv([
			["Project", project?.displayName],
			["Workspace", workspace?.name],
			["Branch", workspace?.branch ?? undefined],
			["Status", statusSpans(conversation.status)],
			["Model", model],
			["Turns", String(resumeTurnCount(conversation))],
			["Created", created && pickerDate(created)],
			["Modified", pickerDate(conversation.modified)],
			["Folder", conversation.cwd ? cwdSpans(conversation.cwd) : undefined],
		]),
		excerpt.length > 0 && node("section", { head: "Conversation" }, excerpt),
	]);
}

/** Project/workspace lookups for a conversation path, derived from the directory (no re-grouping). */
export function resumeConversationContext(
	directory: ResumeDirectoryLike,
	path: string,
):
	| {
			conversation: ResumeConversationLike;
			project: ResumeProjectLike | undefined;
			workspace: ResumeWorkspaceLike | undefined;
	  }
	| undefined {
	const conversation = directory.conversations.find(candidate => candidate.path === path);
	if (!conversation) return undefined;
	return {
		conversation,
		project: directory.projects.find(project => project.key === conversation.projectKey),
		workspace: directory.workspaces.find(workspace => workspace.key === conversation.workspaceKey),
	};
}
