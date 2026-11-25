/**
 * Team Hub overlay: the TUI surface for a Team.
 *
 * It is a UI, not an Agent: no team-root session, no AGENTS.md, no transcript.
 * The left pane lists database rooms and the PM/engineer roster; the right pane
 * shows one room's ordered `room_events` (or the selected engineer's real
 * worktrees). Posting writes a room event through the same database service the
 * CLI uses. Missing data stays honest: an empty team shows no invented rooms,
 * agents, or statuses.
 */

import { visibleWidth } from "@linxiraos/pi-tui/text/width";
import { replaceTabs, truncateToWidth, wrapTextWithAnsi } from "../../../utils/text-width";

// ── Data contract (the coding-agent builds this from the real Team DB) ──────

export type TeamHubRoomKind = "pm" | "coordination" | "room";

export interface TeamHubRoom {
	id: string;
	name: string;
	kind: TeamHubRoomKind;
	pmId: string | null;
	pmName: string | null;
	memberCount: number;
	/** Latest host-assigned event sequence, or null for a room with no events. */
	lastSeq: number | null;
	lastSentAt: number | null;
}

export interface TeamHubMember {
	agentId: string;
	role: string;
	/** Display label resolved from a real PM/engineer row, never an absolute path. */
	label: string;
}

export interface TeamHubEvent {
	seq: number;
	/** Unix seconds, assigned by the host. */
	sentAt: number;
	senderAgentId: string;
	senderLabel: string;
	kind: string;
	body: string;
	replyTo: number | null;
}

export interface TeamHubRoomView {
	room: TeamHubRoom;
	members: TeamHubMember[];
	events: TeamHubEvent[];
}

export interface TeamHubWorktree {
	id: string;
	kind: "home" | "task";
	name: string;
	branch: string;
	path: string;
}

export interface TeamHubPm {
	id: string;
	name: string;
	engineerCount: number;
}

export interface TeamHubEngineer {
	id: string;
	name: string;
	pmId: string;
	pmName: string;
	execution: "normal" | "vibe";
	worktrees: TeamHubWorktree[];
}

export interface TeamHubTask {
	id: string;
	taskKey: string;
	title: string;
	status: "pending" | "claimed" | "review" | "done" | "cancelled";
	assignedPmId: string;
	assigneeAgentId: string | null;
	ownerAgentId: string | null;
	leaseExpiresAt: number | null;
	reqIds: string[];
}

export interface TeamHubSnapshot {
	teamId: string;
	teamName: string;
	/** False when the marker exists but the global Team database has no team row. */
	dbAvailable: boolean;
	/** Honest explanation (missing DB row, requested room gone, …). */
	warning?: string;
	pms: TeamHubPm[];
	engineers: TeamHubEngineer[];
	rooms: TeamHubRoom[];
	/** Durable work queue rows; absent on older sources. */
	tasks?: TeamHubTask[];
	selectedRoom: TeamHubRoomView | null;
}

/** What the overlay needs from the host; the coding-agent supplies real DB I/O. */
export interface TeamHubDataSource {
	load(options?: { room?: string; preferPmId?: string }): Promise<TeamHubSnapshot>;
	post(input: { room: string; body: string; sender?: string }): Promise<{ seq: number }>;
	createRoom?(input: {
		name: string;
		kind?: "pm" | "coordination" | "room";
		pm?: string;
		shared?: boolean;
		members?: string[];
	}): Promise<{ message: string }>;
	addRoomMember?(input: { room: string; member: string }): Promise<{ message: string }>;
	removeRoomMember?(input: { room: string; member: string }): Promise<{ message: string }>;
	setRoomKind?(input: {
		room: string;
		kind: "pm" | "coordination" | "room";
		pm?: string;
	}): Promise<{ message: string }>;
	taskAction?(input: {
		task: string;
		action: "claim" | "renew" | "release" | "submit" | "complete" | "reject" | "cancel";
		agent?: string;
		pm?: string;
		body?: string;
	}): Promise<{ message: string }>;
}

export interface TeamHubDeps {
	source: TeamHubDataSource;
	/** Called when the Hub should close (Escape on the root). */
	onDone?: () => void;
	/** Called after state changes; a reactive host re-renders from its own effect instead. */
	requestRender?: () => void;
	/** Focus the Hub on this PM on first load (a PM-root launch). */
	initialPmId?: string;
	/** Open Agent Hub (subagent control stays there); omitted in a standalone Hub. */
	openAgentHub?: () => void;
}

