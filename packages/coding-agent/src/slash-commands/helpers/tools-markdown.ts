import { tuiText } from "@linxiraos/pi-tui";

export interface ToolsMarkdownBindings {
	tools: ReadonlyArray<{ description: string; name: string }>;
	/** Tools mounted under `xd://` URLs, listed after the active set. */
	xdevTools?: ReadonlyArray<{ name: string; summary: string }>;
	/** Command-style mounted tools, listed as `/<name>` alongside the builtins. */
	mountedCommands?: ReadonlyArray<{ name: string }>;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/\|/g, "\\|")
		.replace(/\r?\n+/g, " ")
		.trim();
}

export function buildToolsMarkdown(bindings: ToolsMarkdownBindings): string {
	if (bindings.tools.length === 0 && !bindings.xdevTools?.length && !bindings.mountedCommands?.length) {
		return tuiText("toolsMarkdownNoTools", "No tools are currently visible to the agent.");
	}

	const rows: string[] = [];
	for (const tool of bindings.tools) {
		const description =
			escapeTableCell(tool.description) || tuiText("toolsMarkdownNoDescription", "No description provided.");
		rows.push(`| \`${tool.name}\` | ${description} |`);
	}
	for (const mounted of bindings.mountedCommands ?? []) {
		rows.push(`| \`/${mounted.name}\` | ${tuiText("toolsMarkdownMountedCommand", "Mounted tool command")} |`);
	}
	for (const mounted of bindings.xdevTools ?? []) {
		rows.push(
			`| \`xd://${mounted.name}\` | ${
				escapeTableCell(mounted.summary) || tuiText("toolsMarkdownNoDescription", "No description provided.")
			} |`,
		);
	}

	return [
		`| ${tuiText("toolsMarkdownTool", "Tool")} | ${tuiText("toolsMarkdownDescription", "Description")} |`,
		"|------|-------------|",
		...rows,
	].join("\n");
}
