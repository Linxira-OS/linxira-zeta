/**
 * Backend-owned `/loop` for hosts that run the session outside the TUI
 * (`zeta serve` / attach, `--mode rpc`).
 *
 * The TUI keeps its own loop driver in `InteractiveMode`; this controller is
 * the same behavior bound to an `AgentSession`, so a loop started on an
 * attached session repeats prompts in *that* session. It owns the shell
 * condition child, the 800ms auto-submit window and the limit bookkeeping;
 * hosts only read {@link BackendLoopState} and forward `/loop` commands.
 *
 * The first prompt is user-visible and does not consume the budget (the TUI
 * behaves the same: `/loop 2 fix it` runs the typed prompt plus two automatic
 * repetitions). Auto-submitted turns are plain prompts, never custom messages,
 * so the transcript shows each repetition like a manual submit.
 */
import { logger } from "@linxiraos/pi-utils";
import type { LoopConditionConfig, LoopLimitRuntime } from "@linxiraos/pi-tui/status-line/loop";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import { evaluateLoopCondition } from "../modes/loop-condition";
import {
	consumeLoopLimitIteration,
	createLoopLimitRuntime,
	isLoopDurationExpired,
	isLoopLimitExhausted,
	parseLoopArgs,
} from "../modes/loop-limit";
import { cfgLoopConditionTimeoutMs, cfgLoopMode } from "../modes/settings";

/** Wire-safe loop state. Runtime limit/condition objects are plain data. */
export interface BackendLoopState {
	enabled: boolean;
	paused: boolean;
	prompt?: string;
	limit?: LoopLimitRuntime;
	condition?: LoopConditionConfig;
}

export interface LoopContinuationControllerOptions {
	/** Called after every state transition (start/pause/resume/stop/iteration). */
	onChange?: (state: BackendLoopState | null) => void;
	/** Called when the loop stops on its own; `reason` is operator-facing. */
	onStopped?: (reason: string) => void;
	/** Delay between a settled turn and the next submit (TUI uses 800ms). */
	retryDelayMs?: number;
	/** Test seam; defaults to the shared shell-condition evaluator. */
	conditionEvaluator?: typeof evaluateLoopCondition;
}

type LoopSession = Pick<
	AgentSession,
	| "sessionManager"
	| "settings"
	| "prompt"
	| "compact"
	| "resetSessionContext"
	| "isStreaming"
	| "isCompacting"
	| "hasPostPromptWork"
	| "isDisposed"
	| "getVibeModeState"
	| "getStateVersion"
	| "bumpStateVersion"
>;

const DEFAULT_RETRY_DELAY_MS = 800;

export class LoopContinuationController {
	readonly #session: LoopSession;
	readonly #onChange: ((state: BackendLoopState | null) => void) | undefined;
	readonly #onStopped: ((reason: string) => void) | undefined;
	readonly #retryDelayMs: number;
	readonly #conditionEvaluator: typeof evaluateLoopCondition;

	#enabled = false;
	#paused = false;
	#prompt: string | undefined;
	#limit: LoopLimitRuntime | undefined;
	#condition: LoopConditionConfig | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#conditionAbort: AbortController | undefined;
	/** Bumped whenever a pending tick must be invalidated (pause/stop/replace). */
	#generation = 0;

	constructor(session: LoopSession, options: LoopContinuationControllerOptions = {}) {
		this.#session = session;
		this.#onChange = options.onChange;
		this.#onStopped = options.onStopped;
		this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.#conditionEvaluator = options.conditionEvaluator ?? evaluateLoopCondition;
	}

	get active(): boolean {
		return this.#enabled;
	}

