/**
 * Team workspace view model: every registered Team, its contacts, rooms, plans
 * and memory scopes, plus the selection/refresh state a host view renders.
 *
 * Rendering lives in the host UI (`ui/overlays`); this module stays free of
 * nodes, colors and terminal input so both the TUI and the serve/GUI side can
 * drive it.
 */
import { sanitizeText } from "@linxiraos/pi-utils";

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

/** Host hooks of the workspace view; every one is optional so a headless caller can ignore it. */
export interface TeamWorkspaceDeps {
	readonly source: TeamWorkspaceSource;
	/** Called when the view should close (Escape on the root). */
	readonly onDone?: () => void;
	/** Called after state changes; a reactive host re-renders from its own effect instead. */
	readonly requestRender?: () => void;
}

export type TeamWorkspaceEntryKind = "label" | "team" | "persona" | "person" | "room" | "plan" | "memory";

/** One sidebar row: a section label or a selectable record. */
export interface TeamWorkspaceEntry {
	readonly id: string;
	readonly kind: TeamWorkspaceEntryKind;
	readonly label: string;
	readonly annotation?: string;
	readonly teamId?: string;
	readonly detail?: string;
}

/** The sidebar rows of `snapshot`: Teams first, then the open Team's records. */
export function buildTeamWorkspaceEntries(snapshot: TeamWorkspaceSnapshot): TeamWorkspaceEntry[] {
	const rows: TeamWorkspaceEntry[] = [{ id: "teams", kind: "label", label: "TEAMS" }];
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

/** The selectable row `delta` away from `selected`, wrapping around the section labels. */
export function moveTeamWorkspaceSelection(
	entries: readonly TeamWorkspaceEntry[],
	selected: string | undefined,
	delta: number,
): string | undefined {
	const choices = entries.filter(entry => entry.kind !== "label");
	if (choices.length === 0) return undefined;
	const index = choices.findIndex(entry => entry.id === selected);
	return choices[((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta + choices.length) % choices.length]?.id;
}

/** The record a sidebar id names, with its typed detail from `snapshot`. */
export type TeamWorkspaceSelection =
	| { readonly kind: "none" }
	| { readonly kind: "team"; readonly team: TeamWorkspaceTeamRow }
	| { readonly kind: "persona"; readonly persona: TeamWorkspacePersonaRow }
	| { readonly kind: "person"; readonly person: TeamWorkspacePersonRow }
	| { readonly kind: "room"; readonly room: TeamWorkspaceRoomRow }
	| { readonly kind: "plan"; readonly plan: TeamWorkspacePlanRow }
	| { readonly kind: "memory"; readonly key: string };

/** Resolve the selected sidebar row against the loaded snapshot. */
export function teamWorkspaceSelection(
	snapshot: TeamWorkspaceSnapshot | undefined,
	entry: TeamWorkspaceEntry | undefined,
): TeamWorkspaceSelection {
	if (!snapshot || !entry) return { kind: "none" };
	switch (entry.kind) {
		case "team": {
			const team = snapshot.teams.find(row => row.id === entry.teamId);
			return team ? { kind: "team", team } : { kind: "none" };
		}
		case "persona": {
			const persona = snapshot.personas.find(row => row.id === entry.id.slice("persona:".length));
			return persona ? { kind: "persona", persona } : { kind: "none" };
		}
		case "person": {
			const person = [...snapshot.pms, ...snapshot.engineers].find(
				row => entry.id === `pm:${row.id}` || entry.id === `engineer:${row.id}`,
			);
			return person ? { kind: "person", person } : { kind: "none" };
		}
		case "room": {
			const room = snapshot.rooms.find(row => row.id === entry.id.slice("room:".length));
			return room ? { kind: "room", room } : { kind: "none" };
		}
		case "plan": {
			const plan = snapshot.plans.find(row => row.id === entry.id.slice("plan:".length));
			return plan ? { kind: "plan", plan } : { kind: "none" };
		}
		case "memory":
			return { kind: "memory", key: entry.id.slice("memory:".length) };
		default:
			return { kind: "none" };
	}
}

/** Selection and refresh state of the Team workspace. */
export class TeamWorkspaceModel {
	readonly #deps: TeamWorkspaceDeps;
	#snapshot: TeamWorkspaceSnapshot | undefined;
	#entries: TeamWorkspaceEntry[] = [];
	#selected = "teams";
	#loading = false;
	#error: string | undefined;
	#disposed = false;
	#lastLoad: Promise<void> = Promise.resolve();

	constructor(deps: TeamWorkspaceDeps) {
		this.#deps = deps;
		void this.refresh();
	}

	/** Resolves after the latest database read settles. */
	get ready(): Promise<void> {
		return this.#lastLoad;
	}
	get snapshot(): TeamWorkspaceSnapshot | undefined {
		return this.#snapshot;
	}
	get entries(): readonly TeamWorkspaceEntry[] {
		return this.#entries;
	}
	get selectedId(): string {
		return this.#selected;
	}
	get loading(): boolean {
		return this.#loading;
	}
	get error(): string | undefined {
		return this.#error;
	}
	get selectedEntry(): TeamWorkspaceEntry | undefined {
		return this.#entries.find(entry => entry.id === this.#selected);
	}
	get selection(): TeamWorkspaceSelection {
		return teamWorkspaceSelection(this.#snapshot, this.selectedEntry);
	}

	dispose(): void {
		this.#disposed = true;
	}

	/** Load the team list, or the detail of `teamId`. */
	refresh(teamId?: string): Promise<void> {
		const promise = this.#load(teamId ?? this.#snapshot?.team?.id);
		this.#lastLoad = promise;
		return promise;
	}

	async #load(teamId?: string): Promise<void> {
		if (this.#disposed) return;
		this.#loading = true;
		try {
			const snapshot = await this.#deps.source.load(teamId);
			if (this.#disposed) return;
			this.#snapshot = snapshot;
			this.#error = undefined;
			this.#rebuild();
		} catch (error) {
			this.#error = error instanceof Error ? error.message : String(error);
		} finally {
			this.#loading = false;
			this.#requestRender();
		}
	}

	/** Move the selection by `delta` selectable rows. */
	moveSelection(delta: number): void {
		this.#selected = moveTeamWorkspaceSelection(this.#entries, this.#selected, delta) ?? "";
		this.#requestRender();
	}

	/**
	 * Select `id`. A Team row opens that Team's detail; the promise resolves
	 * once the reload settles (immediately for non-team rows).
	 */
	select(id: string | undefined): Promise<void> {
		if (!id || id === this.#selected) {
			this.#requestRender();
			return Promise.resolve();
		}
		this.#selected = id;
		const entry = this.selectedEntry;
		this.#requestRender();
		if (entry?.kind === "team" && entry.teamId && entry.teamId !== this.#snapshot?.team?.id) {
			return this.refresh(entry.teamId);
		}
		return Promise.resolve();
	}

	/** Escape: leave a Team's detail for the team list, else close the view. */
	cancel(): void {
		const openTeamId = this.#snapshot?.team?.id;
		if (openTeamId && this.#selected !== `team:${openTeamId}`) {
			this.#selected = `team:${openTeamId}`;
			this.#requestRender();
			return;
		}
		this.#deps.onDone?.();
	}

	#rebuild(): void {
		this.#entries = this.#snapshot ? buildTeamWorkspaceEntries(this.#snapshot) : [];
		if (!this.#entries.some(entry => entry.id === this.#selected)) {
			this.#selected = this.#entries.find(entry => entry.kind !== "label")?.id ?? "";
		}
	}

	#requestRender(): void {
		if (!this.#disposed) this.#deps.requestRender?.();
	}
}
