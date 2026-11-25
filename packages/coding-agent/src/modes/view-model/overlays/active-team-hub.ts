/**
 * Active Team hub view model: the live Team's rooms, the main and worker
 * roster, the selected room timeline and the composer's draft state.
 *
 * Host projections only. This module knows neither sessions nor coding-agent
 * services; rendering and key decoding live in the host UI.
 */
import { sanitizeText } from "@linxiraos/pi-utils";

/** Host projections only. This module knows neither sessions nor coding-agent services. */
export interface ActiveTeamAgentRow {
	readonly id: string;
	readonly label: string;
	readonly kind: "main" | "worker";
	readonly status: "running" | "idle" | "parked" | "aborted" | "offline";
	readonly createdAt?: number;
	readonly lastActivityAt?: number;
	readonly activity?: string;
	readonly role?: string;
	readonly generation?: number;
	readonly lifecycle?: "resident" | "ephemeral";
	readonly cli?: "fast" | "good";
	readonly model?: string;
	readonly assignment?: string;
	readonly queued?: number;
	/** Registry generation, used by the host to reject a recycled id on focus. */
	readonly registryGeneration?: number;
	readonly canObserve: boolean;
}

export interface ActiveTeamEventRow {
	readonly seq: number;
	readonly sentAt: string;
	readonly senderId: string;
	readonly senderName: string;
	readonly body: string;
}

