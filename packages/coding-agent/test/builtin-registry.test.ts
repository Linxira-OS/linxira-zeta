import { describe, expect, test } from "bun:test";
import {
	BUILTIN_SLASH_COMMAND_RESERVED_NAMES,
	BUILTIN_SLASH_COMMANDS_INTERNAL,
	lookupBuiltinSlashCommand,
} from "@linxiraos/zeta/slash-commands/builtin-registry";
import { BUILTIN_ZETA_SLASH_COMMANDS } from "@linxiraos/zeta/slash-commands/builtin-zeta";

/**
 * Merge guard: the OMP v18.0.3 merge silently dropped the Zeta-originated
 * command group from the registry (builtin-zeta.ts stayed defined but was no
 * longer spread into BUILTIN_SLASH_COMMAND_REGISTRY), so `/language` and
 * `/tracking` fell through to plain chat. These tests pin the association so
 * a future upstream merge cannot drop the Zeta command group again.
 *
 * Only builtin-zeta is imported here (not the upstream groups): it is a leaf
 * module, so import order cannot deadlock the builtin-modes → interactive-mode
 * → builtin-registry cycle that importing any upstream group first triggers.
 */
describe("builtin slash command registry", () => {
	test("Zeta-originated /language and /tracking are registered and dispatchable", () => {
		expect(BUILTIN_SLASH_COMMAND_RESERVED_NAMES.has("language")).toBe(true);
		expect(BUILTIN_SLASH_COMMAND_RESERVED_NAMES.has("tracking")).toBe(true);
		const language = lookupBuiltinSlashCommand("language");
		expect(language?.name).toBe("language");
		expect(typeof language?.handle).toBe("function");
		expect(typeof language?.handleTui).toBe("function");
	});

	test("every Zeta-originated command is fully present in the registry", () => {
		const registered = new Set(BUILTIN_SLASH_COMMANDS_INTERNAL.map(command => command.name));
		const missing = BUILTIN_ZETA_SLASH_COMMANDS.map(command => command.name).filter(name => !registered.has(name));
		expect(missing).toEqual([]);
	});
});
