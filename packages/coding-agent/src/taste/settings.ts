/**
 * Settings declared by the taste layer (see `config/registry.ts`). Declaration
 * order is the settings-panel order; `config/all-settings.ts` registers every
 * domain.
 *
 * Every taste setting is gated by `memory.backend != off` (`tasteAvailable` in
 * `config/settings-ui.ts`): the layer refines a working memory backend, it never
 * replaces one. `taste.enabled` itself defaults to `off` — see `docs/memory.md`
 * for why the layer is not recommended without a token budget for it.
 */
import { register } from "../config/registry";

/** Master flag: off means no extraction, no consolidation, no tool, no injection. */
export const cfgTasteEnabled = register({
	id: "taste.enabled",
	type: "boolean",
	default: false,
	ui: {
		condition: "tasteAvailable",
		tab: "memory",
		group: "Taste",
		label: "Taste Layer",
		description:
			"Learn durable coding preferences from your prompts and inject the confident ones; needs a memory backend and is not recommended on a tight token budget",
	},
});

/** Window learning runs only after a committed boundary or session stop. */
export const cfgTasteExtractionMode = register({
	id: "taste.extractionMode",
	type: "enum",
	values: ["prompt", "window", "off"] as const,
	default: "prompt",
});

/** Storage scope: `global` shares one store across projects, `per-project` keeps them apart. */
export const cfgTasteScoping = register({
	id: "taste.scoping",
	type: "enum",
	values: ["global", "per-project", "per-project-tagged"] as const,
	default: "per-project",
	ui: {
		condition: "tasteAvailable",
		tab: "memory",
		group: "Taste",
		label: "Taste Scoping",
		description:
			"Which store a project reads: one shared global store, this project alone, or this project plus the global one",
		options: [
			{ value: "global", label: "Global", description: "One store for every project on this machine" },
			{ value: "per-project", label: "Per-project", description: "Only this repository's store" },
			{
				value: "per-project-tagged",
				label: "Project + global",
				description: "This repository's store first, then habits that hold across repositories",
			},
		],
	},
});

/** Prompts shorter than this never reach extraction; no UI (a knob, not a preference). */
export const cfgTasteMinPromptLength = register({
	id: "taste.minPromptLength",
	type: "number",
	default: 16,
});

/** How often the consolidation tick looks for queued candidates. */
export const cfgTasteIntervalMinutes = register({
	id: "taste.intervalMinutes",
	type: "number",
	default: 5,
});

/** Ceiling for the injected preference block, in approximate tokens. */
export const cfgTasteInjectionTokenLimit = register({
	id: "taste.injectionTokenLimit",
	type: "number",
	default: 600,
	ui: {
		condition: "tasteAvailable",
		tab: "memory",
		group: "Taste",
		label: "Taste Injection Budget",
		description: "Approximate token ceiling for the injected preference block",
	},
});

/** `S_e` floor: below it an entry is cold-stored, not injected. */
export const cfgTasteConfidenceFloor = register({
	id: "taste.confidenceFloor",
	type: "number",
	default: 0.6,
	ui: {
		condition: "tasteAvailable",
		tab: "memory",
		group: "Taste",
		label: "Taste Confidence Floor",
		description: "Minimum injection score for a preference to reach the prompt (0–1)",
	},
});
