/**
 * Render a Team persona as the assignment preamble a worker receives.
 * Repository `AGENTS.md` is deliberately absent: it is repository guidance,
 * never a persona (ADR-0092).
 */
import type { TeamPersonaPack } from "./persona-pack";

function permissionLines(pack: TeamPersonaPack): string[] {
	return Object.entries(pack.permissions ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => `- ${name}: ${value}`);
}

export function renderTeamPersonaPrompt(pack: TeamPersonaPack, assignment: string): string {
	const lines = [
		`# Team persona: ${pack.name}`,
		`Role: ${pack.role}`,
		`Persona id: ${pack.id} (revision ${pack.revision})`,
	];
	if (pack.description) lines.push("", pack.description);
	if (pack.model || pack.thinkingLevel) {
		lines.push(
			"",
			"Preferences:",
			`- model: ${pack.model ?? "inherit"}`,
			`- thinking: ${pack.thinkingLevel ?? "inherit"}`,
		);
	}
	if (pack.skills?.length) lines.push("", "Skills:", ...pack.skills.map(skill => `- ${skill}`));
	const permissions = permissionLines(pack);
	if (permissions.length) lines.push("", "Tool permissions:", ...permissions);
	if (pack.memoryScope) lines.push("", `Memory scope: ${pack.memoryScope}`);
	if (pack.workingFolder) lines.push(`Working folder: ${pack.workingFolder}`);
	if (pack.pluginPack) {
		lines.push("", `Scoped plugin pack: ${pack.pluginPack.root}`);
	}
	lines.push(
		"",
		"Repository AGENTS.md files are repository guidance and never define this identity.",
		"",
		"## Assignment",
		assignment,
	);
	return lines.join("\n");
}