export interface ActiveTeamRoomRow {
	readonly id: string;
	readonly room: "team" | "mains";
	readonly name: string;
	readonly members: readonly { readonly agentId: string; readonly label: string }[];
	readonly events: readonly ActiveTeamEventRow[];
	readonly lastSeq: number;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface ActiveTeamHubSnapshot {
	readonly teamKey: string;
	readonly label: string;
	readonly ownerId: string;
	readonly agents: readonly ActiveTeamAgentRow[];
	readonly rooms: readonly ActiveTeamRoomRow[];
	readonly warning?: string;
}

export interface ActiveTeamHubSource {
	load(): Promise<ActiveTeamHubSnapshot>;
	/** Posts only as the owner captured by this source; the UI cannot impersonate workers. */
	post(body: string, room: "team" | "mains"): Promise<{ readonly seq: number }>;
	subscribe?(listener: () => void): () => void;
}

/** Host hooks of the hub; every one is optional so a headless caller can ignore it. */
export interface ActiveTeamHubDeps {
	readonly source: ActiveTeamHubSource;
	/** Called when the view should close (Escape on the root). */
	readonly onDone?: () => void;
	/** Called after state changes; a reactive host re-renders from its own effect instead. */
	readonly requestRender?: () => void;
	/** Resolves when the observer returns. Host keeps this same Hub mounted and hidden. */
	readonly observeAgent?: (agent: ActiveTeamAgentRow) => Promise<void>;
	readonly refreshMs?: number;
}

export type ActiveTeamEntryKind = "label" | "room" | "main" | "worker";

export interface ActiveTeamHubEntry {
	readonly id: string;
	readonly kind: ActiveTeamEntryKind;
	readonly label: string;
	readonly annotation?: string;
	readonly agentId?: string;
	readonly room?: "team" | "mains";
}

/** The sidebar rows of `snapshot`: rooms first, then the agents matching `query`. */
export function activeTeamEntries(snapshot: ActiveTeamHubSnapshot, query = ""): ActiveTeamHubEntry[] {
	const filter = query.trim().toLowerCase();
	const matches = (text: string) => !filter || text.toLowerCase().includes(filter);
	const rows: ActiveTeamHubEntry[] = [];
	// Rooms remain reachable while filtering workers: the conversation is a persistent pane.
	rows.push({ id: "rooms", kind: "label", label: "ROOMS" });
	for (const room of snapshot.rooms) {
		rows.push({
			id: `room:${room.room}`,
			kind: "room",
			label: `#${sanitizeText(room.name).replace(/\s+/g, " ")}`,
			room: room.room,
			annotation: `${room.members.length} members · #${room.lastSeq}`,
		});
	}
	const agents = snapshot.agents.filter(agent =>
		matches(`${agent.id} ${agent.label} ${agent.role ?? ""} ${agent.activity ?? ""} ${agent.status}`),
	);
	if (agents.length) rows.push({ id: "agents", kind: "label", label: "MAIN & WORKERS" });
	for (const agent of agents) {
		rows.push({
			id: `agent:${agent.id}`,
			kind: agent.kind,
			label: sanitizeText(agent.label).replace(/\s+/g, " "),
			agentId: agent.id,
			annotation: sanitizeText(
				[agent.status, agent.role, agent.generation === undefined ? undefined : `g${agent.generation}`, agent.cli]
					.filter(Boolean)
					.join(" · "),
			).replace(/\s+/g, " "),
		});
	}
	return rows;
}

/** The selectable row `delta` away from `selected`, wrapping around the section labels. */
export function moveActiveTeamSelection(
	entries: readonly ActiveTeamHubEntry[],
	selected: string | undefined,
	delta: number,
): string | undefined {
	const choices = entries.filter(row => row.kind !== "label");
	if (!choices.length) return undefined;
	const index = choices.findIndex(row => row.id === selected);
	return choices[((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta + choices.length) % choices.length]?.id;
}

/** What activating the selected row does. */
export type ActiveTeamActivation =
	| { readonly kind: "none" }
	| { readonly kind: "room"; readonly room: "team" | "mains" }
	| { readonly kind: "observe"; readonly agent: ActiveTeamAgentRow }
	| { readonly kind: "unobservable"; readonly agent: ActiveTeamAgentRow };

/** Selection, filtering, room timeline, composer and refresh state of the Active Team hub. */
export class ActiveTeamHubModel {
	readonly #deps: ActiveTeamHubDeps;
	#snapshot: ActiveTeamHubSnapshot | undefined;
	#entries: ActiveTeamHubEntry[] = [];
	#selected = "room:team";
	#room: "team" | "mains" = "team";
	#query = "";
	#bodyFocused = false;
	#scroll = 0;
	#drafts = new Map<string, string>();
	#composerOpen = false;
	#error: string | undefined;
	#loading = false;
	#reloadAgain = false;
	#disposed = false;
	#observing = false;
	#posting = false;
	#timer: NodeJS.Timeout | undefined;
	#unsubscribe: (() => void) | undefined;
	#ready: Promise<void> = Promise.resolve();

	constructor(deps: ActiveTeamHubDeps) {
		this.#deps = deps;
		this.#unsubscribe = deps.source.subscribe?.(() => {
			void this.refresh();
		});
		this.#timer = setInterval(() => {
			void this.refresh();
		}, deps.refreshMs ?? 1000);
		this.#timer.unref?.();
		void this.refresh();
	}

	/** Resolves after the latest database read settles. */
	get ready(): Promise<void> {
		return this.#ready;
	}
	get snapshot(): ActiveTeamHubSnapshot | undefined {
		return this.#snapshot;
	}
	get entries(): readonly ActiveTeamHubEntry[] {
		return this.#entries;
	}
	get selectedId(): string {
		return this.#selected;
	}
	get room(): "team" | "mains" {
		return this.#room;
	}
	get query(): string {
		return this.#query;
	}
	get bodyFocused(): boolean {
		return this.#bodyFocused;
	}
	get scroll(): number {
		return this.#scroll;
	}
	get loading(): boolean {
		return this.#loading;
	}
	get error(): string | undefined {
		return this.#error;
	}
	get observing(): boolean {
		return this.#observing;
	}
	get posting(): boolean {
		return this.#posting;
	}
	/** Whether the composer is open for the current room. */
	get composerOpen(): boolean {
		return this.#composerOpen;
	}
	/** The selected room's timeline. */
	get timeline(): ActiveTeamRoomRow | undefined {
		const entry = this.#entries.find(row => row.id === this.#selected);
		return this.#snapshot?.rooms.find(row => row.room === (entry?.room ?? this.#room));
	}
	/** The agent the selection names, with its projection. */
	get selectedAgent(): ActiveTeamAgentRow | undefined {
		const entry = this.#entries.find(row => row.id === this.#selected);
		return entry?.agentId ? this.#snapshot?.agents.find(row => row.id === entry.agentId) : undefined;
	}
	/** The draft of the open composer for `room`. */
	draft(room: "team" | "mains" = this.#room): string {
		return this.#drafts.get(room) ?? "";
	}

	dispose(): void {
		this.#disposed = true;
		clearInterval(this.#timer);
		this.#unsubscribe?.();
	}

	/** Reload the Team projection (coalesced while a read is in flight). */
	refresh(): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		if (this.#loading) {
			this.#reloadAgain = true;
			return this.#ready;
		}
		this.#loading = true;
		this.#ready = (async () => {
			do {
				this.#reloadAgain = false;
				try {
					const snapshot = await this.#deps.source.load();
					if (this.#disposed) return;
					this.#snapshot = snapshot;
					this.#error = undefined;
					this.#rebuild();
				} catch (error) {
					this.#error = error instanceof Error ? error.message : String(error);
				}
			} while (this.#reloadAgain && !this.#disposed);
		})().finally(() => {
			this.#loading = false;
			this.#requestRender();
		});
		return this.#ready;
	}

	/** Set the agent filter; rooms always stay listed. */
	setQuery(query: string): void {
		this.#query = query;
		this.#rebuild();
		this.#requestRender();
	}

	/** Move the selection, or scroll the timeline while the body pane is focused. */
	moveSelection(delta: number): void {
		if (this.#bodyFocused) {
			this.#scroll = Math.max(0, this.#scroll - delta);
		} else {
			this.#selected = moveActiveTeamSelection(this.#entries, this.#selected, delta) ?? "";
		}
		this.#requestRender();
	}

	scrollBy(delta: number): void {
		this.#scroll = Math.max(0, this.#scroll + delta);
		this.#requestRender();
	}

	togglePane(): void {
		this.#bodyFocused = !this.#bodyFocused;
		this.#requestRender();
	}

	/** Show `room`'s timeline at the top. */
	showRoom(room: "team" | "mains"): void {
		this.#room = room;
		this.#selected = `room:${room}`;
		this.#scroll = 0;
		this.#requestRender();
	}

	/**
	 * What Enter on the selection means: an observable agent is observed by the
	 * host, a room row focuses its timeline, others do nothing.
	 */
	activation(): ActiveTeamActivation {
		const entry = this.#entries.find(row => row.id === this.#selected);
		if (entry?.agentId) {
			const agent = this.#snapshot?.agents.find(row => row.id === entry.agentId);
			if (!agent) return { kind: "none" };
			return agent.canObserve && this.#deps.observeAgent
				? { kind: "observe", agent }
				: { kind: "unobservable", agent };
		}
		if (entry?.room) return { kind: "room", room: entry.room };
		return { kind: "none" };
	}

	/** Act on the selection: observe an agent, or focus a room's timeline. */
	async activate(): Promise<void> {
		const activation = this.activation();
		switch (activation.kind) {
			case "observe":
				await this.observe(activation.agent);
				return;
			case "unobservable":
				this.#error = "This agent has no observable session.";
				this.#requestRender();
				return;
			case "room":
				this.#room = activation.room;
				this.#scroll = 0;
				this.#bodyFocused = true;
				this.#requestRender();
				return;
			default:
				return;
		}
	}

	/** Open the composer with the draft remembered for the current room. */
	beginCompose(): boolean {
		if (!this.#snapshot?.rooms.some(row => row.room === this.#room)) return false;
		this.#composerOpen = true;
		this.#requestRender();
		return true;
	}

	/** Remember `value` as the current room's draft. */
	setDraft(value: string): void {
		this.#drafts.set(this.#room, value);
	}

	/** Close the composer, keeping its draft. */
	cancelCompose(): void {
		this.#composerOpen = false;
		this.#requestRender();
	}

	/** Post `value` to the current room as the captured owner; clears the draft on success. */
	async post(value: string): Promise<boolean> {
		const body = value.trim();
		if (!body || this.#posting) return false;
		this.#posting = true;
		try {
			await this.#deps.source.post(body, this.#room);
			this.#drafts.delete(this.#room);
			this.#composerOpen = false;
			this.#selected = `room:${this.#room}`;
			this.#scroll = 0;
			await this.refresh();
			return true;
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
			return false;
		} finally {
			this.#posting = false;
			this.#requestRender();
		}
	}

	/** Escape: leave the body pane, clear the filter, else close the view. */
	cancel(): void {
		if (this.#bodyFocused) this.#bodyFocused = false;
		else if (this.#query) {
			this.#query = "";
			this.#rebuild();
		} else {
			this.#deps.onDone?.();
			return;
		}
		this.#requestRender();
	}

	async observe(agent: ActiveTeamAgentRow): Promise<void> {
		if (!this.#deps.observeAgent) return;
		this.#observing = true;
		try {
			await this.#deps.observeAgent(agent);
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#observing = false;
			await this.refresh();
		}
	}

	#rebuild(): void {
		this.#entries = this.#snapshot ? activeTeamEntries(this.#snapshot, this.#query) : [];
		if (!this.#entries.some(row => row.id === this.#selected)) {
			this.#selected =
				this.#entries.find(row => row.kind === "room")?.id ??
				this.#entries.find(row => row.kind !== "label")?.id ??
				"";
		}
	}

	#requestRender(): void {
		if (!this.#disposed) this.#deps.requestRender?.();
	}
}
