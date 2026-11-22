import { sanitizeText } from "@linxiraos/pi-utils";
import { matchesSelectDown, matchesSelectUp } from "../keybinding-matchers";
import { matchesKey } from "../keys";
import { theme } from "../theme/theme";
import type { Component, TUI } from "../tui";
import { truncateToWidth, visibleWidth } from "../utils";
import { HubFrame, type SidebarEntry } from "./hub-frame";

export interface TeamWorkspaceTeamRow {
	readonly id: string;
	readonly name: string;
	readonly rootPath: string;
}

export interface TeamWorkspacePersonaRow {
	readonly id: string;
	readonly name: string;
	readonly role: string;
	readonly revision: number;
}

export interface TeamWorkspacePersonRow {
	readonly id: string;
	readonly name: string;
	readonly role: string;
	readonly detail?: string;
}

export interface TeamWorkspaceRoomRow {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly memberCount: number;
	readonly lastSeq: number;
}

export interface TeamWorkspacePlanRow {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly revision: number;
	readonly itemCount: number;
}

export interface TeamWorkspaceSnapshot {
	readonly teams: readonly TeamWorkspaceTeamRow[];
	readonly activeTeamId?: string;
	readonly team?: TeamWorkspaceTeamRow;
	readonly defaultPersonaId?: string;
	readonly personas: readonly TeamWorkspacePersonaRow[];
	readonly pms: readonly TeamWorkspacePersonRow[];
	readonly engineers: readonly TeamWorkspacePersonRow[];
	readonly rooms: readonly TeamWorkspaceRoomRow[];
	readonly plans: readonly TeamWorkspacePlanRow[];
	readonly taskCount: number;
	readonly memoryKeys: readonly string[];
	readonly warning?: string;
}

export interface TeamWorkspaceSource {
	/** Load the team list and, when `teamId` is set, that team's detail. */
	load(teamId?: string): Promise<TeamWorkspaceSnapshot>;
}

export interface TeamWorkspaceDeps {
	readonly source: TeamWorkspaceSource;
	readonly onDone: () => void;
	readonly requestRender: () => void;
	readonly ui?: TUI;
}

type EntryKind = "label" | "team" | "persona" | "person" | "room" | "plan" | "memory";

interface Entry extends SidebarEntry<EntryKind> {
	readonly teamId?: string;
	readonly detail?: string;
}

function entriesFor(snapshot: TeamWorkspaceSnapshot): Entry[] {
	const rows: Entry[] = [{ id: "teams", kind: "label", label: "TEAMS" }];
	for (const team of snapshot.teams) {
		rows.push({
			id: `team:${team.id}`,
			kind: "team",
			label: sanitizeText(team.name),
			annotation: team.id === snapshot.team?.id ? "open" : "",
			teamId: team.id,
		});
	}
	if (!snapshot.team) return rows;
	rows.push({ id: "personas", kind: "label", label: "PERSONAS" });
	for (const persona of snapshot.personas) {
		rows.push({
			id: `persona:${persona.id}`,
			kind: "persona",
			label: sanitizeText(persona.name),
			annotation: `${persona.role} · r${persona.revision}`,
		});
	}
	rows.push({ id: "pms", kind: "label", label: "PMS" });
	for (const pm of snapshot.pms) {
		rows.push({ id: `pm:${pm.id}`, kind: "person", label: sanitizeText(pm.name), annotation: pm.role });
	}
	rows.push({ id: "engineers", kind: "label", label: "ENGINEERS" });
	for (const engineer of snapshot.engineers) {
		rows.push({
			id: `engineer:${engineer.id}`,
			kind: "person",
			label: sanitizeText(engineer.name),
			annotation: engineer.detail ?? engineer.role,
		});
	}
	rows.push({ id: "rooms", kind: "label", label: "ROOMS" });
	for (const room of snapshot.rooms) {
		rows.push({
			id: `room:${room.id}`,
			kind: "room",
			label: `#${sanitizeText(room.name)}`,
			annotation: `${room.memberCount} members · #${room.lastSeq}`,
		});
	}
	rows.push({ id: "plans", kind: "label", label: "TEAMPLANS" });
	for (const plan of snapshot.plans) {
		rows.push({
			id: `plan:${plan.id}`,
			kind: "plan",
			label: sanitizeText(plan.title),
			annotation: `${plan.status} · ${plan.itemCount} items · r${plan.revision}`,
		});
	}
	rows.push({ id: "memory", kind: "label", label: "MEMORY" });
	for (const key of snapshot.memoryKeys) {
		rows.push({ id: `memory:${key}`, kind: "memory", label: sanitizeText(key), annotation: "scope" });
	}
	return rows;
}