// ── Pure helpers (tested directly, no terminal) ─────────────────────────────

export type TeamHubEntryKind = "separator" | "label" | "room" | "task" | "pm" | "engineer";

export interface TeamHubSidebarEntry {
	readonly id: string;
	readonly kind: TeamHubEntryKind;
	readonly label: string;
	readonly annotation?: string;
	roomName?: string;
	agentId?: string;
	pmId?: string;
	taskId?: string;
}

const ROOM_KIND_LABEL: Record<TeamHubRoomKind, string> = {
	pm: "PM",
	coordination: "shared",
	room: "custom",
};

/** Rooms in display order: shared first, then PM rooms, then arbitrary rooms. */
export function sortTeamHubRooms(rooms: readonly TeamHubRoom[]): TeamHubRoom[] {
	const rank: Record<TeamHubRoomKind, number> = { coordination: 0, pm: 1, room: 2 };
	return [...rooms].sort((left, right) => {
		const byKind = rank[left.kind] - rank[right.kind];
		return byKind !== 0 ? byKind : left.name.localeCompare(right.name);
	});
}

/** Events are always displayed in ascending host `seq` order. */
export function orderTeamHubEvents(events: readonly TeamHubEvent[]): TeamHubEvent[] {
	return [...events].sort((left, right) => left.seq - right.seq);
}

/** New events since this Hub opened (or since the room was last viewed). */
export function teamHubUnread(room: TeamHubRoom, baseline: ReadonlyMap<string, number>): number {
	const seen = baseline.get(room.id);
	if (room.lastSeq === null || seen === undefined) return 0;
	return Math.max(0, room.lastSeq - seen);
}

function roomAnnotation(room: TeamHubRoom, unread: number): string {
	const kind = ROOM_KIND_LABEL[room.kind];
	const owner = room.kind === "pm" && room.pmName ? ` ${room.pmName}` : "";
	const members = `${room.memberCount} member${room.memberCount === 1 ? "" : "s"}`;
	const last = room.lastSeq === null ? "no events" : `#${room.lastSeq}`;
	const unreadSuffix = unread > 0 ? ` +${unread}` : "";
	return `${kind}${owner} · ${members} · ${last}${unreadSuffix}`;
}

function engineerAnnotation(engineer: TeamHubEngineer): string {
	const worktrees = engineer.worktrees.length;
	const wt = worktrees === 0 ? "no worktree" : `${worktrees} wt`;
	return `${engineer.execution} · ${wt}`;
}

function taskAnnotation(task: TeamHubTask): string {
	const owner = task.ownerAgentId ?? task.assigneeAgentId ?? "unassigned";
	const reqs = task.reqIds.length > 0 ? ` · ${task.reqIds.join(",")}` : "";
	return `${task.status} · ${owner}${reqs}`;
}

/**
 * Flatten the snapshot into sidebar rows. A filter matches room/agent labels and
 * annotations; section labels disappear while filtering so only matches remain.
 */
