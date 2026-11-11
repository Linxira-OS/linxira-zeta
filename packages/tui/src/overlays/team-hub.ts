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

import { Input } from "../components/input";
import { HubFrame, type SidebarEntry, type SidebarStyle } from "./hub-frame";
import { matchesSelectDown, matchesSelectUp } from "../keybinding-matchers";
import { formatKeyHint, formatKeyHints } from "../app-keybindings";
import { matchesKey } from "../keys";
import { theme } from "../theme/theme";
import { padding, replaceTabs, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../utils";
import type { Component } from "../tui";
import type { TUI } from "../tui";

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
	onDone: () => void;
	requestRender: () => void;
	/** TUI handle for terminal height and input focus; tests may omit it. */
	ui?: TUI;
	/** Focus the Hub on this PM on first load (a PM-root launch). */
	initialPmId?: string;
	/** Open Agent Hub (subagent control stays there); omitted in a standalone Hub. */
	openAgentHub?: () => void;
}

// ── Pure helpers (tested directly, no terminal) ─────────────────────────────

export type TeamHubEntryKind = "separator" | "label" | "room" | "task" | "pm" | "engineer";

export interface TeamHubSidebarEntry extends SidebarEntry<TeamHubEntryKind> {
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
		index === 0 ? `${head}${line}` : `${padding(visibleWidth(head))}${line}`,
	);
}

// ── Component ───────────────────────────────────────────────────────────────

type HubFocus = "roster" | "events" | "composer";

function filterInput(): Input {
	const input = new Input();
	input.prompt = "";
	return input;
}

