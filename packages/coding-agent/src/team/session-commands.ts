/**
 * In-session `/team` subcommands. Users mostly stay in one conversation and
 * type slash commands, so persona and TeamPlan work must not require the
 * full `zetacode team ...` CLI grammar.
 */
import * as path from "node:path";
import { deleteTeamPersona, listTeamPersonas, readTeamPersona, writeTeamPersona } from "./personas";
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
		const [personas, plans] = await Promise.all([
			listTeamPersonas(location.teamRoot),
			listTeamPlans(location.teamRoot),
		]);
		return {
			ok: true,
			text: [
				`Team · ${location.teamName} (${location.teamId})`,
				`Root · ${location.teamRoot}`,
				`Personas · ${personas.personas.length}`,
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
				return { ok: true, text: `Imported persona ${persona.id} revision ${persona.revision}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		if (action === "remove") {
			const id = parts[0];
			if (!id) return fail("Usage: /team persona remove <id>");
			return (await deleteTeamPersona(location.teamRoot, id))
				? { ok: true, text: `Removed persona ${id}.` }
				: fail(`Unknown Team persona "${id}"`);
		}
		return fail("Usage: /team persona <list|show|create|import|remove>");
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
				return { ok: true, text: `TeamPlan ${next.id} is now ${next.status}.` };
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		}
		return fail("Usage: /team plan <list|show|create|import|submit|approve|reject|start|complete|cancel>");
	}
	return fail("Usage: /team <status|persona|plan|hub|on|off>");
}
