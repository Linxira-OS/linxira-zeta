/**
 * In-session `/team` subcommands. Users mostly stay in one conversation and
 * type slash commands, so persona and TeamPlan work must not require the
 * full `zetacode team ...` CLI grammar.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { auditTeamQuietly } from "./audit";
import { appendTeamMemory, listTeamMemory, readTeamMemory } from "./memory";
import { promotePersonaPluginPack, readPersonaPluginSource } from "./plugin-pack";
import { deleteTeamPersona, listTeamPersonas, readTeamPersona, writeTeamPersona } from "./personas";
import { readTeamProfile, writeTeamProfile, type TeamProfile } from "./profile";
import { resolveTeamLocation } from "./paths";
import {
	advanceTeamPlan,
	listTeamPlans,
	readTeamPlan,
	writeTeamPlan,
	type TeamPlanAction,
	type TeamPlanStatus,
} from "./team-plan";

export interface TeamSessionCommandResult {
	readonly ok: boolean;
	readonly text: string;
}

function words(args: string): string[] {
	return args.trim().split(/\s+/).filter(Boolean);
}

function fail(message: string): TeamSessionCommandResult {
	return { ok: false, text: message };
}

function audit(
	teamRoot: string,
	teamId: string,
	event: { action: string; personaId?: string; planId?: string; detail?: string },
) {
	return auditTeamQuietly(teamRoot, { teamId, agentId: "Main", outcome: "ok", ...event });
}

const PLAN_ACTIONS: ReadonlySet<string> = new Set(["submit", "approve", "reject", "start", "complete", "cancel"]);

function planLines(
	status: TeamPlanStatus,
	plan: { id: string; title: string; revision: number; items: readonly unknown[] },
): string {
	return `/team plan ${plan.id} · ${status} · rev ${plan.revision} · ${plan.items.length} items · ${plan.title}`;
}

/** Execute one `/team <sub> ...` invocation for the current project directory. */
export async function runTeamSessionCommand(cwd: string, args: string): Promise<TeamSessionCommandResult> {
	const parts = words(args);
	const sub = parts.shift()?.toLowerCase() ?? "status";
	const location = await resolveTeamLocation(cwd);
	if (!location) return fail("No Team root here. Run /team in a Team workspace or use `zetacode team init`.");
	if (sub === "status") {
		const [personas, plans, profile, memory] = await Promise.all([
			listTeamPersonas(location.teamRoot),
			listTeamPlans(location.teamRoot),
			readTeamProfile(location.teamRoot, location.teamId),
			listTeamMemory(location.teamRoot),
		]);
		return {
			ok: true,
			text: [
				`Team · ${location.teamName} (${location.teamId})`,
				`Root · ${location.teamRoot}`,
				`Personas · ${personas.personas.length}`,
				`Default persona · ${profile.defaultPersonaId ?? "none"}`,
				`Team memory · ${memory.length} scopes`,
				`TeamPlans · ${plans.plans.length}`,
			].join("\n"),
		};
	}
	if (sub === "persona") {
		const action = parts.shift()?.toLowerCase() ?? "list";
		if (action === "list") {
			const result = await listTeamPersonas(location.teamRoot);
			const lines = result.personas.map(persona => `${persona.id} · ${persona.role} · ${persona.name}`);
			return {
				ok: true,
				text: [
					`Personas · ${result.personas.length}`,
					...lines,
					...result.problems.map(problem => `Warning: ${problem}`),
				].join("\n"),
			};
		}
		if (action === "show") {
			const id = parts[0];
			if (!id) return fail("Usage: /team persona show <id>");
			const persona = await readTeamPersona(location.teamRoot, id);
			return persona ? { ok: true, text: JSON.stringify(persona, null, 2) } : fail(`Unknown Team persona "${id}"`);
		}
		if (action === "create") {
			const [id, role, ...name] = parts;
			if (!id || !role) return fail("Usage: /team persona create <id> <role> [display name]");
			try {
				const persona = await writeTeamPersona(location.teamRoot, {
					schemaVersion: 1,
					id,
					revision: 1,
					name: name.join(" ") || id,
					role,
					permissions: {},
					memoryScope: "team",
				});
				await audit(location.teamRoot, location.teamId, { action: "persona.create", personaId: persona.id });
				return { ok: true, text: `Created persona ${persona.id} (${persona.role}).` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "import") {
			const file = parts[0];
			if (!file) return fail("Usage: /team persona import <file>");
			try {
				const value = await Bun.file(path.resolve(cwd, file)).json();
				const persona = await writeTeamPersona(location.teamRoot, value);
				await audit(location.teamRoot, location.teamId, { action: "persona.import", personaId: persona.id });
				return { ok: true, text: `Imported persona ${persona.id} revision ${persona.revision}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "pack") {
			const id = parts[0];
			if (!id) return fail("Usage: /team persona pack <id>");
			const pack = await readTeamPersona(location.teamRoot, id);
			if (!pack) return fail(`Unknown Team persona "${id}"`);
			try {
				const source = await readPersonaPluginSource(location.teamRoot, pack);
				return { ok: true, text: `Plugin pack ${source.files.length} files · ${source.hash}` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "promote") {
			const id = parts[0];
			const target = parts[1];
			if (!id || !target) return fail("Usage: /team persona promote <id> <empty target dir>");
			const pack = await readTeamPersona(location.teamRoot, id);
			if (!pack) return fail(`Unknown Team persona "${id}"`);
			try {
				const promoted = await promotePersonaPluginPack(location.teamRoot, pack, path.resolve(cwd, target));
				await audit(location.teamRoot, location.teamId, { action: "persona.promote", personaId: id });
				return { ok: true, text: `Promoted ${promoted.files.length} files to ${promoted.target}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "remove") {
			const id = parts[0];
			if (!id) return fail("Usage: /team persona remove <id>");
			if (!(await deleteTeamPersona(location.teamRoot, id))) return fail(`Unknown Team persona "${id}"`);
			await audit(location.teamRoot, location.teamId, { action: "persona.remove", personaId: id });
			return { ok: true, text: `Removed persona ${id}.` };
		}
		return fail("Usage: /team persona <list|show|create|import|pack|promote|remove>");
	}
	if (sub === "plan") {
		const action = parts.shift()?.toLowerCase() ?? "list";
		if (action === "list") {
			const result = await listTeamPlans(location.teamRoot);
			return {
				ok: true,
				text: [
					`TeamPlans · ${result.plans.length}`,
					...result.plans.map(plan => planLines(plan.status, plan)),
					...result.problems.map(problem => `Warning: ${problem}`),
				].join("\n"),
			};
		}
		if (action === "show") {
			const id = parts[0];
			if (!id) return fail("Usage: /team plan show <id>");
			const plan = await readTeamPlan(location.teamRoot, id);
			return plan ? { ok: true, text: JSON.stringify(plan, null, 2) } : fail(`Unknown TeamPlan "${id}"`);
		}
		if (action === "create") {
			const [id, ...title] = parts;
			if (!id || title.length === 0) return fail("Usage: /team plan create <id> <title>");
			const now = Date.now();
			try {
				const plan = await writeTeamPlan(location.teamRoot, {
					schemaVersion: 1,
					id,
					revision: 1,
					teamId: location.teamId,
					title: title.join(" "),
					status: "draft",
					createdBy: "Main",
					createdAt: now,
					updatedAt: now,
					items: [{ id: "main", title: title.join(" "), dependsOn: [], acceptance: [] }],
				});
				await audit(location.teamRoot, location.teamId, { action: "plan.create", planId: plan.id });
				return { ok: true, text: `Created TeamPlan ${plan.id}. Submit it with /team plan submit ${plan.id}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "import") {
			const file = parts[0];
			if (!file) return fail("Usage: /team plan import <file>");
			try {
				const raw = await Bun.file(path.resolve(cwd, file)).json();
				const now = Date.now();
				const plan = await writeTeamPlan(location.teamRoot, {
					...(typeof raw === "object" && raw !== null ? raw : {}),
					schemaVersion: 1,
					teamId: location.teamId,
					revision: 1,
					status: "draft",
					createdBy: "Main",
					createdAt: now,
					updatedAt: now,
				});
				await audit(location.teamRoot, location.teamId, { action: "plan.import", planId: plan.id });
				return { ok: true, text: `Imported TeamPlan ${plan.id} revision ${plan.revision}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (PLAN_ACTIONS.has(action)) {
			const id = parts[0];
			if (!id) return fail(`Usage: /team plan ${action} <id>${action === "reject" ? " [reason]" : ""}`);
			const plan = await readTeamPlan(location.teamRoot, id);
			if (!plan) return fail(`Unknown TeamPlan "${id}"`);
			const reason = parts.slice(1).join(" ");
			try {
				const next = advanceTeamPlan(plan, action as TeamPlanAction, "Main", {
					...(reason ? { reason } : {}),
				});
				await writeTeamPlan(location.teamRoot, next);
				await audit(location.teamRoot, location.teamId, { action: `plan.${action}`, planId: next.id });
				return { ok: true, text: `TeamPlan ${next.id} is now ${next.status}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		return fail("Usage: /team plan <list|show|create|import|submit|approve|reject|start|complete|cancel>");
	}
	if (sub === "profile") {
		const action = parts[0]?.toLowerCase() ?? "show";
		const current = await readTeamProfile(location.teamRoot, location.teamId);
		if (action === "show") {
			return { ok: true, text: JSON.stringify(current, null, 2) };
		}
		if (action === "persona") {
			const id = parts[1];
			if (!id) return fail("Usage: /team profile persona <id>");
			if (!(await readTeamPersona(location.teamRoot, id))) return fail(`Unknown Team persona "${id}"`);
			const next: TeamProfile = { ...current, defaultPersonaId: id, updatedAt: Date.now() };
			await writeTeamProfile(location.teamRoot, next);
			await audit(location.teamRoot, location.teamId, { action: "profile.persona", personaId: id });
			return { ok: true, text: `Default Team persona is now ${id}.` };
		}
		if (action === "liaison") {
			const agentId = parts[1];
			if (!agentId) return fail("Usage: /team profile liaison <agentId> [channel...]");
			const channels = parts.slice(2);
			await writeTeamProfile(location.teamRoot, {
				...current,
				externalLiaison: { agentId, channels, listen: true },
				updatedAt: Date.now(),
			});
			await audit(location.teamRoot, location.teamId, { action: "profile.liaison", detail: agentId });
			return {
				ok: true,
				text: `External liaison ${agentId} on ${channels.join(", ") || "no channels"} (listening).`,
			};
		}
		if (action === "listen") {
			const mode = parts[1]?.toLowerCase();
			if (!current.externalLiaison || (mode !== "on" && mode !== "off")) {
				return fail("Usage: /team profile listen <on|off> (set a liaison first)");
			}
			await writeTeamProfile(location.teamRoot, {
				...current,
				externalLiaison: { ...current.externalLiaison, listen: mode === "on" },
				updatedAt: Date.now(),
			});
			return { ok: true, text: `External liaison listening ${mode}.` };
		}
		return fail("Usage: /team profile [show|persona <id>|liaison <agentId> [channel...]|listen <on|off>]");
	}
	if (sub === "identity") {
		const action = parts[0]?.toLowerCase() ?? "show";
		const file = path.join(location.teamRoot, ".zeta", "identity.md");
		if (action === "show") {
			try {
				const text = await fs.readFile(file, "utf8");
				return text.trim() ? { ok: true, text } : fail("Team identity is empty.");
			} catch {
				return fail("No Team identity. Add one with /team identity set <text>.");
			}
		}
		if (action === "set") {
			const text = parts.slice(1).join(" ");
			if (!text) return fail("Usage: /team identity set <text>");
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, `${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
			await audit(location.teamRoot, location.teamId, { action: "identity.set" });
			return { ok: true, text: "Updated the Team identity layer. AGENTS.md is unchanged." };
		}
		return fail("Usage: /team identity [show|set <text>]");
	}
	if (sub === "memory") {
		const action = parts[0]?.toLowerCase() ?? "list";
		if (action === "list") {
			const keys = await listTeamMemory(location.teamRoot);
			return { ok: true, text: [`Team memory · ${keys.length} scopes`, ...keys].join("\n") };
		}
		if (action === "show") {
			const key = parts[1];
			if (!key) return fail("Usage: /team memory show <key>");
			const text = await readTeamMemory(location.teamRoot, key);
			return text === undefined ? fail(`No Team memory "${key}"`) : { ok: true, text };
		}
		if (action === "add") {
			const key = parts[1];
			const text = parts.slice(2).join(" ");
			if (!key || !text) return fail("Usage: /team memory add <key> <text>");
			try {
				await appendTeamMemory(location.teamRoot, key, text);
				return { ok: true, text: `Added Team memory ${key}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		return fail("Usage: /team memory <list|show|add>");
	}
	return fail("Usage: /team <status|persona|plan|profile|memory|identity|hub|on|off>");
}
