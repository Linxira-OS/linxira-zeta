/**
 * Slash Commands Capability
 *
 * File-based slash commands defined as markdown files.
 */
import { defineCapability } from ".";
import type { SourceMeta } from "./types";

/** Execution selectors shared by Markdown and TypeScript commands. */
export interface CommandExecutionMetadata {
	agent?: string;
	model?: string;
}

/** Preserve execution fields when a provider strips Markdown frontmatter. */
export function commandFrontmatterExecution(
	frontmatter: Record<string, unknown>,
): CommandExecutionMetadata & { template?: string } {
	const fields: CommandExecutionMetadata & { template?: string } = {};
	for (const key of ["agent", "model", "template"] as const) {
		const value = frontmatter[key];
		if (typeof value !== "string" || !value.trim()) continue;
		fields[key] = value;
	}
	return fields;
}

/**
 * A file-based slash command.
 */
export interface SlashCommand extends CommandExecutionMetadata {
	/** Command name (without leading slash) */
	name: string;
	/** Absolute path to command file */
	path: string;
	/** Command content (markdown template) */
	content: string;
	/** Explicit template, when discovery stripped frontmatter. */
	template?: string;
	/** Source level */
	level: "user" | "project" | "native";
	/** Already-parsed display description, when discovery stripped frontmatter from `content`. */
	description?: string;
	/** Already-parsed argument hint (`argumentHint` or `argument-hint`). */
	argumentHint?: string;
	/** Already-parsed `side: true` frontmatter (literal boolean only), when discovery stripped it from `content`. */
	side?: boolean;
	/** Source metadata */
	_source: SourceMeta;
}

export const slashCommandCapability = defineCapability<SlashCommand>({
	id: "slash-commands",
	displayName: "Slash Commands",
	description: "Custom slash commands defined as markdown files",
	key: cmd => cmd.name,
	toExtensionId: cmd => `slash-command:${cmd.name}`,
	validate: cmd => {
		if (!cmd.name) return "Missing name";
		if (!cmd.path) return "Missing path";
		if (cmd.content === undefined) return "Missing content";
		if (cmd.level !== "user" && cmd.level !== "project" && cmd.level !== "native") {
			return "Invalid level: must be 'user', 'project', or 'native'";
		}
		return undefined;
	},
});
