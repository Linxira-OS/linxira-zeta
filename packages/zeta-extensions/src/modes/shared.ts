// Mode exclusivity + toolset switching shared by plan/vibe modes (port of omp
// plan/vibe/goal exclusivity rules onto pi extension API)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ZetaMode = "plan" | "vibe" | "goal";

export interface ZetaModeState {
	mode: ZetaMode | undefined;
	toolsBefore: string[] | undefined;
}

export interface ModeManagerOptions {
	appendEntry: (state: ZetaModeState) => void;
}

const STATE_ENTRY = "zeta-mode";

export class ModeManager {
	readonly #api: ExtensionAPI;
	readonly #options: ModeManagerOptions;
	state: ZetaModeState;

	constructor(api: ExtensionAPI, options: ModeManagerOptions) {
		this.#api = api;
		this.#options = options;
		this.state = { mode: undefined, toolsBefore: undefined };
	}

	active(): ZetaMode | undefined {
		return this.state.mode;
	}

	/** True when any other mode is active (plan/vibe/goal are mutually exclusive). */
	conflictWith(mode: ZetaMode): ZetaMode | undefined {
		const current = this.state.mode;
		if (current === undefined || current === mode) return undefined;
		return current;
	}

	/**
	 * Switch the active toolset. Returns the previously active toolset so the
	 * caller can restore it later. `restore` puts the saved toolset back.
	 */
	saveTools(): string[] {
		return [...this.#api.getActiveTools()];
	}

	setTools(tools: string[]): void {
		this.#api.setActiveTools(tools);
	}

	restoreTools(saved: string[] | undefined): void {
		if (saved) this.#api.setActiveTools(saved);
	}

	setMode(mode: ZetaMode, toolsBefore: string[] | undefined): void {
		this.state = { mode, toolsBefore };
		this.persist();
	}

	clearMode(): void {
		this.state = { mode: undefined, toolsBefore: undefined };
		this.persist();
	}

	persist(): void {
		this.#options.appendEntry(this.state);
	}

	updateStatus(ctx: ExtensionContext): void {
		const label =
			this.state.mode === "plan" ? "Plan: on" : this.state.mode === "vibe" ? "Vibe: on" : this.state.mode === "goal" ? "Goal: on" : undefined;
		ctx.ui.setStatus("zeta-mode", label);
	}

	static restoreState(entries: readonly { type: string; customType?: string; data?: unknown }[]): ZetaModeState {
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY) {
				const data = entry.data as ZetaModeState | undefined;
				if (data && (data.mode === "plan" || data.mode === "vibe" || data.mode === "goal" || data.mode === undefined)) {
					return data;
				}
			}
		}
		return { mode: undefined, toolsBefore: undefined };
	}
}