function move(entries: readonly Entry[], selected: string | undefined, delta: number): string | undefined {
	const choices = entries.filter(entry => entry.kind !== "label");
	if (choices.length === 0) return undefined;
	const index = choices.findIndex(entry => entry.id === selected);
	return choices[((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta + choices.length) % choices.length]?.id;
}

/** Fullscreen Team workspace: every registered Team, its contacts, rooms and plans. */
export class TeamWorkspaceOverlayComponent implements Component {
	readonly #deps: TeamWorkspaceDeps;
	readonly #frame: HubFrame;
	#snapshot?: TeamWorkspaceSnapshot;
	#entries: Entry[] = [];
	#selected = "teams";
	#loading = false;
	#error?: string;
	#disposed = false;

	constructor(deps: TeamWorkspaceDeps) {
		this.#deps = deps;
		this.#frame = new HubFrame(
			"Team",
			{ min: 28, max: 46 },
			(width, rows) =>
				this.#frame.renderSidebar(
					this.#entries,
					width,
					rows,
					{ id: this.#selected, focused: true, follow: true, clamp: false },
					entry => ({
						icon: entry.kind === "team" ? "◆" : entry.kind === "label" ? "" : "·",
						annotation: entry.annotation ?? "",
						muted: entry.kind === "label",
					}),
				),
			(width, height) => this.#body(width, height ?? this.#height() - 4),
			{ bodyMinWidth: 30 },
		);
		void this.refresh();
	}

	get ready(): Promise<void> {
		return Promise.resolve();
	}
	get selectedId(): string {
		return this.#selected;
	}
	get snapshot(): TeamWorkspaceSnapshot | undefined {
		return this.#snapshot;
	}

	dispose(): void {
		this.#disposed = true;
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
		this.#entries = this.#snapshot ? entriesFor(this.#snapshot) : [];
		if (!this.#entries.some(entry => entry.id === this.#selected)) {
			this.#selected = this.#entries.find(entry => entry.kind !== "label")?.id ?? "";
		}
	}

	async refresh(teamId?: string): Promise<void> {
		if (this.#disposed || this.#loading) return;
		this.#loading = true;
		try {
			const snapshot = await this.#deps.source.load(teamId ?? this.#snapshot?.team?.id);
			if (this.#disposed) return;
			this.#snapshot = snapshot;
			this.#error = undefined;
			this.#frame.setTitle(`Team · ${snapshot.teams.length} teams`);
			this.#rebuild();
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#loading = false;
			this.#render();
		}
	}

	handleInput(data: string): void {
		if (this.#disposed) return;
		if (matchesKey(data, "escape")) {
			if (this.#snapshot?.team && this.#selected !== `team:${this.#snapshot.team.id}`) {
				this.#selected = `team:${this.#snapshot.team.id}`;
			} else this.#deps.onDone();
		} else if (data === "r") void this.refresh();
		else if (data === "j" || matchesSelectDown(data) || data === "k" || matchesSelectUp(data)) {
			this.#selected = move(this.#entries, this.#selected, data === "j" || matchesSelectDown(data) ? 1 : -1) ?? "";
		} else if (matchesKey(data, "enter")) {
			const entry = this.#entries.find(row => row.id === this.#selected);
			if (entry?.kind === "team" && entry.teamId && entry.teamId !== this.#snapshot?.team?.id) {
				void this.refresh(entry.teamId);
			}
		}
		this.#render();
	}

	#body(width: number, height: number): string[] {
		const lines: string[] = [];
		if (this.#error || this.#snapshot?.warning) {
			lines.push(theme.fg("warning", sanitizeText(this.#error ?? this.#snapshot!.warning!)));
		}
		const snapshot = this.#snapshot;
		if (!snapshot) return [this.#loading ? "Loading Teams…" : "No Team database."];
		const team = snapshot.team;
		if (!team) return ["Select a Team with Enter."];
		lines.push(theme.bold(`${sanitizeText(team.name)} · ${team.id}`));
		lines.push(theme.fg("dim", team.rootPath));
		lines.push(
			`${snapshot.personas.length} personas · ${snapshot.pms.length} PMs · ${snapshot.engineers.length} engineers`,
			`${snapshot.rooms.length} rooms · ${snapshot.plans.length} plans · ${snapshot.taskCount} tasks · ${snapshot.memoryKeys.length} memory scopes`,
		);
		if (snapshot.defaultPersonaId) lines.push(`default persona · ${snapshot.defaultPersonaId}`);
		lines.push("");
		const entry = this.#entries.find(row => row.id === this.#selected);
		if (entry?.kind === "plan") {
			const plan = snapshot.plans.find(row => row.id === entry.id.slice("plan:".length));
			if (plan)
				lines.push(
					`Plan ${plan.id} · ${plan.status} · revision ${plan.revision}`,
					`${plan.itemCount} items · ${plan.title}`,
				);
		} else if (entry?.kind === "room") {
			const room = snapshot.rooms.find(row => row.id === entry.id.slice("room:".length));
			if (room) lines.push(`#${room.name} · ${room.kind} · ${room.memberCount} members · #${room.lastSeq}`);
		} else if (entry?.kind === "persona") {
			const persona = snapshot.personas.find(row => row.id === entry.id.slice("persona:".length));
			if (persona) lines.push(`${persona.name} · ${persona.role} · revision ${persona.revision}`);
		}
		lines.push("", theme.fg("dim", "Use /team persona|plan|profile|memory to edit from the conversation."));
		return lines.map(line => truncateToWidth(line, width)).slice(0, Math.max(1, height));
	}

	render(width: number): readonly string[] {
		return this.#frame
			.render(
				width,
				this.#height(),
				this.#entries,
				theme.fg("dim", "j/k:select  Enter:open Team  r:refresh  Esc:back"),
			)
			.slice(0, this.#height());
	}
}
