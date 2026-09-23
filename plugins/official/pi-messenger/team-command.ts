/**
 * /team — local team/crew queries that never touch the model.
 *
 * Crew state lives on disk (team dir under the project, profiles under the
 * user home), so reading it is pure filesystem work. Routing those reads
 * through the pi_messenger tool forced every query through a model turn:
 * a missing API key turned "list the roles" into a hard failure, and a
 * present one burned tokens on data the CLI already had. This command is
 * the local path; the tool keeps the mutating/orchestrating actions.
 */

import * as teamStore from "./crew/team/store.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@linxiraos/zeta";

/** Render a fixed-width table without pulling a table dependency. */
function twoCol(rows: Array<[string, string]>, gap = 2): string {
	if (rows.length === 0) return "(none)";
	const width = Math.max(...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `${left.padEnd(width + gap)}${right}`).join("\n");
}

function profiles(cwd: string): string {
	const active = teamStore.getActiveTeam(cwd);
	const saved = teamStore.listProfiles();
	const lines = [
		`Active team: ${active ? `${active.name} (profile: ${active.profile ?? "default"})` : "(none — run /team setup <name>)"}`,
		"",
		"Profiles:",
		twoCol(saved.map(profile => [profile.name, profile.description ?? ""] as [string, string])),
	];
	return lines.join("\n");
}

function roles(cwd: string): string {
	const resolved = teamStore.resolveRoles(cwd);
	const rows = Object.values(resolved)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(role => [role.name, role.description ?? ""] as [string, string]);
	return `Roles (${rows.length}):\n${twoCol(rows)}`;
}

function status(cwd: string): string {
	const team = teamStore.getActiveTeam(cwd);
	if (!team) return "No active team in this project. Activate one with /team setup <name>.";
	const profile = teamStore.loadActiveProfile(cwd);
	const counts = teamStore.memoryCounts(cwd);
	const memory = Object.entries(counts)
		.map(([type, count]) => `${type}=${count}`)
		.join(" ");
	return [
		`Team: ${team.name}`,
		`Profile: ${team.profile ?? "default"}`,
		`Description: ${profile?.description ?? "(none)"}`,
		`Memory: ${memory || "(empty)"}`,
		`Charter: ${teamStore.readCharter(cwd) ? "set" : "(none)"}`,
	].join("\n");
}

function charter(cwd: string): string {
	const text = teamStore.readCharter(cwd);
	return text ?? "No charter yet. Create one with /team charter <text>.";
}

const SUBCOMMANDS: Record<string, { description: string; run: (cwd: string, rest: string) => string }> = {
	"profile.list": { description: "List team profiles and the active team", run: profiles },
	roles: { description: "List resolvable roles (built-in + profile overrides)", run: roles },
	status: { description: "Show active team, memory counts and charter state", run: status },
	"charter.show": { description: "Print the active team charter", run: charter },
};

/**
 * Register the local /team command. Safe to call on every extension load:
 * the runtime replaces a same-named registration.
 */
export function registerTeamCommand(pi: ExtensionAPI): void {
	pi.registerCommand("team", {
		description: "Local team/crew queries (no model turn)",
		getArgumentCompletions: prefix => {
			const token = prefix.trim().toLowerCase();
			const names = Object.keys(SUBCOMMANDS).filter(name => name.startsWith(token));
			if (names.length === 0) return null;
			return names.map(name => ({ value: `${name} `, label: name, description: SUBCOMMANDS[name].description }));
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (!sub) {
				const usage = Object.entries(SUBCOMMANDS)
					.map(([name, def]) => `  /team ${name.padEnd(14)} ${def.description}`)
					.join("\n");
				pi.sendMessage(
					{ customType: "team_query", content: `Usage:\n${usage}`, display: true },
					{ deliverAs: "aside" },
				);
				return;
			}
			const entry = SUBCOMMANDS[sub];
			if (!entry) {
				const known = Object.keys(SUBCOMMANDS).join(", ");
				pi.sendMessage(
					{ customType: "team_query", content: `Unknown subcommand: ${sub}\nKnown: ${known}`, display: true },
					{ deliverAs: "aside" },
				);
				return;
			}
			let output: string;
			try {
				output = entry.run(ctx.cwd, rest.join(" "));
			} catch (err) {
				output = `Failed to read team state: ${err instanceof Error ? err.message : String(err)}`;
			}
			// triggerTurn stays false: this is a local read, the model has nothing to add.
			pi.sendMessage({ customType: "team_query", content: output, display: true }, { deliverAs: "aside" });
		},
	});
}
