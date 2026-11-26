import { clearSubmittedText } from "./helpers/draft";
import { M, type Messages } from "../i18n";
import { en } from "../i18n/en";
import type { AutocompleteItem } from "../autocomplete/autocomplete";
import { BUILTIN_CHANNELS_SLASH_COMMAND } from "./builtin-channels";
import { BUILTIN_COMMIT_SLASH_COMMANDS } from "./builtin-commit";
import {
	buildArgumentCompletions,
	buildDirectoryArgumentCompletions,
	buildEffortArgumentCompletions,
	buildEffortInlineHint,
	buildLocalFileArgumentCompletions,
	buildMcpArgumentCompletions,
	buildModelSelectorCompletions,
	buildStaticInlineHint,
	buildSubcommandInlineHint,
} from "./builtin-completions";
import { BUILTIN_CONTROL_SLASH_COMMANDS } from "./builtin-control";
import { BUILTIN_EDITS_SLASH_COMMANDS } from "./builtin-edits";
import { BUILTIN_LIFECYCLE_SLASH_COMMANDS } from "./builtin-lifecycle";
import { BUILTIN_MARKETPLACE_SLASH_COMMANDS, reloadTuiPluginState } from "./builtin-marketplace";
import { BUILTIN_MODE_SLASH_COMMANDS } from "./builtin-modes";
import { BUILTIN_OUTPUT_SLASH_COMMANDS } from "./builtin-output";
import { BUILTIN_SESSION_SLASH_COMMANDS } from "./builtin-session";
import { BUILTIN_SKILLS_SLASH_COMMANDS } from "./builtin-skills";
import { BUILTIN_TWO_FACTOR_SLASH_COMMAND } from "./builtin-two-factor";
import { BUILTIN_ZETA_SLASH_COMMANDS } from "./builtin-zeta";
import { parseSlashCommand } from "./helpers/parse";
import type {
	BuiltinSlashCommand,
	ParsedSlashCommand,
	SlashCommandResult,
	SlashCommandRuntime,
	SlashCommandSpec,
	TuiSlashCommandRuntime,
} from "./types";

export type { BuiltinSlashCommand, SubcommandDef } from "./types";

/** TUI-specific runtime accepted by `executeBuiltinSlashCommand`. */
export type BuiltinSlashCommandRuntime = TuiSlashCommandRuntime;

export interface TuiBuiltinSlashCommand extends BuiltinSlashCommand {
	getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
	getInlineHint?: (argumentText: string) => string | null;
	getAutocompleteDescription?: () => string | undefined;
}

/**
 * Reverse the English catalogue so a static upstream description becomes the
 * catalogue thunk again. 19.2 ships most builtin descriptions as literals; the
 * TUI picker must still follow `/language`.
 */
const COMMAND_DESCRIPTION_KEYS = new Map<string, keyof typeof en>(
	Object.entries(en)
		.filter(([key, value]) => key.startsWith("cmd") && typeof value === "string")
		.map(([key, value]) => [value as string, key as keyof typeof en]),
);

function localizeCommandDescription(
	description: string | (() => string) | undefined,
): string | (() => string) | undefined {
	if (typeof description !== "string") return description;
	const key = COMMAND_DESCRIPTION_KEYS.get(description);
	return key === undefined
		? description
		: () => {
				const localized = M[key as keyof Messages];
				return typeof localized === "string" ? localized : description;
			};
}

const RAW_BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<SlashCommandSpec> = [
	...BUILTIN_MODE_SLASH_COMMANDS,
	...BUILTIN_OUTPUT_SLASH_COMMANDS,
	...BUILTIN_SESSION_SLASH_COMMANDS,
	...BUILTIN_COMMIT_SLASH_COMMANDS,
	...BUILTIN_LIFECYCLE_SLASH_COMMANDS,
	...BUILTIN_MARKETPLACE_SLASH_COMMANDS,
	...BUILTIN_SKILLS_SLASH_COMMANDS,
	...BUILTIN_CONTROL_SLASH_COMMANDS,
	BUILTIN_CHANNELS_SLASH_COMMAND,
	...BUILTIN_EDITS_SLASH_COMMANDS,
	BUILTIN_TWO_FACTOR_SLASH_COMMAND,
	...BUILTIN_ZETA_SLASH_COMMANDS,
];

