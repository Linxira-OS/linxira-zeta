/**
 * Deck ↔ Zeta gateway handlers.
 *
 * Each Studio operation the deck components use is answered by a Zeta endpoint
 * here; nothing re-creates the Studio protocol. Every operation the deck needs
 * is a command, so this module exports the command map only — the plan body
 * read is a plain helper in `plan-api.ts`, and no Studio *query* the deck
 * renders from has a Zeta equivalent. Two rules kept this file small:
 *
 * 1. **No receipts.** `StudioClientImpl` has no command reducer, so a Host
 *    receipt never arrives. Every handler performs its HTTP call *before*
 *    returning the handle, which makes `await client.command(...)` mean "the
 *    session applied it"; a failure throws instead of waiting 120 s.
 * 2. **No invented routes.** An operation with no Zeta equivalent stays out of
 *    the maps, so the client throws `UnsupportedStudioOperationError` and the
 *    surface that needed it is omitted rather than faked.
 *
 * Zeta endpoints used here:
 *   `POST /api/extension-ui/response` — `{ id, value|confirmed|cancelled|answers|decision }`
 *   `POST /api/agent/:id`             — `enter_plan_mode`, `mode_exit`, `plan_approve`, `prompt`
 *   `GET  /api/agent/:id`             — plan-mode state (`planModeEnabled`, `planFilePath`)
 *   `GET  /api/settings`              — `modelRoles`, for the execution-tier list
 *   `GET  /api/plan?session=&path=`   — see `plan-api.ts`
 */

import type { CommandHandler, StudioClientImpl } from "@/lib/studio-client";
import type {
	CommandHandle,
	CommandInput,
	CommandName,
	CommandRequestId,
	IdempotencyKey,
	InteractionResponseValue,
} from "@/lib/studio-protocol/contract";
import { fetchPlanState, type GetJson } from "./plan-api";

/** Studio's `interaction.respond` value for an `ask` interaction. */
interface AskSubmitPayload {
	readonly results: ReadonlyArray<{
		readonly id: string;
		readonly selectedOptions: readonly string[];
		readonly customInput?: string;
		readonly note?: string;
	}>;
}

function handle<TName extends CommandName>(commandName: TName): CommandHandle<TName> {
	return {
		commandName,
		requestId: crypto.randomUUID() as CommandRequestId,
		status: "local_pending",
		idempotencyKey: crypto.randomUUID() as IdempotencyKey,
		issuedAt: new Date().toISOString(),
	};
}

/**
 * `ClientInteraction` → the body `POST /api/extension-ui/response` accepts.
 *
 * Zeta's answerable dialog methods are `select` / `confirm` / `input` /
 * `editor` / `ask`. A Studio `approval` card has no Zeta channel yet, so its
 * answer is forwarded on the reserved `decision` field — which today has no
 * consumer in the gateway.
 */
export function extensionUiResponseBody(
	interactionId: string,
	decision: "submit" | "cancel",
	value?: InteractionResponseValue,
): Record<string, unknown> {
	if (decision === "cancel") return { id: interactionId, cancelled: true };
	if (typeof value === "boolean") return { id: interactionId, confirmed: value };
	if (typeof value === "string") return { id: interactionId, value };
	if (Array.isArray(value)) return { id: interactionId, value: value.join(",") };
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (Array.isArray(record.results)) {
			const payload = value as unknown as AskSubmitPayload;
			return {
				id: interactionId,
				answers: payload.results.map(answer => ({
					id: answer.id,
					selectedOptions: [...answer.selectedOptions],
					...(answer.customInput === undefined ? {} : { customInput: answer.customInput }),
					...(answer.note === undefined ? {} : { note: answer.note }),
				})),
			};
		}
		if (typeof record.grant === "string") {
			// Remembered-approval choice; the approval channel owns this shape.
			return {
				id: interactionId,
				decision: `grant:${record.grant}:${record.always === true ? "always" : "session"}`,
			};
		}
	}
	return { id: interactionId, decision: "submit" };
}

export function createDeckCommands(client: StudioClientImpl): Partial<Record<CommandName, CommandHandler>> {
	const get = client.get as GetJson;
	const sessionIdOf = (): string => {
		const sessionId = client.sessionId;
		if (!sessionId) throw new Error("No active agent session for this plan action");
		return sessionId;
	};
	const post = (sessionId: string, body: Record<string, unknown>): Promise<unknown> =>
		client.post(`/api/agent/${encodeURIComponent(sessionId)}`, body);

	return {
		"interaction.respond": (async (input: {
			interactionId: string;
			decision: "submit" | "cancel";
			value?: InteractionResponseValue;
		}) => {
			await client.post(
				"/api/extension-ui/response",
				extensionUiResponseBody(input.interactionId, input.decision, input.value),
			);
			return handle("interaction.respond");
		}) as unknown as CommandHandler,

		"mode.plan.enter": (async (input: CommandInput<"mode.plan.enter">) => {
			await post(sessionIdOf(), {
				type: "enter_plan_mode",
				...(input.initialPrompt ? { initialPrompt: input.initialPrompt } : {}),
			});
			return handle("mode.plan.enter");
		}) as unknown as CommandHandler,

		"mode.plan.exit": (async () => {
			await post(sessionIdOf(), { type: "mode_exit", mode: "plan" });
			return handle("mode.plan.exit");
		}) as unknown as CommandHandler,

		"mode.plan.review.respond": (async (input: CommandInput<"mode.plan.review.respond">) => {
			const sessionId = sessionIdOf();
			if (input.decision === "refine") {
				// Refine keeps plan mode open: the annotations become the next turn.
				if (input.feedback) await post(sessionId, { type: "prompt", message: input.feedback });
				return handle("mode.plan.review.respond");
			}
			const state = await fetchPlanState(sessionId, get);
			const planFilePath = state.planFilePath;
			if (typeof planFilePath !== "string" || planFilePath.length === 0) {
				throw new Error("No plan file to approve for this session");
			}
			await post(sessionId, {
				type: "plan_approve",
				planFilePath,
				mode:
					input.decision === "dismiss"
						? "cancel"
						: input.decision === "compact"
							? "compact"
							: input.decision === "execute"
								? "fresh"
								: "preserve",
			});
			return handle("mode.plan.review.respond");
		}) as unknown as CommandHandler,
	};
}

/**
 * The execution-tier picker's effect. Zeta resolves a role to a model with the
 * gateway's `set_model_role` command, so a host sends this *before* approving
 * the plan: the approval turn then runs on that model. Studio's role-scoped
 * `mode.plan.review.resolve` has no Zeta route.
 */
export function planExecutionRoleCommand(role: string): { type: "set_model_role"; role: string } {
	return { type: "set_model_role", role };
}