	snapshot(): BackendLoopState | null {
		if (!this.#enabled) return null;
		return {
			enabled: true,
			paused: this.#paused,
			...(this.#prompt === undefined ? {} : { prompt: this.#prompt }),
			...(this.#limit ? { limit: { ...this.#limit } } : {}),
			...(this.#condition ? { condition: { ...this.#condition } } : {}),
		};
	}

	/** `/loop <args>`: parse and start; the inline prompt (if any) runs now. */
	start(args = ""): BackendLoopState | null {
		const parsed = parseLoopArgs(args);
		if (typeof parsed === "string") throw new Error(parsed);
		this.#invalidate();
		this.#enabled = true;
		this.#paused = false;
		this.#prompt = parsed.prompt;
		this.#limit = createLoopLimitRuntime(parsed.limit);
		this.#condition = parsed.condition;
		this.#changed();
		if (this.#prompt !== undefined) this.#submitInitial(this.#prompt);
		return this.snapshot();
	}

	/**
	 * A host prompt arrives while the loop is enabled. The TUI treats any
	 * manual submit as the new loop body (and clears a pending pause), so the
	 * backend does the same. Auto-submitted loop turns never pass through here.
	 */
	noteUserPrompt(text: string): void {
		if (!this.#enabled) return;
		this.#invalidate();
		this.#prompt = text;
		this.#paused = false;
		this.#changed();
	}

	pause(): void {
		if (!this.#enabled || this.#paused) return;
		// Same as the TUI: the captured body is dropped, so a paused loop waits
		// for a new manual prompt instead of replaying the old one.
		this.#prompt = undefined;
		this.#paused = true;
		this.#invalidate();
		this.#changed();
	}

	resume(): void {
		if (!this.#enabled || !this.#paused) return;
		this.#paused = false;
		this.#changed();
		if (this.#prompt !== undefined) this.#schedule();
	}

	stop(reason?: string): void {
		if (!this.#enabled) return;
		this.#enabled = false;
		this.#paused = false;
		this.#prompt = undefined;
		this.#limit = undefined;
		this.#condition = undefined;
		this.#invalidate();
		this.#changed();
		if (reason) this.#onStopped?.(reason);
	}

	/** A transcript switch/delete/new must not leak the loop into another conversation. */
	stopForSessionChange(): void {
		if (!this.#enabled) return;
		this.stop("Session changed; loop mode disabled.");
	}

	/** Feed session events before settle/quiescence observers see them. */
	observe(event: AgentSessionEvent): void {
		if (event.type !== "agent_end" || event.isTerminal === false) return;
		if (!this.#enabled || this.#paused || this.#session.isDisposed) return;
		this.#schedule();
	}

	#changed(): void {
		this.#session.bumpStateVersion();
		this.#onChange?.(this.snapshot());
	}

	#invalidate(): void {
		this.#generation++;
		this.#clearTimer();
		this.#abortCondition();
	}

	#clearTimer(): void {
		if (!this.#timer) return;
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	#abortCondition(): void {
		this.#conditionAbort?.abort();
		this.#conditionAbort = undefined;
	}

	#schedule(): void {
		this.#clearTimer();
		const generation = this.#generation;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.#tick(generation);
		}, this.#retryDelayMs);
	}

	#blocked(): boolean {
		return this.#session.isStreaming || this.#session.isCompacting || this.#session.hasPostPromptWork;
	}

	async #tick(generation: number): Promise<void> {
		if (generation !== this.#generation || !this.#enabled || this.#paused) return;
		const prompt = this.#prompt;
		if (prompt === undefined) return;

		if (isLoopDurationExpired(this.#limit)) {
			this.stop("Loop time limit reached. Loop mode disabled.");
			return;
		}
		if (isLoopLimitExhausted(this.#limit)) {
			this.stop("Loop limit reached. Loop mode disabled.");
			return;
		}
		if (this.#blocked()) {
			this.#schedule();
			return;
		}

		if (this.#condition) {
			const passed = await this.#passesCondition(generation);
			if (!passed || generation !== this.#generation) return;
			if (this.#blocked()) {
				this.#schedule();
				return;
			}
		}

		if (!consumeLoopLimitIteration(this.#limit)) {
			this.stop("Loop limit reached. Loop mode disabled.");
			return;
		}
		this.#changed();

		const action = cfgLoopMode.get(this.#session.settings);
		if (action === "reset" && this.#session.getVibeModeState()?.enabled) {
			this.stop("Exit vibe mode before using reset loops. Loop mode disabled.");
			return;
		}
		try {
			if (action === "compact") await this.#session.compact();
			else if (action === "reset") await this.#session.resetSessionContext();
		} catch (error) {
			logger.warn("loop continuation action failed", { action, error: String(error) });
			this.stop(`Loop ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (generation !== this.#generation || !this.#enabled || this.#paused) return;
		if (this.#blocked()) {
			this.#schedule();
			return;
		}
		this.#submit(prompt);
	}

	async #passesCondition(generation: number): Promise<boolean> {
		const condition = this.#condition;
		if (!condition) return true;
		const controller = new AbortController();
		this.#conditionAbort = controller;
		let verdict: Awaited<ReturnType<typeof evaluateLoopCondition>>;
		try {
			verdict = await this.#conditionEvaluator(condition, {
				cwd: this.#session.sessionManager.getCwd(),
				timeoutMs: cfgLoopConditionTimeoutMs.get(this.#session.settings),
				signal: controller.signal,
				sessionId: this.#session.sessionManager.getSessionId(),
			});
		} finally {
			if (this.#conditionAbort === controller) this.#conditionAbort = undefined;
		}
		// A pause/stop/host prompt can land while the condition child runs.
		if (generation !== this.#generation || !this.#enabled || this.#paused) return false;
		if (verdict.kind === "continue") return true;
		if (verdict.kind === "aborted") return false;
		this.stop(verdict.message);
		return false;
	}

	#submitInitial(prompt: string): void {
		// The inline prompt is part of the user's own submit: steer when a turn is
		// already running instead of waiting, matching the TUI's manual submit.
		this.#submit(prompt, this.#session.isStreaming);
	}

	#submit(prompt: string, steer = false): void {
		const generation = this.#generation;
		void this.#session.prompt(prompt, steer ? { streamingBehavior: "steer" } : undefined).catch(error => {
			logger.warn("loop continuation prompt failed", { error: String(error) });
			if (generation === this.#generation) {
				this.stop(`Loop prompt failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}
}
