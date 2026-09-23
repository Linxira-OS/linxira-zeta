/**
 * /teamagent — register crew/team roles as spawnable subagents.
 *
 * Team roles live in the crew store as labels plus a prompt
 * (TeamRoleDefinition: name/description/thinking/skills). That shape cannot
 * be spawned: the task dispatch path needs an AgentDefinition, which requires
 * tools/spawns/model and a system prompt. Rather than grow a second registry,
 * this command writes the role into the standard agents directory
 * (`<project>/.zeta/agents/` or `~/.zeta/agents/`), where discovery already
 * looks — project scope first, then user, then plugin packages.
 *
 * Scope defaults to project so a team definition travels with the repository;
 * `--user` writes the global directory instead. A file per agent is the
 * on-disk format the parser expects, so removal is just an unlink.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@linxiraos/zeta";
import * as teamStore from "./crew/team/store.ts";

/** Reserved names the agent parser rejects; mirrored so we fail early. */
const RESERVED_NAMES = new Set(["main", "sub"]);

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface TeamAgentScope {
	/** "project" = <cwd>/.zeta/agents, "user" = ~/.zeta/agents. */
	kind: "project" | "user";
	dir: string;
}

/** Resolve the target directory for a scope. */
export function resolveAgentsDir(scope: "project" | "user", cwd: string): TeamAgentScope {
	if (scope === "user") {
		const home = process.env.ZETA_CONFIG_DIR ?? path.join(os.homedir(), ".zeta");
		return { kind: "user", dir: path.join(home, "agents") };
	}
	return { kind: "project", dir: path.join(path.resolve(cwd), ".zeta", "agents") };
}

function agentFilePath(dir: string, name: string): string {
	return path.join(dir, `${name}.md`);
}

/** Quote a YAML scalar/sequence safely (JSON syntax is valid YAML flow). */
function yamlString(value: string | string[]): string {
	return JSON.stringify(value);
}

/**
 * Render an agent markdown file from a role. Only fields the role actually
 * carries are emitted — the parser treats absent keys as "unset", and writing
 * empty defaults would silently pin behaviour the role never asked for.
 */
export function renderAgentMarkdown(role: {
	name: string;
	description: string;
	model?: string;
	thinking?: string;
	skills?: string[];
	prompt?: string;
}): string {
	const lines: string[] = ["---", `name: ${yamlString(role.name)}`, `description: ${yamlString(role.description)}`];
	if (role.model) lines.push(`model: ${yamlString(role.model)}`);
	if (role.thinking) lines.push(`thinking-level: ${yamlString(role.thinking)}`);
	if (role.skills && role.skills.length > 0) lines.push(`autoloadSkills: ${yamlString(role.skills)}`);
	lines.push("---", "");
	lines.push(role.prompt?.trim() || `You are the ${role.name} role. ${role.description}`);
	return `${lines.join("\n")}\n`;
}

export interface AddResult {
	ok: boolean;
	message: string;
	filePath?: string;
}

/** Write one role as an agent file. Refuses reserved/invalid names up front. */
export function addTeamAgent(
	role: { name: string; description: string; model?: string; thinking?: string; skills?: string[]; prompt?: string },
	scope: "project" | "user",
	cwd: string,
): AddResult {
	const name = role.name.trim().toLowerCase();
	if (!NAME_PATTERN.test(name)) {
		return { ok: false, message: `Invalid agent name "${role.name}". Use lowercase letters, digits and hyphens.` };
	}
	if (RESERVED_NAMES.has(name)) {
		return { ok: false, message: `"${name}" is reserved by the runtime and cannot be an agent name.` };
	}
	if (!role.description.trim()) {
		return { ok: false, message: "A description is required (the dispatch path matches on it)." };
	}
	const { dir } = resolveAgentsDir(scope, cwd);
	const filePath = agentFilePath(dir, name);
	if (fs.existsSync(filePath)) {
		return { ok: false, message: `${name} already exists at ${filePath}. Remove it first to replace it.` };
	}
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, renderAgentMarkdown({ ...role, name }), "utf8");
	return { ok: true, message: `Registered ${name} (${scope} scope)`, filePath };
}

/** Remove an agent file from a scope. */
export function removeTeamAgent(name: string, scope: "project" | "user", cwd: string): AddResult {
	const normalized = name.trim().toLowerCase();
	const { dir } = resolveAgentsDir(scope, cwd);
	const filePath = agentFilePath(dir, normalized);
	if (!fs.existsSync(filePath)) {
		return { ok: false, message: `No ${scope}-scope agent named ${normalized} (looked in ${dir}).` };
	}
	fs.rmSync(filePath);
	return { ok: true, message: `Removed ${normalized} (${scope} scope)` };
}

/** List agent files in a scope. */
export function listTeamAgents(scope: "project" | "user", cwd: string): string[] {
	const { dir } = resolveAgentsDir(scope, cwd);
	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter(f => f.endsWith(".md"))
		.map(f => f.slice(0, -3))
		.sort();
}

