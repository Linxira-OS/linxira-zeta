import { describe, expect, test } from "bun:test";
import { Settings } from "../../src/config/settings";
import { type BackendLoopState, LoopContinuationController } from "../../src/loop/continuation-controller";
import type { AgentSession } from "../../src/session/agent-session";

interface FakeSession {
	session: AgentSession;
	prompts: string[];
	streaming: boolean;
}

function fakeSession(): FakeSession {
	const prompts: string[] = [];
	const fake = {
		streaming: false,
		sessionManager: { getCwd: () => process.cwd(), getSessionId: () => "test-session" },
		settings: Settings.isolated(),
		prompt: async (text: string) => {
			prompts.push(text);
		},
		compact: async () => ({}),
		resetSessionContext: async () => undefined,
		get isStreaming() {
			return fake.streaming;
		},
		isCompacting: false,
		hasPostPromptWork: false,
		isDisposed: false,
		getVibeModeState: () => undefined,
		getStateVersion: () => 1,
		bumpStateVersion: () => 1,
	};
	return {
		session: fake as unknown as AgentSession,
		prompts,
		get streaming() {
			return fake.streaming;
		},
		set streaming(value: boolean) {
			fake.streaming = value;
		},
	};
}

async function settle(): Promise<void> {
	await Bun.sleep(20);
}

describe("LoopContinuationController", () => {
	test("counts automatic repetitions and stops when the budget is spent", async () => {
		const { session, prompts } = fakeSession();
		const controller = new LoopContinuationController(session, { retryDelayMs: 1 });
		const stopped: string[] = [];
		// Replace the seam through a second controller to observe onStopped.
		const observed = new LoopContinuationController(session, {
			retryDelayMs: 1,
			onStopped: reason => stopped.push(reason),
		});

		observed.start("2 repeat this");
		expect(prompts).toEqual(["repeat this"]);
		expect(observed.snapshot()).toMatchObject({ enabled: true, prompt: "repeat this" });

		observed.observe({ type: "agent_end" } as never);
		await settle();
		observed.observe({ type: "agent_end" } as never);
		await settle();
		expect(prompts).toEqual(["repeat this", "repeat this", "repeat this"]);

		observed.observe({ type: "agent_end" } as never);
		await settle();
		expect(prompts).toHaveLength(3);
		expect(observed.snapshot()).toBeNull();
		expect(stopped.join()).toContain("Loop limit reached");
		controller.stop();
	});

	test("halts on a condition verdict and reports the evaluator message", async () => {
		const { session, prompts } = fakeSession();
		const stopped: string[] = [];
		const controller = new LoopContinuationController(session, {
			retryDelayMs: 1,
			conditionEvaluator: async () => ({ kind: "halt", message: "condition satisfied" }),
			onStopped: reason => stopped.push(reason),
		});
		controller.start("--until 'test -f /tmp/x' go");
		expect(prompts).toEqual(["go"]);
		controller.observe({ type: "agent_end" } as never);
		await settle();
		expect(prompts).toEqual(["go"]);
		expect(controller.snapshot()).toBeNull();
		expect(stopped).toEqual(["condition satisfied"]);
	});

	test("pause drops the captured prompt and the next manual prompt resumes", async () => {
		const { session, prompts } = fakeSession();
		const controller = new LoopContinuationController(session, { retryDelayMs: 1 });
		controller.start("5 first");
		expect(prompts).toEqual(["first"]);

		controller.pause();
		expect(controller.snapshot()).toMatchObject({ enabled: true, paused: true });
		expect(controller.snapshot()?.prompt).toBeUndefined();
		controller.observe({ type: "agent_end" } as never);
		await settle();
		expect(prompts).toEqual(["first"]);

		controller.noteUserPrompt("second");
		expect(controller.snapshot()).toMatchObject({ enabled: true, paused: false, prompt: "second" });
		controller.observe({ type: "agent_end" } as never);
		await settle();
		expect(prompts).toEqual(["first", "second"]);
		controller.stop();
	});

	test("state never leaks between controllers (one per session)", () => {
		const a = fakeSession();
		const b = fakeSession();
		const first = new LoopContinuationController(a.session, { retryDelayMs: 1 });
		const second = new LoopContinuationController(b.session, { retryDelayMs: 1 });
		first.start("3 a-only");
		expect(first.snapshot()).toMatchObject({ enabled: true, prompt: "a-only" });
		expect(second.snapshot()).toBeNull();
		second.start("3 b-only");
		const bState: BackendLoopState | null = second.snapshot();
		expect(bState).toMatchObject({ enabled: true, prompt: "b-only" });
		expect(first.snapshot()).toMatchObject({ enabled: true, prompt: "a-only" });
		first.stop();
		second.stop();
	});
});