export function buildTeamHubEntries(
	snapshot: TeamHubSnapshot | undefined,
	filter = "",
	baseline: ReadonlyMap<string, number> = new Map(),
): TeamHubSidebarEntry[] {
	if (!snapshot) return [];
	const query = filter.trim().toLowerCase();
	const matches = (label: string, annotation: string): boolean =>
		query.length === 0 || `${label} ${annotation}`.toLowerCase().includes(query);

	const entries: TeamHubSidebarEntry[] = [];
	const rooms = sortTeamHubRooms(snapshot.rooms).filter(room =>
		matches(`#${room.name}`, roomAnnotation(room, teamHubUnread(room, baseline))),
	);
	if (rooms.length > 0) {
		if (!query) entries.push({ id: "label:rooms", kind: "label", label: "ROOMS" });
		for (const room of rooms) {
			entries.push({
				id: `room:${room.name}`,
				kind: "room",
				label: `#${room.name}`,
				annotation: roomAnnotation(room, teamHubUnread(room, baseline)),
				roomName: room.name,
			});
		}
	}

	const pms = snapshot.pms
		.slice()
		.sort((left, right) => left.name.localeCompare(right.name))
		.filter(pm => {
			const engineers = snapshot.engineers.filter(engineer => engineer.pmId === pm.id);
			const annotation = `${pm.engineerCount} engineers`;
			return (
				matches(`PM ${pm.name}`, annotation) ||
				engineers.some(engineer => matches(engineer.name, engineerAnnotation(engineer)))
			);
		});
	const tasks = (snapshot.tasks ?? [])
		.slice()
		.sort((left, right) => left.taskKey.localeCompare(right.taskKey))
		.filter(task => matches(`task ${task.taskKey}`, taskAnnotation(task)));
	if (tasks.length > 0) {
		if (!query) entries.push({ id: "label:tasks", kind: "label", label: "TASKS" });
		for (const task of tasks) {
			entries.push({
				id: `task:${task.taskKey}`,
				kind: "task",
				label: task.taskKey,
				annotation: taskAnnotation(task),
				taskId: task.taskKey,
			});
		}
	}

	if (pms.length > 0) {
		if (!query) entries.push({ id: "label:people", kind: "label", label: "PMS & ENGINEERS" });
		for (const pm of pms) {
			entries.push({
				id: `pm:${pm.id}`,
				kind: "pm",
				label: `PM ${pm.name}`,
				annotation: `${pm.engineerCount} engineers`,
				pmId: pm.id,
				agentId: pm.id,
			});
			for (const engineer of snapshot.engineers
				.filter(row => row.pmId === pm.id)
				.sort((left, right) => left.name.localeCompare(right.name))) {
				const annotation = engineerAnnotation(engineer);
				if (!matches(engineer.name, annotation)) continue;
				entries.push({
					id: `engineer:${engineer.id}`,
					kind: "engineer",
					label: `  ${engineer.name}`,
					annotation,
					pmId: pm.id,
					agentId: engineer.id,
				});
			}
		}
	}
	return entries;
}

/** Move the selection by `delta`, skipping section labels and separators. */
export function moveTeamHubSelection(
	entries: readonly TeamHubSidebarEntry[],
	currentId: string | undefined,
	delta: number,
): string | undefined {
	const selectable = entries.filter(entry => entry.kind !== "label" && entry.kind !== "separator");
	if (selectable.length === 0) return undefined;
	let index = selectable.findIndex(entry => entry.id === currentId);
	if (index < 0) index = delta >= 0 ? -1 : 0;
	const next = (index + delta + selectable.length * 2) % selectable.length;
	return selectable[next]?.id;
}

/** First room of a scope, used by `g` (shared) and PM-focused launches. */
export function selectTeamHubRoom(
	rooms: readonly TeamHubRoom[],
	scope: "shared" | "pm",
	pmId?: string,
): TeamHubRoom | undefined {
	const ordered = sortTeamHubRooms(rooms);
	if (scope === "shared") {
		return ordered.find(room => room.kind === "coordination") ?? ordered.find(room => room.kind === "room");
	}
	if (pmId) {
		const owned = ordered.filter(room => room.pmId === pmId);
		if (owned.length > 0) return owned[0];
	}
	return ordered.find(room => room.kind === "pm");
}

/** `p`: the next room owned by `pmId`, wrapping; undefined when the PM owns none. */
export function nextTeamHubPmRoom(
	rooms: readonly TeamHubRoom[],
	currentRoom: string | undefined,
	pmId: string | undefined,
): TeamHubRoom | undefined {
	const owned = sortTeamHubRooms(rooms).filter(room => (pmId ? room.pmId === pmId : room.kind === "pm"));
	if (owned.length === 0) return undefined;
	const index = owned.findIndex(room => room.name === currentRoom);
	return owned[(index + 1) % owned.length] ?? owned[0];
}

/** Filter room events for `/` (body, sender, kind, or sequence). */
export function filterTeamHubEvents(events: readonly TeamHubEvent[], filter: string): TeamHubEvent[] {
	const query = filter.trim().toLowerCase();
	if (!query) return [...events];
	return events.filter(event => {
		const haystack = `${event.seq} ${event.senderLabel} ${event.kind} ${event.body}`.toLowerCase();
		return haystack.includes(query);
	});
}

function pad2(value: number): string {
	return value.toString().padStart(2, "0");
}

