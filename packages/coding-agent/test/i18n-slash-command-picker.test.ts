import { afterEach, describe, expect, test } from "bun:test";
import type { InteractiveModeContext } from "../src/modes/types";
import { Settings } from "../src/config/settings";
import { setLanguage } from "../src/i18n";
import { buildAcpBuiltinSlashCommands } from "../src/slash-commands/acp-builtins";
import {
	BUILTIN_SLASH_COMMANDS_INTERNAL,
	buildTuiBuiltinSlashCommands,
	resolveCommandDescription,
	type TuiBuiltinSlashCommand,
} from "../src/slash-commands/builtin-registry";
import {
	type SlashCommandSnapshot,
	resolveCommandSnapshot,
	slashCommandSnapshotKey,
} from "../src/slash-commands/command-snapshot";

/**
 * Guard for the `/language` ↔ slash-command picker contract (v1.2.0 regression).
 *
 * The picker renders *materialized* commands: `materializeTuiBuiltinSlashCommand`
 * flattens `description: () => M.cmdFoo` into a plain string
 * (`builtin-registry.ts`), so the list InteractiveMode caches
 * (`#slashCommandSnapshot`) freezes whatever copy was active when it was built.
 * `/language` asks for a refresh, so any cache key that tracks less than "icon
 * preset **and** active language" leaves the picker half-translated: static
 * descriptions stay in the startup language while render-time thunks
 * (`getAutocompleteDescription`, inline hints) follow the live catalogue — the
 * exact mixed-language screenshot that shipped as v1.2.0.
 *
 * The assertions below drive the production policy
 * ({@link resolveCommandSnapshot} + {@link slashCommandSnapshotKey}) with the
 * production materializer and compare EVERY command description against the
 * value the registry resolves from the *new* catalogue. Removing the language
 * term from the key (the pre-fix behaviour) turns them red.
 */
const SYMBOL_PRESET = "nerd";

/**
 * The picker builds its list with the live InteractiveMode context, and a few
 * specs derive extra render-time copy from it (`getAutocompleteDescription`).
 * Those hooks never feed the assertions below (they are not `description`), so
 * every ctx read resolves to a self-returning callable: hooks take their
 * "unknown state" branch instead of dragging a session graph into this guard.
 * Nothing under test dereferences the result, so the structural cast stands in
 * for the class the real caller passes. `settings` is the exception: the
 * palette applies per-command configuration gates against it.
 */
function paletteRuntime(): { ctx: InteractiveModeContext } {
	const settings = Settings.isolated({});
	const shadow: unknown = new Proxy(() => shadow, {
		get: (_target, property) =>
			property === "settings" ? settings : property === Symbol.toPrimitive ? () => "" : shadow,
		has: (_target, property) => property === "settings",
		apply: () => shadow,
		ownKeys: () => [],
		getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: shadow }),
	});
	return { ctx: shadow as InteractiveModeContext };
}

/** Descriptions the picker list actually shows, per command name. */
function paletteDescriptions(snapshot: SlashCommandSnapshot<TuiBuiltinSlashCommand>): Map<string, string> {
	return new Map(snapshot.commands.map(command => [command.name, command.description]));
}

/**
 * The same descriptions, read straight from the registry under the active
 * catalogue: the independent oracle these snapshots must match. Every spec is
 * listed — the TUI picker also shows `handleTui`-only commands.
 */
function catalogueDescriptions(): Map<string, string> {
	const expected = new Map<string, string>();
	for (const spec of BUILTIN_SLASH_COMMANDS_INTERNAL) {
		expected.set(spec.name, resolveCommandDescription(spec.description));
	}
	return expected;
}

/** Rebuild through the production cache policy, exactly as the picker does. */
function paletteSnapshot(
	previous: SlashCommandSnapshot<TuiBuiltinSlashCommand> | undefined,
): SlashCommandSnapshot<TuiBuiltinSlashCommand> {
	return resolveCommandSnapshot(previous, slashCommandSnapshotKey(SYMBOL_PRESET), () =>
		buildTuiBuiltinSlashCommands(paletteRuntime()),
	);
}

/** `name: actual -> expected` for every command whose description drifted. */
function descriptionDrift(actual: Map<string, string>, expected: Map<string, string>): string[] {
	const drift: string[] = [];
	for (const [name, description] of actual) {
		if (description !== expected.get(name)) drift.push(`${name}: ${description} != ${expected.get(name)}`);
	}
	return drift;
}

afterEach(() => setLanguage("en"));

describe("/language ↔ slash-command picker", () => {
	test("every picker description follows both language switches", () => {
		setLanguage("en");
		let snapshot = paletteSnapshot(undefined);
		const english = paletteDescriptions(snapshot);
		expect(english.size, "registry produced no commands to check").toBeGreaterThan(40);

		// en -> zh: the picker's cached list must be rebuilt against the zh catalogue.
		setLanguage("zh");
		snapshot = paletteSnapshot(snapshot);
		const chinese = paletteDescriptions(snapshot);
		expect(descriptionDrift(chinese, catalogueDescriptions())).toEqual([]);

		// Anti-vacuity: the switch must actually move the copy, so a catalogue that
		// stopped being wired (all-English thunks) cannot make this pass. The floor
		// only has to separate "catalogue-backed" from "not" (~92 of the palette's
		// entries change today); it is not a pin on the registry's size.
		const translated = [...english].filter(([name, description]) => chinese.get(name) !== description);
		expect(
			translated.length,
			`switching to zh changed only ${translated.length} command descriptions — the picker is not catalogue-backed`,
		).toBeGreaterThan(60);

		// zh -> en: the reverse switch has to land on the en catalogue.
		setLanguage("en");
		snapshot = paletteSnapshot(snapshot);
		expect(descriptionDrift(paletteDescriptions(snapshot), catalogueDescriptions())).toEqual([]);
		expect(paletteDescriptions(snapshot)).toEqual(english);
	});

	test("an unchanged key is reused verbatim (preset switch is the only other invalidator)", () => {
		setLanguage("en");
		const first = paletteSnapshot(undefined);
		const second = paletteSnapshot(first);
		expect(second).toBe(first);
		expect(paletteDescriptions(second)).toEqual(paletteDescriptions(first));
	});

	test("ACP/RPC command list resolves thunked acpDescription per read", () => {
		setLanguage("en");
		const english = new Map(buildAcpBuiltinSlashCommands().map(command => [command.name, command.description]));

		setLanguage("zh");
		const chinese = new Map(buildAcpBuiltinSlashCommands().map(command => [command.name, command.description]));

		const expected = new Map<string, string>();
		for (const spec of BUILTIN_SLASH_COMMANDS_INTERNAL) {
			if (spec.handle === undefined) continue;
			expected.set(spec.name, resolveCommandDescription(spec.acpDescription ?? spec.description));
		}
		expect(descriptionDrift(chinese, expected)).toEqual([]);

		const translated = [...english].filter(([name, description]) => chinese.get(name) !== description);
		expect(
			translated.length,
			"no ACP description changed with the language — acpDescription froze at import time",
		).toBeGreaterThan(20);
	});
});
