/**
 * Workflow commands for orchestrating multi-agent workflows.
 *
 * Commands are embedded at build time via Bun's import with { type: "text" }.
 */
import * as path from "node:path";
import { parseFrontmatter } from "@linxiraos/pi-utils";
import { type SlashCommand, slashCommandCapability } from "../capability/slash-command";
import { loadCapability } from "../discovery";
import { EMBEDDED_COMMANDS, EMBEDDED_COMMAND_DESCRIPTION_KEYS } from "./embedded-commands";

export const EMBEDDED_COMMAND_TEMPLATES: ReadonlyArray<{ name: string; content: string }> = EMBEDDED_COMMANDS;

export { EMBEDDED_COMMAND_DESCRIPTION_KEYS };

/** Workflow command definition */
export interface WorkflowCommand {
	name: string;
	description: string;
	instructions: string;
	source: "bundled" | "user" | "project";
	filePath: string;
}

/** Extract string value from frontmatter field */
function getString(frontmatter: Record<string, unknown>, key: string): string {
	const value = frontmatter[key];
	return typeof value === "string" ? value : "";
}

/** Cache for bundled commands: the parsed templates only, never a resolved locale. */
let bundledCommandsCache: WorkflowCommand[] | null = null;

/** Catalogue-backed copy of an embedded template's picker description, if it has one. */
function embeddedDescription(name: string, fallback: string): string {
	return EMBEDDED_COMMAND_DESCRIPTION_KEYS[name]?.() ?? fallback;
}

/**
 * Load all bundled commands from embedded content.
 *
 * The parse is cached, the description is not: `/init`'s copy comes from the
 * original English markdown frontmatter, so resolving it into the cache would
 * freeze whichever locale was active on the first call and leave `/init`
 * English — or stale — after `/language`. Resolving per call costs two object
 * spreads and keeps every consumer (the picker, an embedder of
 * `discoverCommands`) in step with the live catalogue.
 */
export function loadBundledCommands(): WorkflowCommand[] {
	bundledCommandsCache ??= EMBEDDED_COMMANDS.map(({ name, content }) => {
		const { frontmatter, body } = parseFrontmatter(content, {
			source: `embedded:${name}`,
			level: "fatal",
		});
		return {
			name: name.replace(/\.md$/, ""),
			description: getString(frontmatter, "description"),
			instructions: body,
			source: "bundled" as const,
			filePath: `embedded:${name}`,
		};
	});
	return bundledCommandsCache.map(command => ({
		...command,
		description: embeddedDescription(command.name, command.description),
	}));
}

/**
 * Discover all available commands.
 *
 * Precedence (highest wins): .zeta > .pi > .claude (project before user), then bundled
 */
export async function discoverCommands(cwd: string): Promise<WorkflowCommand[]> {
	const resolvedCwd = path.resolve(cwd);

	// Load slash commands from capability API
	const result = await loadCapability<SlashCommand>(slashCommandCapability.id, { cwd: resolvedCwd });

	const commands: WorkflowCommand[] = [];
	const seen = new Set<string>();

	// Convert SlashCommand to WorkflowCommand format
	for (const cmd of result.items) {
		if (seen.has(cmd.name)) continue;

		const { frontmatter, body } = parseFrontmatter(cmd.content, {
			source: cmd.path ?? `workflow-command:${cmd.name}`,
			level: cmd.level === "native" ? "fatal" : "warn",
		});

		// Map capability levels to WorkflowCommand source
		const source: "bundled" | "user" | "project" = cmd.level === "native" ? "bundled" : cmd.level;

		commands.push({
			name: cmd.name,
			description: getString(frontmatter, "description"),
			instructions: body,
			source,
			filePath: cmd.path,
		});
		seen.add(cmd.name);
	}

	// Add bundled commands if not already present
	for (const cmd of loadBundledCommands()) {
		if (seen.has(cmd.name)) continue;
		commands.push(cmd);
		seen.add(cmd.name);
	}

	return commands;
}

/**
 * Get a command by name.
 */
export function getCommand(commands: WorkflowCommand[], name: string): WorkflowCommand | undefined {
	return commands.find(c => c.name === name);
}

/**
 * Expand command instructions with task input.
 * Replaces $@ with the provided input.
 */
export function expandCommand(command: WorkflowCommand, input: string): string {
	// Function replacement so `$`-patterns in user input ($$, $&, ...) stay literal.
	return command.instructions.replace(/\$@/g, () => input);
}

/**
 * Clear the bundled commands cache (for testing).
 */
export function clearBundledCommandsCache(): void {
	bundledCommandsCache = null;
}
