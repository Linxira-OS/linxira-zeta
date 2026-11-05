/**
 * Studio operations — plan mode and plan review.
 *
 * Owned operations (the A-class part of the spec's `mode` family), and the
 * gateway route each one drives:
 * - `mode.plan.enter` → `POST /api/agent/:id` `{ type: "enter_plan_mode" }`.
 * - `mode.plan.exit` → `POST /api/agent/:id` `{ type: "mode_exit", mode: "plan" }`.
 * - `mode.plan.review.open` → `GET /api/agent/:id` for the armed plan path, then
 *   `GET /api/plan` to prove that whitelisted plan document is readable.
 * - `mode.plan.review.respond` → `POST /api/agent/:id` `plan_approve` for the
 *   approval decisions (`execute` → `fresh`, `keep`/`approve` → `preserve`,
 *   `compact` → `compact`, `dismiss` → `cancel`) and a plain `prompt` for
 *   `refine`, which is the TUI's own refine semantics: feedback delivered while
 *   plan mode stays armed, so the agent revises the plan.
 *
 * `mode.plan.exit` accepts the contract's `discardDraft`, but Zeta keeps the
 * plan file and has no delete route: the exit runs (it is the renderer's only
 * way out of plan mode) and the surviving draft is a reported limitation, not
 * a silent delete.
 *
 * Deliberately omitted:
 * - `mode.plan.review.saveAndQuit` — the operator picks a workspace-relative
 *   target, but no gateway route writes one: `/api/files/*`, `/api/cwd/*` and
 *   `/api/file-index` are Next-owned (`NEXT_OWNED_API_PREFIXES`), so
 *   `webGatewayFetch` never answers them, and the only writable gateway path
 *   (`PUT /api/sessions/:id/artifacts/:name`) writes the session artifact root,
 *   not the target. Saving somewhere else would misreport `path`, so the
 *   operation stays unadvertised instead of silently lying.
 * - `mode.vibe.enter` / `mode.vibe.exit` — C class in the host spec: Zeta has
 *   no vibe backend.
 *
 * The contract's mode inputs carry no session id, so every handler targets the
 * serve process's shared session (`GET /api/agent/current`) — the session
 * `zetacode attach` and the default web chat drive. Command results are
 * `undefined`: the command transport acknowledges with 202 and the renderer
 * follows the session event feed, so synthesizing an `OperatorStateSnapshot`
 * here would be invented state.
 */
import { isRecord, stringProperty } from "@linxiraos/pi-utils/type-guards";
import type { CommandInput } from "../contract/index.js";
import { gatewayJson, invalid, segment, unavailable } from "../gateway.js";
import type { StudioFamily } from "../registry.js";

const CURRENT_AGENT_ROUTE = "/api/agent/current";
const PLAN_ROUTE = "/api/plan";

/** Studio plan decision → Zeta `plan_approve` mode. `approve` is the keep alias. */
const APPROVAL_MODES = {
	execute: "fresh",
	keep: "preserve",
	approve: "preserve",
	compact: "compact",
} as const;

/** A non-empty string field of a narrowed JSON object, or `undefined`. */
function textField(record: object, field: string): string | undefined {
	const value = stringProperty(record, field);
	return value === undefined || value === "" ? undefined : value;
}

/**
 * The serve process's shared session, resolved by the gateway. A missing
 * shared session is a gateway 404, which `gatewayJson` reports as
 * `unavailable`; an unreadable payload is refused here.
 */
async function sharedSessionId(): Promise<string> {
	const payload = await gatewayJson<unknown>(CURRENT_AGENT_ROUTE);
	const sessionId = isRecord(payload) ? textField(payload, "sessionId") : undefined;
	if (sessionId === undefined) throw unavailable(`${CURRENT_AGENT_ROUTE} returned no session id`);
	return sessionId;
}

/**
 * The plan file of a session whose plan mode is armed, read from the gateway's
 * `get_state` answer. Plan review only exists while plan mode holds a plan.
 */
async function reviewingPlanFilePath(sessionId: string): Promise<string> {
	const payload = await gatewayJson<unknown>(`/api/agent/${segment(sessionId)}`);
	if (!isRecord(payload) || payload.running !== true) throw unavailable("the shared session is not running");
	const state = payload.state;
	if (!isRecord(state) || state.planModeEnabled !== true) {
		throw unavailable("no plan review is open: plan mode is not active for the shared session");
	}
	const planFilePath = textField(state, "planFilePath");
	if (planFilePath === undefined) throw unavailable("the session's plan mode has no plan file");
	return planFilePath;
}

