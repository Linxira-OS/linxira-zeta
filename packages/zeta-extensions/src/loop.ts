// port of omp loop mode (interactive-mode.ts handleLoopCommand) onto pi extension API
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	consumeLoopLimitIteration,
	createLoopLimitRuntime,
	describeLoopLimit,
	describeLoopLimitRuntime,
	isLoopDurationExpired,
	parseLoopLimitArgs,
	type LoopLimitRuntime,
} from "./loop-limit.ts";

const STATUS_KEY = "zeta-loop";

export interface ZetaLoopState {
	enabled: boolean;
	prompt: string | undefined;
	limit: LoopLimitRuntime | undefined;
	iterations: number;
	lastPrompt: string | undefined;
}

function createLoopState(): ZetaLoopState {
	return { enabled: false, prompt: undefined, limit: undefined, iterations: 0, lastPrompt: undefined };
}

export function installLoop(api: ExtensionAPI): ZetaLoopState {
	const state = createLoopState();

	const updateStatus = (ctx: { ui: { setStatus: (key: string, text: string | undefined) => void } }): void => {
		if (!state.enabled) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const limitText = state.limit ? ` [${describeLoopLimitRuntime(state.limit)}]` : "";
		ctx.ui.setStatus(STATUS_KEY, `Loop: on (${state.iterations} iter)${limitText}`);
	};

	const disable = (ctx: { ui: { setStatus: (key: string, text: string | undefined) => void } }, reason: string): void => {
		state.enabled = false;
		state.prompt = undefined;
		state.limit = undefined;
		updateStatus(ctx);
		void api.sendMessage({ customType: "zeta-loop", content: reason, display: true });
	};

	api.registerCommand("loop", {
		description:
			"Run the agent in a loop, re-submitting the same prompt after each turn settles. Usage: /loop [count|duration] [prompt]",
		getArgumentCompletions: (prefix: string) => {
			const suggestions = ["10", "10m", "5 times", "fix the failing test"];
			return suggestions.filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const parsed = parseLoopLimitArgs(args);

			if (typeof parsed === "string") {
				void api.sendMessage({ customType: "zeta-loop", content: parsed, display: true });
				return;
			}

			if (state.enabled && !parsed.limit && parsed.prompt === undefined) {
				disable(ctx, "Loop stopped.");
				return;
			}

			const prompt = parsed.prompt ?? state.prompt ?? state.lastPrompt;
			if (!prompt) {
				void api.sendMessage({
					customType: "zeta-loop",
					content: "No loop prompt. Usage: /loop [count|duration] [prompt]",
					display: true,
				});
				return;
			}

			state.enabled = true;
			state.prompt = prompt;
			state.lastPrompt = prompt;
			if (parsed.limit) {
				state.limit = createLoopLimitRuntime(parsed.limit);
			}
			updateStatus(ctx);

			const limitText = parsed.limit ? ` for ${describeLoopLimit(parsed.limit)}` : "";
			void api.sendMessage({
				customType: "zeta-loop",
				content: `Loop started${limitText}. Press Ctrl+C to stop, or /loop again to toggle.`,
				display: true,
			});

			void api.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});

	api.on("agent_settled", (_event, ctx) => {
		if (!state.enabled || !state.prompt) return;
		if (!consumeLoopLimitIteration(state.limit)) {
			disable(ctx, "Loop limit reached.");
			return;
		}
		state.iterations += 1;
		updateStatus(ctx);
		void api.sendUserMessage(state.prompt, { deliverAs: "followUp" });
	});

	api.on("turn_end", (_event, ctx) => {
		if (!state.enabled) return;
		if (state.limit && isLoopDurationExpired(state.limit)) {
			disable(ctx, "Loop duration expired.");
		}
	});

	return state;
}