function twoCol(rows: Array<[string, string]>, gap = 2): string {
	if (rows.length === 0) return "(none)";
	const width = Math.max(...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `${left.padEnd(width + gap)}${right}`).join("\n");
}

function profiles(cwd: string): string {
	const active = teamStore.getActiveTeam(cwd);
	const saved = teamStore.listProfiles();
	const lines = [
		`Active team: ${active ? `${active.name} (profile: ${active.profile ?? "default"})` : "(none — run /teamagent setup <name>)"}`,
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
	if (!team) return "No active team in this project. Activate one with /teamagent setup <name>.";
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
	return text ?? "No charter yet. Create one with /teamagent charter <text>.";
}

const SUBCOMMANDS: Record<string, { description: string; run: (cwd: string, rest: string) => string }> = {
	"profile.list": { description: "List team profiles and the active team", run: profiles },
	roles: { description: "List resolvable roles (built-in + profile overrides)", run: roles },
	status: { description: "Show active team, memory counts and charter state", run: status },
	"charter.show": { description: "Print the active team charter", run: charter },
};

/** Registered slash command: /teamagent <add|list|remove> … */
export function registerTeamAgentCommand(pi: ExtensionAPI): void {
	pi.registerCommand("teamagent", {
		description: "Register crew roles as spawnable subagents (project or user scope)",
		getArgumentCompletions: prefix => {
			const token = prefix.trim().toLowerCase();
			const verbs = ["roles", "status", "profile.list", "charter.show", "agents", "add", "remove"].filter(v =>
				v.startsWith(token),
			);
			if (verbs.length === 0) return null;
			return verbs.map(v => ({ value: `${v} `, label: v }));
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const reply = (text: string) =>
				pi.sendMessage({ customType: "teamagent_result", content: text, display: true }, { deliverAs: "aside" });

			if (!verb) {
				reply(
					[
						"Usage:",
						"  /teamagent roles                 list crew roles",
						"  /teamagent status                active team, memory, charter",
						"  /teamagent profile.list         team profiles",
						"  /teamagent charter.show         print the charter",
						"  /teamagent agents               list registered subagents",
						"  /teamagent add <role> [--user]   register a crew role as a spawnable subagent",
						"  /teamagent remove <name> [--user]",
						"",
						"Default scope is the project (<cwd>/.zeta/agents); --user writes ~/.zeta/agents.",
					].join("\n"),
				);
				return;
			}

			const userScope = rest.includes("--user");
			const positional = rest.filter(a => a !== "--user" && a !== "--project");
			const scope = userScope ? "user" : "project";

			// Read-only team state first: these verbs predate agent registration
			// and answer from the crew store, not the agents directory.
			const readOnly = SUBCOMMANDS[verb];
			if (readOnly) {
				try {
					reply(readOnly.run(ctx.cwd, positional.join(" ")));
				} catch (err) {
					reply(`Failed to read team state: ${err instanceof Error ? err.message : String(err)}`);
				}
				return;
			}

			if (verb === "agents") {
				const projectAgents = listTeamAgents("project", ctx.cwd);
				const userAgents = listTeamAgents("user", ctx.cwd);
				reply(
					[
						`Project scope (${resolveAgentsDir("project", ctx.cwd).dir}):`,
						projectAgents.length ? projectAgents.map(a => `  ${a}`).join("\n") : "  (none)",
						"",
						`User scope (${resolveAgentsDir("user", ctx.cwd).dir}):`,
						userAgents.length ? userAgents.map(a => `  ${a}`).join("\n") : "  (none)",
					].join("\n"),
				);
				return;
			}

			if (verb === "add") {
				const roleName = positional[0];
				if (!roleName) {
					reply("Usage: /teamagent add <role> [--user]");
					return;
				}
				const role = teamStore.resolveRoles(ctx.cwd)[roleName];
				if (!role) {
					const known = Object.keys(teamStore.resolveRoles(ctx.cwd)).sort().join(", ");
					reply(`Unknown role "${roleName}". Known roles: ${known}`);
					return;
				}
				const result = addTeamAgent(
					{
						name: role.name,
						description: role.description ?? `${role.name} crew role`,
						model: role.model,
						thinking: role.thinking,
						skills: role.skills,
					},
					scope,
					ctx.cwd,
				);
				// The discovery cache is process-wide; a freshly written file is
				// not visible until it is refreshed, which only the runtime can
				// do. Say so instead of implying the agent is spawnable now.
				reply(
					result.ok
						? `${result.message} → ${result.filePath}\nRestart the session (or /reload-plugins) before spawning it.`
						: result.message,
				);
				return;
			}

			if (verb === "remove") {
				const name = positional[0];
				if (!name) {
					reply("Usage: /teamagent remove <name> [--user]");
					return;
				}
				const result = removeTeamAgent(name, scope, ctx.cwd);
				reply(result.message);
				return;
			}

			reply(`Unknown subcommand "${verb}". Use add, list or remove.`);
		},
	});
}