/** The plan document, read through the gateway's whitelisted plan route. */
async function readPlanContent(sessionId: string, planFilePath: string): Promise<string> {
	const payload = await gatewayJson<unknown>(PLAN_ROUTE, {
		query: `session=${segment(sessionId)}&path=${segment(planFilePath)}`,
	});
	const content = isRecord(payload) ? stringProperty(payload, "content") : undefined;
	if (typeof content !== "string") throw unavailable(`${PLAN_ROUTE} returned an unexpected payload`);
	return content;
}

/** Send one agent command and require the gateway's success envelope. */
async function agentCommand(sessionId: string, command: Readonly<Record<string, unknown>>): Promise<unknown> {
	const payload = await gatewayJson<unknown>(`/api/agent/${segment(sessionId)}`, { method: "POST", body: command });
	if (!isRecord(payload) || payload.success !== true) {
		throw unavailable("the gateway did not acknowledge the agent command");
	}
	return payload.data;
}

/** The gateway's own sentence when `plan_approve` answered without approving. */
function approvalFailure(answer: unknown): string {
	const error = isRecord(answer) ? textField(answer, "error") : undefined;
	return `plan approval did not run${error === undefined ? "" : `: ${error}`}`;
}

/**
 * `mode.plan.enter` → `POST /api/agent/:id` `enter_plan_mode`. The optional
 * prompt is delivered by Zeta itself (including the re-entry case, where the
 * mode half is a no-op but the task still reaches the agent).
 */
async function enterPlan(input: CommandInput<"mode.plan.enter">): Promise<undefined> {
	const sessionId = await sharedSessionId();
	await agentCommand(
		sessionId,
		input.initialPrompt === undefined
			? { type: "enter_plan_mode" }
			: { type: "enter_plan_mode", initialPrompt: input.initialPrompt },
	);
	return undefined;
}

/**
 * `mode.plan.exit` → `POST /api/agent/:id` `mode_exit` for `plan`.
 *
 * The Studio renderer always sends `discardDraft: true`, but Zeta keeps the
 * plan file and exposes no route that deletes it, so the flag cannot be
 * honored. Failing the exit would strand plan mode (the mode picker has no
 * other exit path); the plan file therefore survives, and the limitation is
 * reported instead of faking a delete.
 */
async function exitPlan(): Promise<undefined> {
	const sessionId = await sharedSessionId();
	await agentCommand(sessionId, { type: "mode_exit", mode: "plan" });
	return undefined;
}

/**
 * `mode.plan.review.open` → `GET /api/agent/:id` + `GET /api/plan`.
 *
 * Zeta has no route that raises a review overlay in another client — its
 * review card is emitted by the propose tool (`plan_proposed`) — so the honest
 * action here is to confirm the armed plan is still readable through the
 * gateway's whitelisted plan route. The renderer already holds the document it
 * renders; a 404 or unreadable plan therefore surfaces as `unavailable`
 * instead of opening an empty review.
 */
async function openReview(): Promise<undefined> {
	const sessionId = await sharedSessionId();
	await readPlanContent(sessionId, await reviewingPlanFilePath(sessionId));
	return undefined;
}

/**
 * `mode.plan.review.respond` → `POST /api/agent/:id` `plan_approve` / `prompt`.
 *
 * `execute` starts a fresh conversation (`fresh`), `keep`/`approve` preserve the
 * transcript (`preserve`), `compact` distills it first (`compact`), and
 * `dismiss` leaves plan mode untouched through Zeta's documented `cancel`
 * no-op branch. `refine` is not an approval: its feedback becomes the next
 * plan-mode turn, exactly as the TUI's plan review does it.
 */
async function respondToReview(input: CommandInput<"mode.plan.review.respond">): Promise<undefined> {
	const sessionId = await sharedSessionId();
	const planFilePath = await reviewingPlanFilePath(sessionId);
	if (input.decision === "refine") {
		const feedback = input.feedback?.trim() ?? "";
		if (feedback === "") throw invalid("refine requires feedback text");
		await agentCommand(sessionId, { type: "prompt", message: feedback });
		return undefined;
	}
	if (input.decision === "dismiss") {
		await agentCommand(sessionId, { type: "plan_approve", planFilePath, mode: "cancel" });
		return undefined;
	}
	const answer = await agentCommand(sessionId, {
		type: "plan_approve",
		planFilePath,
		mode: APPROVAL_MODES[input.decision],
	});
	if (!isRecord(answer) || answer.approved !== true) throw unavailable(approvalFailure(answer));
	return undefined;
}

/** Plan family: plan-mode transitions and plan-review decisions. */
export const planOps: StudioFamily = {
	id: "plan",
	commands: {
		"mode.plan.enter": enterPlan,
		"mode.plan.exit": exitPlan,
		"mode.plan.review.open": openReview,
		"mode.plan.review.respond": respondToReview,
	},
};
