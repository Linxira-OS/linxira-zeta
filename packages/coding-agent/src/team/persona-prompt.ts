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

export function renderTeamPersonaPrompt(persona: TeamPersonaPack, assignment: string, memory?: string): string {
	const lines = [
		`# Team persona: ${persona.name}`,
		`Role: ${persona.role}`,
		`Persona id: ${persona.id} (revision ${persona.revision})`,
	];
	if (persona.description) lines.push("", persona.description);
	if (persona.model || persona.thinkingLevel) {
		lines.push(
			"",
			"Preferences:",
			`- model: ${persona.model ?? "inherit"}`,
			`- thinking: ${persona.thinkingLevel ?? "inherit"}`,
		);
	}
	if (persona.skills?.length) lines.push("", "Skills:", ...persona.skills.map(skill => `- ${skill}`));
	const permissions = permissionLines(persona);
	if (permissions.length) lines.push("", "Tool permissions:", ...permissions);
	if (persona.memoryScope) lines.push("", `Memory scope: ${persona.memoryScope}`);
	if (persona.workingFolder) lines.push(`Working folder: ${persona.workingFolder}`);
	if (persona.pluginPack) {
		lines.push("", `Scoped plugin pack: ${persona.pluginPack.root}`);
	}
	if (memory?.trim()) lines.push("", "## Team memory", memory.trim());
	lines.push(
		"",
		"Repository AGENTS.md files are repository guidance and never define this identity.",
		"",
		"## Assignment",
		assignment,
	);
	return lines.join("\n");
}
