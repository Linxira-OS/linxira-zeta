import { sanitizeText } from "@linxiraos/pi-utils";
import { Input } from "../components/input";
import { matchesSelectDown, matchesSelectUp } from "../keybinding-matchers";
import { matchesKey } from "../keys";
import { theme } from "../theme/theme";
import type { Component, TUI } from "../tui";
import { padding, replaceTabs, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../utils";
import { HubFrame, type SidebarEntry } from "./hub-frame";

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

export interface ActiveTeamHubDeps {
	readonly source: ActiveTeamHubSource;
	readonly onDone: () => void;
	readonly requestRender: () => void;
	readonly ui?: TUI;
	/** Resolves when the observer returns. Host keeps this same Hub mounted and hidden. */
	readonly observeAgent?: (agent: ActiveTeamAgentRow) => Promise<void>;
	readonly refreshMs?: number;
}

export interface ActiveTeamHubEntry extends SidebarEntry<"label" | "room" | "main" | "worker"> {
	readonly agentId?: string;
	readonly room?: "team" | "mains";
}

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

/** Persistent split Hub, reusing the shared HubFrame and legacy room timeline layout. */
export class ActiveTeamHubOverlayComponent implements Component {
	readonly #deps: ActiveTeamHubDeps;
	readonly #frame: HubFrame;
	readonly #filter = new Input();
	#snapshot?: ActiveTeamHubSnapshot;
	#entries: ActiveTeamHubEntry[] = [];
	#selected = "room:team";
	#room: "team" | "mains" = "team";
	#filterEditing = false;
	#bodyFocused = false;
	#scroll = 0;
	#composer?: Input;
	#drafts = new Map<string, string>();
	#error?: string;
	#loading = false;
	#reloadAgain = false;
	#disposed = false;
	#observing = false;
	#posting = false;
	#timer?: NodeJS.Timeout;
	#unsubscribe?: () => void;
	#ready: Promise<void> = Promise.resolve();

	constructor(deps: ActiveTeamHubDeps) {
		this.#deps = deps;
		this.#filter.prompt = "";
		this.#frame = new HubFrame(
			"Team Hub",
			{ min: 30, max: 48 },
			(width, rows) =>
				this.#frame.renderSidebar(
					this.#entries,
					width,
					rows,
					{ id: this.#selected, focused: !this.#bodyFocused, follow: true, clamp: false },
					entry => ({
						icon: entry.kind === "worker" ? "·" : entry.kind === "main" ? "◆" : "",
						annotation: entry.annotation ?? "",
						muted: entry.kind === "label",
					}),
				),
			(width, height) => this.#body(width, height ?? this.#height() - 4),
			{ bodyMinWidth: 30 },
		);
		this.#unsubscribe = deps.source.subscribe?.(() => {
			void this.refresh();
		});
		this.#timer = setInterval(() => {
			void this.refresh();
		}, deps.refreshMs ?? 1000);
		this.#timer.unref?.();
		void this.refresh();
	}

	get ready(): Promise<void> {
		return this.#ready;
	}
	get selectedId(): string {
		return this.#selected;
	}
	get searchQuery(): string {
		return this.#filter.getValue();
	}

	dispose(): void {
		this.#disposed = true;
		clearInterval(this.#timer);
		this.#unsubscribe?.();
	}
	invalidate(): void {
		this.#frame.invalidate();
	}
	#render(): void {
		if (!this.#disposed) this.#deps.requestRender();
	}
	#height(): number {
		return this.#deps.ui?.terminal?.rows || process.stdout.rows || 40;
	}
	#rebuild(): void {
		this.#entries = this.#snapshot ? activeTeamEntries(this.#snapshot, this.#filter.getValue()) : [];
		if (!this.#entries.some(row => row.id === this.#selected)) {
			this.#selected =
				this.#entries.find(row => row.kind === "room")?.id ??
				this.#entries.find(row => row.kind !== "label")?.id ??
				"";
		}
	}

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
					this.#frame.setTitle(`Team Hub · ${sanitizeText(snapshot.label).replace(/\s+/g, " ")}`);
					this.#rebuild();
				} catch (error) {
					this.#error = error instanceof Error ? error.message : String(error);
				}
			} while (this.#reloadAgain && !this.#disposed);
		})().finally(() => {
			this.#loading = false;
			this.#render();
		});
		return this.#ready;
	}

	handleInput(data: string): void {
		if (this.#disposed || this.#observing || this.#posting) return;
		if (this.#composer) {
			if (matchesKey(data, "escape")) {
				this.#drafts.set(this.#room, this.#composer.getValue());
				this.#composer = undefined;
			} else {
				this.#composer.handleInput(data);
				if (this.#composer) this.#drafts.set(this.#room, this.#composer.getValue());
			}
			this.#render();
			return;
		}
		if (this.#filterEditing) {
			if (matchesKey(data, "enter")) this.#filterEditing = false;
			else if (matchesKey(data, "escape")) {
				this.#filterEditing = false;
				this.#filter.setValue("");
			} else this.#filter.handleInput(data);
			this.#rebuild();
			this.#render();
			return;
		}
		if (matchesKey(data, "escape")) {
			if (this.#bodyFocused) this.#bodyFocused = false;
			else if (this.#filter.getValue()) {
				this.#filter.setValue("");
				this.#rebuild();
			} else this.#deps.onDone();
		} else if (data === "/") this.#filterEditing = true;
		else if (matchesKey(data, "tab")) this.#bodyFocused = !this.#bodyFocused;
		else if (data === "r") void this.refresh();
		else if (data === "g" || data === "m") {
			this.#room = data === "g" ? "team" : "mains";
			this.#selected = `room:${this.#room}`;
			this.#scroll = 0;
		} else if (data === "s") this.#compose();
		else if (data === "j" || matchesSelectDown(data) || data === "k" || matchesSelectUp(data)) {
			const delta = data === "j" || matchesSelectDown(data) ? 1 : -1;
			if (this.#bodyFocused) this.#scroll = Math.max(0, this.#scroll - delta);
			else {
				this.#selected = moveActiveTeamSelection(this.#entries, this.#selected, delta) ?? "";
			}
		} else if (matchesKey(data, "enter")) {
			const entry = this.#entries.find(row => row.id === this.#selected);
			if (entry?.agentId) {
				const agent = this.#snapshot?.agents.find(row => row.id === entry.agentId);
				if (agent?.canObserve && this.#deps.observeAgent) void this.#observe(agent);
				else this.#error = "This agent has no observable session.";
			} else {
				if (entry?.room) {
					this.#room = entry.room;
					this.#scroll = 0;
				}
				this.#bodyFocused = true;
			}
		} else if (matchesKey(data, "pageUp")) this.#scroll += 5;
		else if (matchesKey(data, "pageDown")) this.#scroll = Math.max(0, this.#scroll - 5);
		this.#render();
	}

	async #observe(agent: ActiveTeamAgentRow): Promise<void> {
		this.#observing = true;
		try {
			await this.#deps.observeAgent!(agent);
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#observing = false;
			await this.refresh();
		}
	}
	#compose(): void {
		if (!this.#snapshot?.rooms.some(row => row.room === this.#room)) return;
		const input = new Input();
		input.prompt = "> ";
		input.setValue(this.#drafts.get(this.#room) ?? "");
		input.onSubmit = body => {
			void this.#post(body);
		};
		this.#composer = input;
	}
	async #post(value: string): Promise<void> {
		const body = value.trim();
		if (!body || this.#posting) return;
		this.#posting = true;
		try {
			await this.#deps.source.post(body, this.#room);
			this.#drafts.delete(this.#room);
			this.#composer = undefined;
			this.#selected = `room:${this.#room}`;
			this.#scroll = 0;
			await this.refresh();
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#posting = false;
			this.#render();
		}
	}
	#body(width: number, height: number): string[] {
		const lines: string[] = [];
		if (this.#error || this.#snapshot?.warning)
			lines.push(theme.fg("warning", sanitizeText(this.#error ?? this.#snapshot!.warning!)));
		if (this.#filterEditing || this.#filter.getValue())
			lines.push(`filter: ${this.#filter.render(Math.max(1, width - 8))[0] ?? ""}`);
		const entry = this.#entries.find(row => row.id === this.#selected);
		const agent = entry?.agentId ? this.#snapshot?.agents.find(row => row.id === entry.agentId) : undefined;
		if (agent) {
			lines.push(
				theme.bold(sanitizeText(agent.label)),
				`${agent.kind} · ${agent.status} · ${sanitizeText(agent.role ?? "main")}${agent.generation === undefined ? "" : ` · generation ${agent.generation}`}`,
			);
			lines.push(
				`activity ${sanitizeText(agent.activity ?? "—")}`,
				`created ${agent.createdAt === undefined ? "unknown" : new Date(agent.createdAt).toISOString()}`,
			);
			if (agent.assignment) lines.push(`assignment ${sanitizeText(agent.assignment)}`);
			if (agent.lifecycle)
				lines.push(`${agent.lifecycle} · ${agent.cli ?? ""} · ${sanitizeText(agent.model ?? "model unknown")}`);
			if (agent.queued) lines.push(`${agent.queued} queued`);
			lines.push(
				agent.canObserve
					? "Enter: observe session; return restores this Hub."
					: "No live or retained session to observe.",
			);
			lines.push("");
		}
		// Worker details never replace the room timeline: it remains visible beneath them.
		const room = this.#snapshot?.rooms.find(row => row.room === (entry?.room ?? this.#room));
		if (room) {
			// Keep the latest room event visible even when a short terminal clips worker detail rows.
			lines.length = Math.min(lines.length, Math.max(0, height - (this.#composer ? 5 : 3)));
			lines.push(theme.bold(`#${sanitizeText(room.name)} · ${room.members.length} members · #${room.lastSeq}`));
			lines.push(theme.fg("dim", room.members.map(row => sanitizeText(row.label)).join(", ")));
			const events = [...room.events]
				.sort((a, b) => a.seq - b.seq)
				.flatMap(event => {
					const prefix = `${event.sentAt.slice(11, 16)} ${sanitizeText(event.senderName).replace(/\s+/g, " ")}  `;
					return wrapTextWithAnsi(
						replaceTabs(sanitizeText(event.body)),
						Math.max(8, width - visibleWidth(prefix)),
					).map((line, index) => `${index ? padding(visibleWidth(prefix)) : prefix}${line}`);
				});
			const available = Math.max(1, height - lines.length - (this.#composer ? 2 : 0));
			const end = Math.max(0, events.length - this.#scroll);
			lines.push(...events.slice(Math.max(0, end - available), end));
			if (!events.length) lines.push(theme.fg("dim", "No messages yet."));
		} else lines.push(this.#loading ? "Loading Team…" : "No active Team room. Enter /team first.");
		if (this.#composer)
			lines.push(
				`Posting as ${this.#snapshot?.ownerId ?? "main"} to #${this.#room}`,
				this.#composer.render(width)[0] ?? "",
			);
		return lines.map(line => truncateToWidth(replaceTabs(line), width)).slice(0, Math.max(1, height));
	}
	render(width: number): readonly string[] {
		return this.#frame
			.render(
				width,
				this.#height(),
				this.#entries,
				theme.fg(
					"dim",
					"j/k:select  Enter:observe  Tab:pane  g:team  m:mains  s:send  /:filter  r:refresh  Esc:back",
				),
			)
			.slice(0, this.#height());
	}
}