/** `HH:MM` for today, `MM-DD HH:MM` otherwise. Pure for tests. */
export function formatTeamHubTime(sentAt: number, now: Date = new Date()): string {
	const date = new Date(sentAt * 1000);
	const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	return sameDay ? clock : `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
}

export interface TeamHubEventParts {
	time: string;
	sender: string;
	reply: string | null;
	body: string;
}

/** Plain single-line breakdown of an event; the renderer styles each part. */
export function describeTeamHubEvent(event: TeamHubEvent, now: Date = new Date()): TeamHubEventParts {
	return {
		time: formatTeamHubTime(event.sentAt, now),
		sender: event.senderLabel,
		reply: event.replyTo === null ? null : `↳#${event.replyTo}`,
		body: event.body.replace(/[\r\n\t]+/g, " ").trim(),
	};
}

/** Width-aware plain text for one event (used by tests and non-themed hosts). */
export function formatTeamHubEvent(event: TeamHubEvent, width: number, now: Date = new Date()): string[] {
	const parts = describeTeamHubEvent(event, now);
	const head = `${parts.time}  ${parts.sender}${parts.reply ? ` ${parts.reply}` : ""}  `;
	const bodyWidth = Math.max(8, width - visibleWidth(head));
	return wrapTextWithAnsi(parts.body || "(empty)", bodyWidth).map((line, index) =>
		index === 0 ? `${head}${line}` : `${" ".repeat(visibleWidth(head))}${line}`,
	);
}

// ── Model ───────────────────────────────────────────────────────────────────

/** Which pane owns j/k and the footer hint. */
export type TeamHubFocus = "roster" | "events" | "composer";

/** State of the room composer while it is open. */
export interface TeamHubComposerState {
	readonly room: string;
	readonly senderIndex: number;
	readonly draft: string;
}

/** State of the add/remove-member prompt while it is open. */
export interface TeamHubMemberState {
	readonly mode: "add" | "remove";
	readonly room: string;
	readonly draft: string;
}

/**
 * Selection, filtering, room timeline, composer and refresh state of the Team
 * Hub. A host view reads the getters and calls the action methods; nothing
 * here draws rows, styles text or decodes keys.
 */
export class TeamHubModel {
	readonly #deps: TeamHubDeps;
	#snapshot: TeamHubSnapshot | undefined;
	#entries: TeamHubSidebarEntry[] = [];
	#selectedId: string | undefined;
	#filter = "";
	#filterEditing = false;
	#focus: TeamHubFocus = "roster";
	#loading = false;
	#error: string | undefined;
	#warning: string | undefined;
	#notice: string | undefined;
	#composerRoom: string | undefined;
	#composerSender = 0;
	#composerDraft = "";
	#memberMode: "add" | "remove" | undefined;
	#memberRoom: string | undefined;
	#memberDraft = "";
	#detailAgentId: string | undefined;
	#detailTaskId: string | undefined;
	#focusedPmId: string | undefined;
	#baseline = new Map<string, number>();
	#eventScroll = 0;
	#generation = 0;
	#disposed = false;
	#lastLoad: Promise<void> = Promise.resolve();

	constructor(deps: TeamHubDeps) {
		this.#deps = deps;
		this.#focusedPmId = deps.initialPmId;
		void this.reload();
	}