/** Localise a command's description and ACP copy at read time, preserving a
 * spec's own thunk/getter instead of freezing whatever it returned at import. */
function localizeCommandSpec(command: SlashCommandSpec): SlashCommandSpec {
	return {
		...command,
		get description() {
			return localizeCommandDescription(command.description)!;
		},
		get acpDescription() {
			return localizeCommandDescription(command.acpDescription);
		},
		subcommands: command.subcommands?.map(subcommand => ({
			...subcommand,
			get description() {
				return localizeCommandDescription(subcommand.description)!;
			},
		})),
	};
}

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<SlashCommandSpec> =
	RAW_BUILTIN_SLASH_COMMAND_REGISTRY.map(localizeCommandSpec);

const BUILTIN_SLASH_COMMAND_LOOKUP = new Map<string, SlashCommandSpec>();
for (const command of BUILTIN_SLASH_COMMAND_REGISTRY) {
	BUILTIN_SLASH_COMMAND_LOOKUP.set(command.name, command);
	for (const alias of command.aliases ?? []) {
		BUILTIN_SLASH_COMMAND_LOOKUP.set(alias, command);
	}
}

export const BUILTIN_SLASH_COMMAND_RESERVED_NAMES: ReadonlySet<string> = new Set(BUILTIN_SLASH_COMMAND_LOOKUP.keys());

/** Builtin command metadata used for slash-command autocomplete and help text. */
export const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_REGISTRY.map(
	command => ({
		name: command.name,
		aliases: command.aliases,
		allowArgs: command.allowArgs === true,
		argumentCompletionOnly: command.argumentCompletionOnly,
		// Getter: some descriptions name keys, formatted at read time (theme/preset may change).
		get description() {
			return command.description;
		},
		icon: command.icon,
		subcommands: command.subcommands,
		subcommandOptional: command.subcommandOptional,
		inlineHint: command.inlineHint,
		getTuiAutocompleteDescription: command.getTuiAutocompleteDescription,
	}),
);

function materializeTuiBuiltinSlashCommand(
	cmd: BuiltinSlashCommand,
	runtime?: TuiSlashCommandRuntime,
): TuiBuiltinSlashCommand {
	const materialized: TuiBuiltinSlashCommand = {
		...cmd,
		description: localizeCommandDescription(cmd.description)!,
		subcommands: cmd.subcommands?.map(subcommand => ({
			...subcommand,
			description: localizeCommandDescription(subcommand.description)!,
		})),
	};
	if (cmd.subcommands) {
		const subcommands = cmd.subcommands;
		// `/mcp` and `/effort` narrow their declarative lists to live session
		// state so the dropdown never offers a value the handler would reject.
		if (runtime && cmd.name === "mcp") {
			materialized.getArgumentCompletions = buildMcpArgumentCompletions(subcommands, runtime);
			materialized.getInlineHint = buildSubcommandInlineHint(subcommands);
		} else if (runtime && cmd.name === "effort") {
			materialized.getArgumentCompletions = buildEffortArgumentCompletions(runtime);
			materialized.getInlineHint = buildEffortInlineHint(runtime);
		} else {
			const options = { optional: cmd.subcommandOptional };
			materialized.getArgumentCompletions = buildArgumentCompletions(subcommands, options);
			materialized.getInlineHint = buildSubcommandInlineHint(subcommands, options);
		}
	} else if (cmd.name === "move" || cmd.name === "cd") {
		materialized.getArgumentCompletions = buildDirectoryArgumentCompletions();
		if (cmd.inlineHint) materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	} else if (cmd.name === "local" && runtime) {
		materialized.getArgumentCompletions = buildLocalFileArgumentCompletions(runtime);
		if (cmd.inlineHint) materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	} else if (cmd.name === "switch" && runtime) {
		materialized.getArgumentCompletions = buildModelSelectorCompletions(runtime);
		if (cmd.inlineHint) materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	} else if (cmd.inlineHint) {
		materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	}
	if (runtime && cmd.getTuiAutocompleteDescription) {
		materialized.getAutocompleteDescription = () => cmd.getTuiAutocompleteDescription?.(runtime);
	}
	return materialized;
}

