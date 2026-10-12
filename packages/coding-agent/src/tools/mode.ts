import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { prompt } from "@linxiraos/pi-utils";
import modeDescription from "../prompts/tools/mode.md" with { type: "text" };
import type { ToolSession } from "./index";

const modeSchema = type({
	op: type('"enter" | "exit"').describe("enter: start the mode; exit: end a mode you started yourself"),
	mode: type('"plan" | "goal" | "vibe"').describe(
		"plan is the only mode you may enter or leave on your own; goal and vibe belong to the user",
	),
	"workflow?": type('"parallel" | "iterative" | "ultra"').describe(
		"plan entry only: parallel (default), iterative, or ultra planning",
	),
});

type ModeParams = typeof modeSchema.infer;

interface ModeToolDetails {
	op: "enter" | "exit";
	mode: "plan";
	workflow?: string;
}

/**
 * `goal` and `vibe` mode grant autonomy (budgeted autonomous pursuit, automatic
 * approval) that only the user can hand out, so the agent never enters or
 * leaves them — it asks. Plan mode only restricts, so the agent may arm it, and
 * it may disarm exactly the plan mode it armed itself: leaving a user-armed plan
 * mode would walk out of the approval gate the user put it behind.
 */
function refusal(mode: string, op: "enter" | "exit"): ToolError {
	return new ToolError(
		`You cannot ${op} ${mode} mode on your own: it grants autonomy only the user can grant. ` +
			`Ask the user to run \`/${mode}\` instead.`,
	);
}

/**
 * `mode` — the agent's own mode switch, under an asymmetric policy: it may
 * enter plan mode and leave the plan mode it entered, and nothing else.
 */
export class ModeTool implements AgentTool<typeof modeSchema, ModeToolDetails> {
	readonly name = "mode";
	/** Switching modes changes session state, so `always-ask` prompts for it. */
	readonly approval = "write" as const;
	readonly label = "Mode";
	readonly summary = "Enter or leave plan mode on your own initiative";
	readonly description = prompt.render(modeDescription);
	readonly parameters = modeSchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	readonly #session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
	}

	async execute(_toolCallId: string, params: ModeParams): Promise<AgentToolResult<ModeToolDetails>> {
		if (params.mode !== "plan") throw refusal(params.mode, params.op);
		if (params.op === "enter") return this.#enter(params);
		return this.#exit();
	}

	async #enter(params: ModeParams): Promise<AgentToolResult<ModeToolDetails>> {
		const enterMode = this.#session.enterMode;
		if (!enterMode) {
			throw new ToolError("This session cannot switch modes: no mode controller is attached.");
		}
		try {
			await enterMode(
				"plan",
				params.workflow ? { workflow: params.workflow, enteredBy: "agent" } : { enteredBy: "agent" },
			);
		} catch (error) {
			// The session refuses entry while another mode is active
			// ("Exit goal mode first."); surface that as a tool error.
			throw new ToolError(`Cannot enter plan mode: ${error instanceof Error ? error.message : String(error)}`);
		}
		const state = this.#session.getPlanModeState?.();
		const planFilePath = state?.planFilePath ?? "local://PLAN.md";
		return {
			content: [
				{
					type: "text",
					text:
						`Plan mode is on (workflow: ${state?.workflow ?? "parallel"}). ` +
						`Draft the plan at ${planFilePath}, then propose it with a \`write\` to \`xd://propose\` — ` +
						"only the user can approve it.",
				},
			],
			details: { op: "enter", mode: "plan", workflow: state?.workflow },
		};
	}

	async #exit(): Promise<AgentToolResult<ModeToolDetails>> {
		const state = this.#session.getPlanModeState?.();
		if (!state?.enabled) throw new ToolError("Plan mode is not active.");
		if (state.enteredBy !== "agent") {
			throw new ToolError(
				"Plan mode was enabled by the user: only they can end it. Propose the plan with a `write` to " +
					"`xd://propose`, or ask the user to leave plan mode.",
			);
		}
		const exitMode = this.#session.exitMode;
		if (!exitMode) {
			throw new ToolError("This session cannot switch modes: no mode controller is attached.");
		}
		await exitMode("plan", {});
		return {
			content: [{ type: "text", text: "Plan mode is off; the pre-plan tool set and model are back." }],
			details: { op: "exit", mode: "plan" },
		};
	}
}
