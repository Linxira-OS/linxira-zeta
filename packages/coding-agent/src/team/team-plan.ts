/**
 * TeamPlan: a durable, independently-approved execution plan for a Team.
 * It is deliberately not the session Plan/Ask card: approval changes the Team
 * plan's own state and never rewrites the agent's prompt mode (ADR-0091).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const TEAM_PLAN_SCHEMA_VERSION = 1;
export const TEAM_PLAN_DIR = path.join(".zeta", "team-plans");

export type TeamPlanStatus =
	| "draft"
	| "awaiting_approval"
	| "approved"
	| "rejected"
	| "in_progress"
	| "done"
	| "cancelled";

export type TeamPlanAction = "submit" | "approve" | "reject" | "start" | "complete" | "cancel";

export interface TeamPlanItem {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly personaId?: string;
	readonly assignee?: string;
	readonly repo?: string;
	readonly dependsOn: readonly string[];
	readonly acceptance: readonly string[];
}

export interface TeamPlan {
	readonly schemaVersion: typeof TEAM_PLAN_SCHEMA_VERSION;
	readonly id: string;
	readonly revision: number;
	readonly teamId: string;
	readonly title: string;
	readonly summary?: string;
	readonly status: TeamPlanStatus;
	readonly createdBy: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly approvedBy?: string;
	readonly approvedAt?: number;
	readonly rejectedBy?: string;
	readonly rejectedAt?: number;
	readonly rejectionReason?: string;
	readonly items: readonly TeamPlanItem[];
}

export interface TeamPlanParseResult {
	readonly ok: boolean;
	readonly plan?: TeamPlan;
	readonly problems: readonly string[];
}

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const STATUSES: ReadonlySet<string> = new Set([
	"draft",
	"awaiting_approval",
	"approved",
	"rejected",
	"in_progress",
	"done",
	"cancelled",
]);

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): string[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of value) {
		if (!nonEmpty(entry)) return undefined;
		const text = entry.trim();
		if (seen.has(text)) return undefined;
		seen.add(text);
		out.push(text);
	}
	return out;
}

function parseItem(value: unknown, index: number, problems: string[]): TeamPlanItem | undefined {
	const item = record(value);
	if (!item) {
		problems.push(`items[${index}] must be an object`);
		return undefined;
	}
	const id = item.id;
	if (!nonEmpty(id) || !ID.test(id)) {
		problems.push(`items[${index}].id must be a lowercase slug`);
		return undefined;
	}
	if (!nonEmpty(item.title)) {
		problems.push(`item ${id}: title is required`);
		return undefined;
	}
	const dependsOn = stringList(item.dependsOn);
	const acceptance = stringList(item.acceptance);
	if (!dependsOn || !acceptance) {
		problems.push(`item ${id}: dependsOn/acceptance must be unique non-empty strings`);
		return undefined;
	}
	for (const key of ["personaId", "assignee", "repo"] as const) {
		const candidate = item[key];
		if (candidate !== undefined && !nonEmpty(candidate)) {
			problems.push(`item ${id}: ${key} must be a non-empty string when set`);
			return undefined;
		}
	}
	return {
		id: id.trim(),
		title: item.title.trim(),
		...(nonEmpty(item.description) ? { description: item.description.trim() } : {}),
		...(nonEmpty(item.personaId) ? { personaId: item.personaId.trim() } : {}),
		...(nonEmpty(item.assignee) ? { assignee: item.assignee.trim() } : {}),
		...(nonEmpty(item.repo) ? { repo: item.repo.trim() } : {}),
		dependsOn,
		acceptance,
	};
}

function verifyGraph(items: readonly TeamPlanItem[], problems: string[]): void {
	const ids = new Set(items.map(item => item.id));
	if (ids.size !== items.length) problems.push("item ids must be unique");
	for (const item of items) {
		for (const dependency of item.dependsOn) {
			if (!ids.has(dependency)) problems.push(`item ${item.id}: unknown dependency ${dependency}`);
			if (dependency === item.id) problems.push(`item ${item.id}: cannot depend on itself`);
		}
	}
	// Kahn's algorithm; a remaining node is part of a cycle.
	const indegree = new Map(items.map(item => [item.id, item.dependsOn.length]));
	const byDependency = new Map<string, string[]>();
	for (const item of items) {
		for (const dependency of item.dependsOn) {
			const list = byDependency.get(dependency) ?? [];
			list.push(item.id);
			byDependency.set(dependency, list);
		}
	}
	const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
	let visited = 0;
	while (queue.length > 0) {
		const id = queue.shift()!;
		visited++;
		for (const dependent of byDependency.get(id) ?? []) {
			const next = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, next);
			if (next === 0) queue.push(dependent);
		}
	}
	if (visited !== items.length) problems.push("item dependencies contain a cycle");
}

export function parseTeamPlan(value: unknown): TeamPlanParseResult {
	const input = record(value);
	if (!input) return { ok: false, problems: ["Team plan must be an object"] };
	const problems: string[] = [];
	if (input.schemaVersion !== TEAM_PLAN_SCHEMA_VERSION)
		problems.push(`schemaVersion must be ${TEAM_PLAN_SCHEMA_VERSION}`);
	if (!nonEmpty(input.id) || !ID.test(input.id)) problems.push("id must be a lowercase slug");
	if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1)
		problems.push("revision must be a positive integer");
	if (!nonEmpty(input.teamId)) problems.push("teamId is required");
	if (!nonEmpty(input.title)) problems.push("title is required");
	if (!nonEmpty(input.createdBy)) problems.push("createdBy is required");
	if (!Number.isFinite(input.createdAt)) problems.push("createdAt must be a timestamp");
	if (!Number.isFinite(input.updatedAt)) problems.push("updatedAt must be a timestamp");
	if (typeof input.status !== "string" || !STATUSES.has(input.status)) problems.push("status is invalid");
	if (!Array.isArray(input.items) || input.items.length === 0) problems.push("items must be a non-empty array");
	const items: TeamPlanItem[] = [];
	if (Array.isArray(input.items)) {
		for (const [index, entry] of input.items.entries()) {
			const item = parseItem(entry, index, problems);
			if (item) items.push(item);
		}
	}
	if (items.length > 0) verifyGraph(items, problems);
	for (const key of ["approvedBy", "rejectedBy", "rejectionReason"] as const) {
		if (input[key] !== undefined && !nonEmpty(input[key]))
			problems.push(`${key} must be a non-empty string when set`);
	}
	for (const key of ["approvedAt", "rejectedAt"] as const) {
		if (input[key] !== undefined && !Number.isFinite(input[key]))
			problems.push(`${key} must be a timestamp when set`);
	}
	if (problems.length > 0) return { ok: false, problems };
	return {
		ok: true,
		problems: [],
		plan: {
			schemaVersion: TEAM_PLAN_SCHEMA_VERSION,
			id: (input.id as string).trim(),
			revision: input.revision as number,
			teamId: (input.teamId as string).trim(),
			title: (input.title as string).trim(),
			...(nonEmpty(input.summary) ? { summary: input.summary.trim() } : {}),
			status: input.status as TeamPlanStatus,
			createdBy: (input.createdBy as string).trim(),
			createdAt: input.createdAt as number,
			updatedAt: input.updatedAt as number,
			...(nonEmpty(input.approvedBy) ? { approvedBy: input.approvedBy.trim() } : {}),
			...(Number.isFinite(input.approvedAt) ? { approvedAt: input.approvedAt as number } : {}),
			...(nonEmpty(input.rejectedBy) ? { rejectedBy: input.rejectedBy.trim() } : {}),
			...(Number.isFinite(input.rejectedAt) ? { rejectedAt: input.rejectedAt as number } : {}),
			...(nonEmpty(input.rejectionReason) ? { rejectionReason: input.rejectionReason.trim() } : {}),
			items,
		},
	};
}

const TRANSITIONS: Readonly<Record<TeamPlanStatus, Partial<Record<TeamPlanAction, TeamPlanStatus>>>> = {
	draft: { submit: "awaiting_approval", cancel: "cancelled" },
	awaiting_approval: { approve: "approved", reject: "rejected", cancel: "cancelled" },
	approved: { start: "in_progress", cancel: "cancelled" },
	in_progress: { complete: "done", cancel: "cancelled" },
	rejected: {},
	done: {},
	cancelled: {},
};

export function advanceTeamPlan(
	plan: TeamPlan,
	action: TeamPlanAction,
	actor: string,
	options: { readonly at?: number; readonly reason?: string } = {},
): TeamPlan {
	const next = TRANSITIONS[plan.status][action];
	if (!next) throw new Error(`Team plan ${plan.id} cannot ${action} from ${plan.status}`);
	const at = options.at ?? Date.now();
	const base: TeamPlan = {
		...plan,
		revision: plan.revision + 1,
		status: next,
		updatedAt: at,
	};
	switch (action) {
		case "approve":
			return { ...base, approvedBy: actor, approvedAt: at };
		case "reject":
			if (!options.reason?.trim()) throw new Error("Rejecting a Team plan requires a reason");
			return { ...base, rejectedBy: actor, rejectedAt: at, rejectionReason: options.reason.trim() };
		default:
			return base;
	}
}

export function teamPlanDir(teamRoot: string): string {
	return path.join(teamRoot, TEAM_PLAN_DIR);
}

function planFile(teamRoot: string, id: string): string {
	return path.join(teamPlanDir(teamRoot), `${id}.json`);
}

function contained(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function writeTeamPlan(teamRoot: string, value: unknown): Promise<TeamPlan> {
	const parsed = parseTeamPlan(value);
	if (!parsed.ok || !parsed.plan) throw new Error(`Invalid Team plan: ${parsed.problems.join("; ")}`);
	const dir = teamPlanDir(teamRoot);
	const file = planFile(teamRoot, parsed.plan.id);
	if (!contained(dir, file)) throw new Error("Team plan path escapes the Team root");
	await fs.mkdir(dir, { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(parsed.plan, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(temp, file);
	return parsed.plan;
}

export async function readTeamPlan(teamRoot: string, id: string): Promise<TeamPlan | undefined> {
	const file = planFile(teamRoot, id);
	if (!contained(teamPlanDir(teamRoot), file)) return undefined;
	try {
		const parsed = parseTeamPlan(JSON.parse(await fs.readFile(file, "utf8")));
		return parsed.ok ? parsed.plan : undefined;
	} catch {
		return undefined;
	}
}
