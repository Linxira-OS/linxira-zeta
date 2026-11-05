/**
 * Plan review reads.
 *
 * Two consumers need the same three answers — is a plan awaiting review, what
 * execution tiers exist, what does the plan say — so the reads live here once:
 * the picker's hook (browser `fetch`) and the deck's command handlers (which
 * pass `StudioClientImpl.get`). Same endpoints, one implementation:
 *
 *   `GET /api/agent/:id`   plan-mode state (`planModeEnabled`, `planFilePath`, `currentModel`)
 *   `GET /api/settings`    the `modelRoles` entry, as the tier list
 *   `GET /api/plan`        the plan body, whitelisted to the session's plan file
 */

import type { NativePlanReview, PlanExecutionTier } from "@/lib/studio-protocol/protocol";

/** The subset of `fetch` / `StudioClientImpl.get` this module needs. */
export type GetJson = <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;

const defaultGet: GetJson = async <T,>(path: string, query?: Record<string, string | number | undefined>) => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined) params.set(key, String(value));
	}
	const suffix = params.size ? `?${params.toString()}` : "";
	const response = await fetch(`${path}${suffix}`, { cache: "no-store" });
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(payload.error ?? `${path}: HTTP ${response.status}`);
	}
	return (await response.json()) as T;
};

interface PlanStateResponse {
	planModeEnabled?: boolean;
	planFilePath?: string | null;
	currentModel?: { provider?: string; id?: string } | null;
}

interface SettingsEntry {
	path?: string;
	value?: unknown;
}

interface SettingsResponse {
	settings?: SettingsEntry[];
}

/** `modelRoles` value → execution tiers. A `provider/model:thinking` ref is split. */
export function planExecutionTiers(roles: Record<string, unknown>): PlanExecutionTier[] {
	const tiers: PlanExecutionTier[] = [];
	for (const [role, raw] of Object.entries(roles)) {
		if (typeof raw !== "string" || raw.trim().length === 0) continue;
		const ref = raw.trim();
		const slash = ref.indexOf("/");
		const provider = slash > 0 ? ref.slice(0, slash) : "";
		const modelRef = slash > 0 ? ref.slice(slash + 1) : ref;
		const thinkingAt = modelRef.lastIndexOf(":");
		const thinkingLevel = thinkingAt > 0 ? modelRef.slice(thinkingAt + 1) : undefined;
		const model = thinkingLevel === undefined ? modelRef : modelRef.slice(0, thinkingAt);
		tiers.push({ role, provider, model, name: model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) });
	}
	return tiers;
}

export async function fetchPlanState(
	sessionId: string,
	get: GetJson = defaultGet,
): Promise<PlanStateResponse> {
	return get<PlanStateResponse>(`/api/agent/${encodeURIComponent(sessionId)}`);
}

export async function fetchModelRoles(get: GetJson = defaultGet): Promise<Record<string, unknown>> {
	const settings = await get<SettingsResponse>("/api/settings").catch(() => ({ settings: [] }) as SettingsResponse);
	const entry = settings.settings?.find(row => row.path === "modelRoles");
	return entry?.value && typeof entry.value === "object" ? (entry.value as Record<string, unknown>) : {};
}

/** Plan-mode state + execution tiers, in the shape Studio's picker consumes. */
export async function fetchPlanReview(
	sessionId: string,
	get: GetJson = defaultGet,
): Promise<NativePlanReview> {
	const [state, roles] = await Promise.all([fetchPlanState(sessionId, get), fetchModelRoles(get)]);
	const tiers = planExecutionTiers(roles);
	const currentModelId = state.currentModel?.id;
	const selected = tiers.find(tier => tier.model === currentModelId)?.role;
	return {
		available: state.planModeEnabled === true && typeof state.planFilePath === "string",
		tiers,
		...(selected === undefined ? {} : { selectedRole: selected }),
	};
}

/** `GET /api/plan` — the current plan body. */
export async function fetchPlanBody(
	sessionId: string,
	planFilePath: string,
	get: GetJson = defaultGet,
): Promise<string> {
	const body = await get<{ content?: string }>("/api/plan", { session: sessionId, path: planFilePath });
	return body.content ?? "";
}

/** `planFilePath` as the review headline: `PLAN.md`, `feature-x.plan.md`, … */
export function planTitleFromPath(planFilePath: string): string {
	const name = planFilePath.split(/[\\/]/).pop() ?? planFilePath;
	return name.replace(/\.md$/i, "");
}