	/** Resolves after the latest database read settles (initial load or refresh). */
	get ready(): Promise<void> {
		return this.#lastLoad;
	}
	get snapshot(): TeamHubSnapshot | undefined {
		return this.#snapshot;
	}
	get entries(): readonly TeamHubSidebarEntry[] {
		return this.#entries;
	}
	get selectedId(): string | undefined {
		return this.#selectedId;
	}
	get selectedEntry(): TeamHubSidebarEntry | undefined {
		return this.#entries.find(entry => entry.id === this.#selectedId);
	}
	get selectedRoom(): TeamHubRoomView | undefined {
		return this.#snapshot?.selectedRoom ?? undefined;
	}
	get detailTask(): TeamHubTask | undefined {
		return this.#detailTaskId ? this.#snapshot?.tasks?.find(task => task.taskKey === this.#detailTaskId) : undefined;
	}
	get detailAgent(): TeamHubEngineer | undefined {
		return this.#detailAgentId
			? this.#snapshot?.engineers.find(engineer => engineer.id === this.#detailAgentId)
			: undefined;
	}
	get filter(): string {
		return this.#filter;
	}
	get filterEditing(): boolean {
		return this.#filterEditing;
	}
	get focus(): TeamHubFocus {
		return this.#focus;
	}
	get loading(): boolean {
		return this.#loading;
	}
	get error(): string | undefined {
		return this.#error;
	}
	get warning(): string | undefined {
		return this.#warning;
	}
	get notice(): string | undefined {
		return this.#notice;
	}
	get eventScroll(): number {
		return this.#eventScroll;
	}
	get composer(): TeamHubComposerState | undefined {
		if (this.#composerRoom === undefined) return undefined;
		return { room: this.#composerRoom, senderIndex: this.#composerSender, draft: this.#composerDraft };
	}
	get member(): TeamHubMemberState | undefined {
		if (this.#memberMode === undefined || this.#memberRoom === undefined) return undefined;
		return { mode: this.#memberMode, room: this.#memberRoom, draft: this.#memberDraft };
	}

	dispose(): void {
		this.#disposed = true;
		this.#generation++;
	}

	/** Reload the Hub, keeping the current room unless `roomName` names another. */
	reload(roomName?: string): Promise<void> {
		const promise = this.#load(roomName ?? this.selectedRoom?.room.name);
		this.#lastLoad = promise;
		return promise;
	}

	async #load(roomName?: string): Promise<void> {
		if (this.#disposed) return;
		const generation = ++this.#generation;
		this.#loading = true;
		this.#error = undefined;
		this.#warning = undefined;
		this.#requestRender();
		try {
			const snapshot = await this.#deps.source.load({
				room: roomName,
				preferPmId: this.#focusedPmId ?? this.#deps.initialPmId,
			});
			if (this.#disposed || generation !== this.#generation) return;
			this.#snapshot = snapshot;
			this.#warning = snapshot.warning;
			this.#initializeBaseline(snapshot);
			this.#markSelectedRoomSeen();
			this.#rebuild();
		} catch (error) {
			if (this.#disposed || generation !== this.#generation) return;
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			if (!this.#disposed && generation === this.#generation) {
				this.#loading = false;
				this.#requestRender();
			}
		}
	}

	/** Existing events are the baseline; only events arriving while the Hub is open read as new. */
	#initializeBaseline(snapshot: TeamHubSnapshot): void {
		for (const room of snapshot.rooms) {
			if (!this.#baseline.has(room.id)) this.#baseline.set(room.id, room.lastSeq ?? 0);
		}
	}

	#markSelectedRoomSeen(): void {
		const room = this.selectedRoom?.room;
		if (room && room.lastSeq !== null) this.#baseline.set(room.id, room.lastSeq);
	}

	#rebuild(): void {
		this.#entries = buildTeamHubEntries(this.#snapshot, this.#filter, this.#baseline);
		this.#ensureSelection();
	}

	#ensureSelection(): void {
		if (this.#selectedId && this.#entries.some(entry => entry.id === this.#selectedId)) return;
		const selectedRoom = this.selectedRoom?.room;
		if (selectedRoom) {
			const id = `room:${selectedRoom.name}`;
			if (this.#entries.some(entry => entry.id === id)) {
				this.#selectedId = id;
				return;
			}
		}
		this.#selectedId = this.#entries.find(entry => entry.kind !== "label" && entry.kind !== "separator")?.id;
	}

	/** Select a sidebar row; entering a room loads its events. */
	async select(id: string | undefined): Promise<void> {
		if (!id || id === this.#selectedId) {
			this.#requestRender();
			return;
		}
		this.#selectedId = id;
		const entry = this.selectedEntry;
		this.#eventScroll = 0;
		if (entry?.kind === "room") {
			this.#detailAgentId = undefined;
			this.#detailTaskId = undefined;
			if (entry.roomName && entry.roomName !== this.selectedRoom?.room.name) {
				await this.reload(entry.roomName);
				return;
			}
			this.#markSelectedRoomSeen();
		} else if (entry?.kind === "task") {
			this.#detailAgentId = undefined;
			this.#detailTaskId = entry.taskId;
		} else if (entry?.kind === "engineer") {
			this.#detailAgentId = entry.agentId;
			this.#detailTaskId = undefined;
			if (entry.pmId) this.#focusedPmId = entry.pmId;
		} else if (entry?.kind === "pm") {
			this.#detailAgentId = undefined;
			this.#detailTaskId = undefined;
			this.#focusedPmId = entry.pmId;
		}
		this.#requestRender();
	}

	/** Move the selection (roster focus) or scroll the events (events focus). */
	moveSelection(delta: number): void {
		if (this.#focus === "events") {
			this.scrollEvents(delta);
			return;
		}
		void this.select(moveTeamHubSelection(this.#entries, this.#selectedId, delta));
	}

	scrollEvents(delta: number): void {
		this.#eventScroll = Math.max(0, this.#eventScroll + delta);
		this.#requestRender();
	}

	/** Enter: focus a room's timeline or open an engineer's detail. */
	activateSelected(): void {
		const entry = this.selectedEntry;
		if (entry?.kind === "room") {
			this.#focus = "events";
			this.#markSelectedRoomSeen();
			this.#rebuild();
		} else if (entry?.kind === "engineer") {
			this.#focus = "events";
			this.#detailAgentId = entry.agentId;
		}
		this.#requestRender();
	}

	/** `g`: open the shared coordination room. */
	openSharedRoom(): void {
		const room = this.#snapshot ? selectTeamHubRoom(this.#snapshot.rooms, "shared") : undefined;
		if (room) void this.select(`room:${room.name}`);
		else this.setNotice("No shared coordination room exists in this team.");
	}

	/** `p`: next room owned by the focused PM. */
	openNextPmRoom(): void {
		const pmId = this.#focusedPmId ?? this.selectedRoom?.room.pmId ?? this.#snapshot?.pms[0]?.id;
		const room = this.#snapshot
			? nextTeamHubPmRoom(this.#snapshot.rooms, this.selectedRoom?.room.name, pmId)
			: undefined;
		if (room) void this.select(`room:${room.name}`);
		else this.setNotice(pmId ? `PM "${pmId}" owns no room.` : "No PM rooms exist in this team.");
	}

	setNotice(message: string | undefined): void {
		this.#notice = message;
		this.#requestRender();
	}

	/** Replace the roster filter; section labels disappear while a query is active. */
	setFilter(query: string): void {
		this.#filter = query;
		this.#rebuild();
		this.#requestRender();
	}

	beginFilter(): void {
		this.#filterEditing = true;
		this.#requestRender();
	}

	commitFilter(): void {
		this.#filterEditing = false;
		this.#requestRender();
	}

	clearFilter(): void {
		this.#filter = "";
		this.#filterEditing = false;
		this.#rebuild();
		this.#requestRender();
	}

	/** Open the room composer on the selected room. */
	openComposer(): boolean {
		if (this.#detailAgentId || this.#detailTaskId) {
			this.setNotice("Select a room first, then post.");
			return false;
		}
		const room = this.selectedRoom;
		if (!room) {
			this.setNotice("Select a room first, then post.");
			return false;
		}
		if (room.members.length === 0) {
			this.setNotice(`Room "#${room.room.name}" has no members; add a member before posting.`);
			return false;
		}
		this.#notice = undefined;
		this.#composerRoom = room.room.name;
		const ownerIndex = room.room.pmId ? room.members.findIndex(member => member.agentId === room.room.pmId) : -1;
		const pmIndex = room.members.findIndex(member => member.role === "pm");
		this.#composerSender = ownerIndex >= 0 ? ownerIndex : pmIndex >= 0 ? pmIndex : 0;
		this.#composerDraft = "";
		this.#focus = "composer";
		this.#requestRender();
		return true;
	}

	closeComposer(): void {
		this.#composerRoom = undefined;
		this.#composerDraft = "";
		this.#focus = "roster";
		this.#requestRender();
	}

	setComposerDraft(text: string): void {
		this.#composerDraft = text;
	}

	/** Tab/Shift+Tab: choose the member that posts. */
	cycleComposerSender(delta: number): void {
		const room = this.selectedRoom;
		if (!room || room.members.length === 0) return;
		this.#composerSender = (this.#composerSender + delta + room.members.length) % room.members.length;
		this.#requestRender();
	}

	/** Post the composer's draft as the selected member. */
	async submitComposer(value: string): Promise<boolean> {
		const body = value.trim();
		const room = this.selectedRoom;
		if (!room) return false;
		if (!body) {
			this.setNotice("Message body must not be empty.");
			return false;
		}
		const sender = room.members[this.#composerSender];
		if (!sender) {
			this.setNotice("Select a room member as the sender before posting.");
			return false;
		}
		const roomName = this.#composerRoom ?? room.room.name;
		try {
			const result = await this.#deps.source.post({ room: roomName, body, sender: sender.agentId });
			this.#notice = `Posted #${result.seq} to #${roomName} as ${sender.label}.`;
			this.closeComposer();
			await this.reload(roomName);
			return true;
		} catch (error) {
			this.setNotice(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	/** `m`/`M`: open the add/remove-member prompt for the selected room. */
	openMemberInput(mode: "add" | "remove"): boolean {
		const room = this.selectedRoom;
		if (!room) {
			this.setNotice("Select a room first, then press m/M.");
			return false;
		}
		if (mode === "add" ? !this.#deps.source.addRoomMember : !this.#deps.source.removeRoomMember) {
			this.setNotice("This Hub source cannot manage room members.");
			return false;
		}
		this.#memberMode = mode;
		this.#memberRoom = room.room.name;
		this.#memberDraft = "";
		this.#requestRender();
		return true;
	}

	cancelMemberInput(): void {
		this.#memberMode = undefined;
		this.#memberRoom = undefined;
		this.#memberDraft = "";
		this.#requestRender();
	}

	setMemberDraft(text: string): void {
		this.#memberDraft = text;
	}

	/** Apply the member prompt's value to its room. */
	async submitMember(value: string): Promise<boolean> {
		const member = value.trim();
		const room = this.#memberRoom;
		const mode = this.#memberMode;
		if (!member || !room || !mode) return false;
		this.cancelMemberInput();
		try {
			const result =
				mode === "add"
					? await this.#deps.source.addRoomMember?.({ room, member })
					: await this.#deps.source.removeRoomMember?.({ room, member });
			this.#notice = result?.message ?? (mode === "add" ? "Member added." : "Member removed.");
			await this.reload(room);
			return true;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
			this.#requestRender();
			return false;
		}
	}

	/** `c/n/u/x/X/C`: run a task action on the open task's lease. */
	async runTaskAction(action: "claim" | "renew" | "submit" | "complete" | "reject" | "cancel"): Promise<boolean> {
		const task = this.detailTask;
		const source = this.#deps.source.taskAction;
		if (!source) {
			this.setNotice("This Hub source cannot run task actions.");
			return false;
		}
		if (!task) return false;
		this.#notice = `${action} ${task.taskKey}…`;
		this.#requestRender();
		try {
			const result = await source({ task: task.taskKey, action });
			this.#notice = result.message;
			await this.reload(this.selectedRoom?.room.name);
			return true;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
			this.#requestRender();
			return false;
		}
	}

	/** `K`: cycle the selected room's kind. */
	async cycleRoomKind(): Promise<boolean> {
		const source = this.#deps.source.setRoomKind;
		const room = this.selectedRoom;
		if (!source || !room) {
			this.setNotice("Select a room first, then press K.");
			return false;
		}
		const order = ["room", "coordination", "pm"] as const;
		const next = order[(order.indexOf(room.room.kind) + 1) % order.length]!;
		if (next === "pm" && !room.room.pmId) {
			this.setNotice("A pm room needs an owning PM; this room has none.");
			return false;
		}
		try {
			const result = await source({ room: room.room.name, kind: next, pm: room.room.pmId ?? undefined });
			this.#notice = result.message;
			await this.reload(room.room.name);
			return true;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
			this.#requestRender();
			return false;
		}
	}

	/** `a`: hand focus to the Agent Hub when the host provides one. */
	openAgentHub(): void {
		if (this.#deps.openAgentHub) this.#deps.openAgentHub();
		else this.setNotice("Agent Hub is available inside a coding session; this Hub is standalone.");
	}

	/** Escape: clear the filter, leave the events pane, close a detail, else close the Hub. */
	cancel(): void {
		if (this.#filter) {
			this.clearFilter();
			return;
		}
		if (this.#focus === "events") {
			this.#focus = "roster";
			this.#requestRender();
			return;
		}
		if (this.#detailAgentId) {
			this.#detailAgentId = undefined;
			this.#requestRender();
			return;
		}
		this.#deps.onDone?.();
	}

	#requestRender(): void {
		if (!this.#disposed) this.#deps.requestRender?.();
	}
}