/**
 * Materialized builtin slash commands with completion functions derived from
 * declarative subcommand/hint definitions.
 */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<TuiBuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_DEFS.map(cmd =>
	materializeTuiBuiltinSlashCommand(cmd),
);

export function buildTuiBuiltinSlashCommands(runtime: TuiSlashCommandRuntime): ReadonlyArray<TuiBuiltinSlashCommand> {
	return BUILTIN_SLASH_COMMAND_DEFS.map(cmd => materializeTuiBuiltinSlashCommand(cmd, runtime));
}

/**
 * Unified registry exposed for cross-mode tooling. Each spec carries at least
 * one of `handle` / `handleTui`. The TUI dispatcher prefers `handleTui`; the
 * ACP dispatcher requires `handle` and skips TUI-only entries.
 */
export const BUILTIN_SLASH_COMMANDS_INTERNAL: ReadonlyArray<SlashCommandSpec> = BUILTIN_SLASH_COMMAND_REGISTRY;

/**
 * Execute a builtin slash command in the interactive TUI.
 *
 * Returns `false` when no builtin matched. Returns `true` when a command
 * consumed the input entirely. Returns a `string` when the command was handled
 * but remaining text should be sent as a prompt.
 */
export async function executeBuiltinSlashCommand(
	text: string,
	runtime: BuiltinSlashCommandRuntime,
): Promise<string | boolean> {
	const parsed = parseSlashCommand(text);
	if (!parsed) return false;

	const command = BUILTIN_SLASH_COMMAND_LOOKUP.get(parsed.name);
	if (!command) return false;
	if (parsed.args.length > 0 && !command.allowArgs) {
		return false;
	}
	// Collab guests run a read-mostly replica: session-mutating builtins are
	// host-only. Zeta retired collab; the guard is removed with it.
	if (command.handleTui) {
		const result = await command.handleTui(parsed, runtime);
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	if (command.handle) {
		// No TUI-specific override → adapt the ACP/text-mode `handle` to the
		// TUI by routing `runtime.output` through `ctx.showStatus`, clearing
		// the editor after the call, and reusing the active session's plugin
		// reload pipeline. Spec authors get a single body usable from either
		// dispatcher without forcing every TUI test to construct the full
		// `SlashCommandRuntime` shape.
		const ctx = runtime.ctx;
		const adapted: SlashCommandRuntime = {
			session: ctx.session,
			sessionManager: ctx.sessionManager,
			settings: ctx.settings,
			cwd: ctx.sessionManager.getCwd(),
			output: (text: string) => {
				ctx.showStatus(text);
			},
			refreshCommands: () => ctx.refreshSlashCommandState(),
			reloadPlugins: () => reloadTuiPluginState(ctx),
			notifySessionPinChanged: (sessionId: string, pinned: boolean) => ctx.applySessionPin(sessionId, pinned),
		};
		const result = await command.handle(parsed, adapted);
		clearSubmittedText(runtime);
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	return false;
}

/** Look up a unified spec by name or alias. Used by the ACP dispatcher. */
export function lookupBuiltinSlashCommand(name: string): SlashCommandSpec | undefined {
	return BUILTIN_SLASH_COMMAND_LOOKUP.get(name);
}

export type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime, SlashCommandSpec, TuiSlashCommandRuntime };