export class TeamHubOverlayComponent implements Component {
	readonly #deps: TeamHubDeps;
	readonly #frame: HubFrame;
	readonly #filter = filterInput();
	#snapshot: TeamHubSnapshot | undefined;
	#entries: TeamHubSidebarEntry[] = [];
	#selectedId: string | undefined;
	#focus: HubFocus = "roster";
	#filterEditing = false;
	#loading = false;
	#error: string | undefined;
	#warning: string | undefined;
	#notice: string | undefined;
	#composer: Input | undefined;
	#composerRoom: string | undefined;
	#memberInput: Input | undefined;
	#memberMode: "add" | "remove" | undefined;
	#memberRoom: string | undefined;
	#senderIndex = 0;
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
		this.#frame = new HubFrame(
			"Team Hub",
			{ min: 28, max: 46 },
			(width, rows) => this.#renderSidebar(width, rows),
			(width, height) => this.#renderBody(width, height),
			{ bodyMinWidth: 30 },
		);
		void this.#reload();
	}

	/** Resolves after the latest database read settles (initial load or refresh). */
	get ready(): Promise<void> {
		return this.#lastLoad;
	}

	dispose(): void {
		this.#disposed = true;
		this.#generation++;
	}

	invalidate(): void {
		this.#frame.invalidate();
	}

	// ── data ────────────────────────────────────────────────────────────────

	#currentRoomName(): string | undefined {
		return this.#snapshot?.selectedRoom?.room.name;
	}

	#selectedEntry(): TeamHubSidebarEntry | undefined {
		return this.#entries.find(entry => entry.id === this.#selectedId);
	}

	#selectedRoom(): TeamHubRoomView | undefined {
		return this.#snapshot?.selectedRoom ?? undefined;
	}

	#reload(roomName?: string): Promise<void> {
		const promise = this.#load(roomName);
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
				room: roomName ?? this.#currentRoomName(),
				preferPmId: this.#focusedPmId ?? this.#deps.initialPmId,
			});
			if (this.#disposed || generation !== this.#generation) return;
			this.#snapshot = snapshot;
			this.#warning = snapshot.warning;
			this.#frame.setTitle(`Team Hub · ${snapshot.teamName}`);
			this.#initializeBaseline(snapshot);
			this.#markSelectedRoomSeen();
			this.#entries = buildTeamHubEntries(snapshot, this.#filter.getValue(), this.#baseline);
			this.#ensureSelection();
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
		const room = this.#selectedRoom()?.room;
		if (room && room.lastSeq !== null) this.#baseline.set(room.id, room.lastSeq);
	}

	#ensureSelection(): void {
		if (this.#selectedId && this.#entries.some(entry => entry.id === this.#selectedId)) return;
		const selectedRoom = this.#snapshot?.selectedRoom?.room;
		if (selectedRoom) {
			const id = `room:${selectedRoom.name}`;
			if (this.#entries.some(entry => entry.id === id)) {
				this.#selectedId = id;
				return;
			}
		}
		const first = this.#entries.find(entry => entry.kind !== "label" && entry.kind !== "separator");
		this.#selectedId = first?.id;
	}

	#select(id: string | undefined): void {
		if (!id || id === this.#selectedId) {
			this.#requestRender();
			return;
		}
		this.#selectedId = id;
		const entry = this.#selectedEntry();
		this.#eventScroll = 0;
		if (entry?.kind === "room") {
			this.#detailAgentId = undefined;
			this.#detailTaskId = undefined;
			if (entry.roomName && entry.roomName !== this.#currentRoomName()) {
				void this.#reload(entry.roomName);
			} else {
				this.#markSelectedRoomSeen();
			}
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

	#requestRender(): void {
		this.#deps.requestRender();
	}

	#terminalRows(): number {
		return this.#deps.ui?.terminal?.rows || process.stdout.rows || 40;
	}

	// ── input ───────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.#memberMode) {
			this.#handleMemberInput(data);
			return;
		}
		if (this.#filterEditing) {
			this.#handleFilterInput(data);
			return;
		}
		if (this.#composer) {
			this.#handleComposerInput(data);
			return;
		}

		if (matchesKey(data, "escape")) {
			if (this.#filter.getValue()) {
				this.#clearFilter();
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
			this.#deps.onDone();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.#focus = this.#focus === "roster" ? "events" : "roster";
			this.#requestRender();
			return;
		}
		if (matchesKey(data, "left") || data === "h") {
			this.#focus = "roster";
			this.#requestRender();
			return;
		}
		if (matchesKey(data, "right") || data === "l") {
			this.#focus = "events";
			this.#requestRender();
			return;
		}
		if (data === "j" || matchesSelectDown(data)) {
			if (this.#focus === "roster") {
				this.#select(moveTeamHubSelection(this.#entries, this.#selectedId, 1));
			} else {
				this.#scrollEvents(1);
			}
			return;
		}
		if (data === "k" || matchesSelectUp(data)) {
			if (this.#focus === "roster") {
				this.#select(moveTeamHubSelection(this.#entries, this.#selectedId, -1));
			} else {
				this.#scrollEvents(-1);
			}
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.#scrollEvents(5);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.#scrollEvents(-5);
			return;
		}
		if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
			const entry = this.#selectedEntry();
			if (entry?.kind === "room") {
				this.#focus = "events";
				this.#markSelectedRoomSeen();
				this.#entries = buildTeamHubEntries(this.#snapshot, this.#filter.getValue(), this.#baseline);
				this.#requestRender();
			} else if (entry?.kind === "engineer") {
				this.#focus = "events";
				this.#detailAgentId = entry.agentId;
				this.#requestRender();
			}
			return;
		}
		if (data === "g") {
			const room = this.#snapshot ? selectTeamHubRoom(this.#snapshot.rooms, "shared") : undefined;
			if (room) this.#select(`room:${room.name}`);
			else this.#setNotice("No shared coordination room exists in this team.");
			return;
		}
		if (data === "p") {
			const pmId = this.#focusedPmId ?? this.#selectedRoom()?.room.pmId ?? this.#snapshot?.pms[0]?.id;
			const room = this.#snapshot
				? nextTeamHubPmRoom(this.#snapshot.rooms, this.#selectedRoom()?.room.name, pmId)
				: undefined;
			if (room) this.#select(`room:${room.name}`);
			else this.#setNotice(pmId ? `PM "${pmId}" owns no room.` : "No PM rooms exist in this team.");
			return;
		}
		if (data === "s") {
			this.#openComposer();
			return;
		}
		if (data === "m" || data === "M") {
			this.#openMemberInput(data === "m" ? "add" : "remove");
			return;
		}
		if (data === "K") {
			this.#cycleRoomKind();
			return;
		}
		const task = this.#detailTask();
		if (task) {
			const action =
				data === "c"
					? "claim"
					: data === "n"
						? "renew"
						: data === "u"
							? "submit"
							: data === "x"
								? "complete"
								: data === "X"
									? "reject"
									: data === "C"
										? "cancel"
										: undefined;
			if (action) {
				void this.#taskAction(task, action);
				return;
			}
		}
		if (data === "a") {
			if (this.#deps.openAgentHub) this.#deps.openAgentHub();
			else this.#setNotice("Agent Hub is available inside a coding session; this Hub is standalone.");
			return;
		}
		if (data === "r") {
			this.#notice = undefined;
			void this.#reload(this.#currentRoomName());
			return;
		}
		if (data === "/") {
			this.#filterEditing = true;
			this.#requestRender();
			return;
		}
	}

	#setNotice(message: string): void {
		this.#notice = message;
		this.#requestRender();
	}

	#scrollEvents(delta: number): void {
		this.#eventScroll = Math.max(0, this.#eventScroll + delta);
		this.#requestRender();
	}

	// ── filter ──────────────────────────────────────────────────────────────

	#handleFilterInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.#clearFilter();
			return;
		}
		if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
			this.#filterEditing = false;
			this.#requestRender();
			return;
		}
		this.#filter.handleInput(data);
		this.#entries = buildTeamHubEntries(this.#snapshot, this.#filter.getValue(), this.#baseline);
		this.#ensureSelection();
		this.#requestRender();
	}

	#clearFilter(): void {
		this.#filter.setValue("");
		this.#filterEditing = false;
		this.#entries = buildTeamHubEntries(this.#snapshot, "", this.#baseline);
		this.#ensureSelection();
		this.#requestRender();
	}

	// ── composer ────────────────────────────────────────────────────────────

	#openMemberInput(mode: "add" | "remove"): void {
		const room = this.#selectedRoom();
		if (!room) {
			this.#setNotice("Select a room first, then press m/M.");
			return;
		}
		if (mode === "add" ? !this.#deps.source.addRoomMember : !this.#deps.source.removeRoomMember) {
			this.#setNotice("This Hub source cannot manage room members.");
			return;
		}
		const input = filterInput();
		input.prompt = mode === "add" ? "add member: " : "remove member: ";
		this.#memberInput = input;
		this.#memberMode = mode;
		this.#memberRoom = room.room.name;
		this.#requestRender();
	}

	#handleMemberInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.#memberInput = undefined;
			this.#memberMode = undefined;
			this.#memberRoom = undefined;
			this.#requestRender();
			return;
		}
		if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
			const member = this.#memberInput?.getValue().trim();
			const room = this.#memberRoom;
			const mode = this.#memberMode;
			if (!member || !room || !mode) return;
			this.#memberInput = undefined;
			this.#memberMode = undefined;
			this.#memberRoom = undefined;
			void (async () => {
				try {
					const result =
						mode === "add"
							? await this.#deps.source.addRoomMember?.({ room, member })
							: await this.#deps.source.removeRoomMember?.({ room, member });
					this.#notice = result?.message ?? (mode === "add" ? "Member added." : "Member removed.");
					await this.#reload(room);
				} catch (error) {
					this.#error = error instanceof Error ? error.message : String(error);
					this.#requestRender();
				}
			})();
			return;
		}
		this.#memberInput?.handleInput(data);
		this.#requestRender();
	}

	async #taskAction(
		task: TeamHubTask,
		action: "claim" | "renew" | "submit" | "complete" | "reject" | "cancel",
	): Promise<void> {
		const source = this.#deps.source.taskAction;
		if (!source) {
			this.#setNotice("This Hub source cannot run task actions.");
			return;
		}
		this.#notice = `${action} ${task.taskKey}…`;
		this.#requestRender();
		try {
			const result = await source({ task: task.taskKey, action });
			this.#notice = result.message;
			await this.#reload(this.#currentRoomName());
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
			this.#requestRender();
		}
	}

	#cycleRoomKind(): void {
		const source = this.#deps.source.setRoomKind;
		const room = this.#selectedRoom();
		if (!source || !room) {
			this.#setNotice("Select a room first, then press K.");
			return;
		}
		const order = ["room", "coordination", "pm"] as const;
		const next = order[(order.indexOf(room.room.kind) + 1) % order.length];
		if (next === "pm" && !room.room.pmId) {
			this.#setNotice("A pm room needs an owning PM; this room has none.");
			return;
		}
		void (async () => {
			try {
				const result = await source({ room: room.room.name, kind: next, pm: room.room.pmId ?? undefined });
				this.#notice = result.message;
				await this.#reload(room.room.name);
			} catch (error) {
				this.#error = error instanceof Error ? error.message : String(error);
				this.#requestRender();
			}
		})();
	}

	#openComposer(): void {
		if (this.#detailAgentId || this.#detailTaskId) {
			this.#setNotice("Select a room first, then press s to post.");
			return;
		}
		const room = this.#selectedRoom();
		if (!room) {
			this.#setNotice("Select a room first, then press s to post.");
			return;
		}
		if (room.members.length === 0) {
			this.#setNotice(`Room "#${room.room.name}" has no members; add a member before posting.`);
			return;
		}
		this.#notice = undefined;
		this.#composerRoom = room.room.name;
		const ownerIndex = room.room.pmId ? room.members.findIndex(member => member.agentId === room.room.pmId) : -1;
		const pmIndex = room.members.findIndex(member => member.role === "pm");
		this.#senderIndex = ownerIndex >= 0 ? ownerIndex : pmIndex >= 0 ? pmIndex : 0;
		const input = new Input();
		input.prompt = "> ";
		input.onSubmit = value => void this.#submit(value);
		this.#composer = input;
		this.#focus = "composer";
		this.#requestRender();
	}

	#closeComposer(): void {
		this.#composer = undefined;
		this.#composerRoom = undefined;
		this.#focus = "roster";
		this.#requestRender();
	}

	#handleComposerInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.#closeComposer();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const room = this.#selectedRoom();
			if (room && room.members.length > 0) {
				const delta = matchesKey(data, "shift+tab") ? -1 : 1;
				this.#senderIndex = (this.#senderIndex + delta + room.members.length) % room.members.length;
				this.#requestRender();
			}
			return;
		}
		this.#composer?.handleInput(data);
		this.#requestRender();
	}

	async #submit(value: string): Promise<void> {
		const body = value.trim();
		const room = this.#selectedRoom();
		if (!room) return;
		if (!body) {
			this.#setNotice("Message body must not be empty.");
			return;
		}
		const sender = room.members[this.#senderIndex];
		if (!sender) {
			this.#setNotice("Select a room member as the sender (Tab) before posting.");
			return;
		}
		const roomName = this.#composerRoom ?? room.room.name;
		try {
			const result = await this.#deps.source.post({ room: roomName, body, sender: sender.agentId });
			this.#notice = `Posted #${result.seq} to #${roomName} as ${sender.label}.`;
			this.#closeComposer();
			await this.#reload(roomName);
		} catch (error) {
			this.#setNotice(error instanceof Error ? error.message : String(error));
		}
	}

	// ── render ──────────────────────────────────────────────────────────────

	#renderSidebar(width: number, rows: number): string[] {
		return this.#frame.renderSidebar(
			this.#entries,
			width,
			rows,
			{
				id: this.#selectedId ?? "",
				focused: this.#focus === "roster",
				follow: true,
				clamp: false,
			},
			entry => this.#sidebarStyle(entry),
		);
	}

	#sidebarStyle(entry: TeamHubSidebarEntry): SidebarStyle {
		switch (entry.kind) {
			case "label":
				return { icon: "", annotation: "", muted: true };
			case "room":
				return { icon: "", annotation: entry.annotation ?? "" };
			case "task":
				return { icon: "◇", annotation: entry.annotation ?? "" };
			case "pm":
				return { icon: "◆", annotation: entry.annotation ?? "" };
			case "engineer":
				return { icon: "·", annotation: entry.annotation ?? "", muted: false };
			default:
				return { icon: "", annotation: "" };
		}
	}

	#renderBody(width: number, height: number | undefined): readonly string[] {
		const rows = Math.max(1, Math.floor(height ?? this.#terminalRows() - 4));
		const lines: string[] = [];
		const push = (line = ""): void => {
			lines.push(truncateToWidth(replaceTabs(line), width));
		};

		if (this.#error) push(theme.fg("error", this.#error));
		else if (this.#warning) push(theme.fg("warning", this.#warning));
		else if (this.#notice) push(theme.fg("warning", this.#notice));
		else if (this.#loading) push(theme.fg("dim", "Loading team data…"));
		else push();

		if (this.#filterEditing || this.#filter.getValue()) {
			const prefix = theme.fg("dim", "filter: ");
			const field = this.#filter.render(Math.max(1, width - visibleWidth(prefix)))[0] ?? "";
			push(`${prefix}${field}`);
		}

		const reserved = this.#composer ? 3 : this.#memberMode ? 2 : 0;
		const available = Math.max(1, rows - lines.length - reserved);
		const task = this.#detailTask();
		const agent = this.#detailAgent();
		if (task) {
			for (const line of this.#renderTask(task, width)) push(line);
		} else if (agent) {
			for (const line of this.#renderEngineer(agent, width)) push(line);
		} else if (this.#snapshot?.selectedRoom) {
			for (const line of this.#renderRoom(this.#snapshot.selectedRoom, width, available)) push(line);
		} else if (this.#snapshot && this.#snapshot.rooms.length === 0) {
			push(theme.fg("dim", "No rooms in this team yet."));
			push(theme.fg("dim", "Create one: zetacode team room create <name> --pm <pm>"));
		} else {
			push(theme.fg("dim", "No room selected."));
		}

		if (this.#memberMode) {
			const prompt = this.#memberMode === "add" ? "add member: " : "remove member: ";
			push("");
			push(
				`${theme.fg("dim", prompt)}${this.#memberInput?.render(Math.max(1, width - visibleWidth(prompt)))[0] ?? ""}`,
			);
		}
		if (this.#composer) {
			const room = this.#selectedRoom();
			const sender = room?.members[this.#senderIndex];
			push("");
			push(
				`${theme.fg("dim", "to ")}#${this.#composerRoom ?? ""}  ${theme.fg("dim", "from ")}${sender?.label ?? "—"}`,
			);
			push(this.#composer.render(width)[0] ?? "");
		}

		while (lines.length < rows) lines.push("");
		return lines.slice(0, rows);
	}

	#detailAgent(): TeamHubEngineer | undefined {
		if (!this.#detailAgentId) return undefined;
		return this.#snapshot?.engineers.find(engineer => engineer.id === this.#detailAgentId);
	}

	#detailTask(): TeamHubTask | undefined {
		if (!this.#detailTaskId) return undefined;
		return this.#snapshot?.tasks?.find(task => task.taskKey === this.#detailTaskId);
	}

	#renderTask(task: TeamHubTask, width: number): string[] {
		const lines: string[] = [];
		lines.push(`${theme.bold(theme.fg("accent", task.taskKey))}  ${theme.fg("dim", task.status)}`);
		lines.push(`${theme.bold("Task")} ${truncateToWidth(task.title, width)}`);
		lines.push(
			`${theme.fg("dim", "PM:")} ${task.assignedPmId}  ${theme.fg("dim", "assignee:")} ${task.assigneeAgentId ?? "—"}`,
		);
		lines.push(
			`${theme.fg("dim", "owner:")} ${task.ownerAgentId ?? "—"}  ${theme.fg("dim", "lease:")} ${
				task.leaseExpiresAt ? new Date(task.leaseExpiresAt * 1000).toISOString() : "—"
			}`,
		);
		lines.push(`${theme.fg("dim", "REQ:")} ${task.reqIds.length > 0 ? task.reqIds.join(", ") : "—"}`);
		lines.push(theme.fg("dim", "Claim with `zetacode team task claim`, submit for review, PM completes."));
		return lines;
	}

	#renderEngineer(engineer: TeamHubEngineer, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.bold(theme.fg("accent", engineer.name)));
		lines.push(
			`${theme.fg("dim", "PM:")} ${engineer.pmName}  ${theme.fg("dim", "execution:")} ${engineer.execution}`,
		);
		if (engineer.worktrees.length === 0) {
			lines.push(theme.fg("dim", "No registered worktree. Add one: zetacode team worktree add <task> …"));
			return lines;
		}
		for (const worktree of engineer.worktrees) {
			if (lines.length > 0) lines.push("");
			lines.push(`${theme.bold(worktree.kind)}  ${worktree.name}`);
			lines.push(theme.fg("dim", `branch ${worktree.branch}`));
			lines.push(truncateToWidth(worktree.path, width));
		}
		return lines;
	}

	#renderRoom(room: TeamHubRoomView, width: number, available: number): string[] {
		const lines: string[] = [];
		const title = `#${room.room.name}`;
		const kind = ROOM_KIND_LABEL[room.room.kind];
		const owner = room.room.kind === "pm" && room.room.pmName ? ` · PM ${room.room.pmName}` : "";
		const last = room.room.lastSeq === null ? "no events" : `last #${room.room.lastSeq}`;
		lines.push(
			`${theme.bold(theme.fg("accent", title))}  ${theme.fg("dim", `${kind}${owner} · ${room.room.memberCount} members · ${last}`)}`,
		);
		const members = room.members.length > 0 ? room.members.map(member => member.label).join(", ") : "no members";
		lines.push(theme.fg("dim", `members: ${members}`));
		lines.push("");

		const filtered = filterTeamHubEvents(orderTeamHubEvents(room.events), this.#filter.getValue());
		if (filtered.length === 0) {
			lines.push(theme.fg("dim", room.events.length === 0 ? "No events yet." : "No events match the filter."));
			return lines;
		}
		const eventLines = filtered.flatMap(event => this.#renderEvent(event, width));
		const headerRows = lines.length;
		const bodyRows = Math.max(1, available - headerRows);
		const maxStart = Math.max(0, eventLines.length - bodyRows);
		const start = Math.max(0, maxStart - this.#eventScroll);
		lines.push(...eventLines.slice(start, start + bodyRows));
		return lines;
	}

	#renderEvent(event: TeamHubEvent, width: number): string[] {
		const parts = describeTeamHubEvent(event);
		const head = `${theme.fg("dim", parts.time)}  ${theme.bold(theme.fg("accent", parts.sender))}${
			parts.reply ? ` ${theme.fg("dim", parts.reply)}` : ""
		}  `;
		const bodyWidth = Math.max(8, width - visibleWidth(head));
		const body = wrapTextWithAnsi(parts.body || "(empty)", bodyWidth);
		return body.map((line, index) => (index === 0 ? `${head}${line}` : `${padding(visibleWidth(head))}${line}`));
	}

	#renderFooter(width: number): string {
		const filter = this.#filter.getValue() ? `/${this.#filter.getValue()}  ·  ` : "";
		const hint =
			`${filter}${formatKeyHints(["j", "k"])}:select  ${formatKeyHint("enter")}:open  ${formatKeyHint("tab")}:pane  ` +
			`${formatKeyHint("g")}:shared  ${formatKeyHint("p")}:PM  ${formatKeyHint("s")}:send  ` +
			`${formatKeyHint("a")}:Agent Hub  ${formatKeyHint("r")}:refresh  /:filter  ${formatKeyHint("escape")}:back`;
		return theme.fg("dim", truncateToWidth(hint, Math.max(10, width)));
	}

	render(width: number): readonly string[] {
		const termHeight = this.#terminalRows();
		const frame = this.#frame.render(width, termHeight, this.#entries, this.#renderFooter(width - 4));
		const lines = frame.map(line => truncateToWidth(line, width));
		if (lines.length <= termHeight) return lines;
		// Tiny terminals can fall below the fixed chrome floor; keep the title and
		// the footer instead of spilling into scrollback.
		const footerLines = Math.min(3, lines.length);
		return [...lines.slice(0, Math.max(0, termHeight - footerLines)), ...lines.slice(-footerLines)].slice(
			0,
			Math.max(1, termHeight),
		);
	}
}
