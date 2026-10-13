/**
 * Gateway `ask` channel contract — `extension_ui_request(method:"ask")` over
 * SSE for one whole ask-tool call (every question in one frame), answered by
 * `POST /api/extension-ui/response` with one `answers` array that reaches the
 * extension through `extension_ui_response`.
 *
 * The cases pin the answer semantics: all questions in one round trip,
 * `recommended` used on timeout (never a blank answer), user cancel reported
 * as cancellation, and malformed answers rejected instead of guessed
 * (fail-closed) — plus the owner registry answering without any `/events`
 * subscriber.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { parseAskDialogResponse } from "../../src/extensibility/extensions/ask-dialog-response";
import type { ExtensionAskDialogOption, ExtensionAskDialogQuestion } from "../../src/extensibility/extensions/types";
import {
	AgentSessionWrapper,
	createGatewayUiContext,
	handleGlobalExtensionUiResponse,
	sessions,
} from "../../src/server/web-gateway/agents";

const created: AgentSessionWrapper[] = [];

type Fixture = {
	wrapper: AgentSessionWrapper;
	/** Frames the wrapper routed to SSE listeners (the production emit path). */
	frames: Array<Record<string, unknown>>;
};

function makeSession(id: string): Fixture {
	const wrapper = new AgentSessionWrapper({ sessionManager: {}, subscribe: () => () => {} } as never, id, null);
	sessions.set(id, wrapper);
	created.push(wrapper);
	const frames: Array<Record<string, unknown>> = [];
	wrapper.onEvent(event => frames.push(event as Record<string, unknown>));
	return { wrapper, frames };
}

/** The gateway's production wiring: `startRpcSession` passes the wrapper's own dispatch as the emit. */
function uiContext(wrapper: AgentSessionWrapper) {
	return createGatewayUiContext(wrapper, request => wrapper.dispatchUiRequest(request));
}

function respond(body: Record<string, unknown>): Promise<Response> {
	return handleGlobalExtensionUiResponse(
		new Request("http://127.0.0.1/api/extension-ui/response", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

function askId(frames: Array<Record<string, unknown>>): string {
	const frame = frames.find(f => f.type === "extension_ui_request" && f.method === "ask");
	if (!frame || typeof frame.id !== "string") throw new Error("no ask frame emitted");
	return frame.id;
}

const OPTIONS: ExtensionAskDialogOption[] = [{ label: "Yes" }, { label: "No" }];

afterEach(() => {
	for (const wrapper of created.splice(0)) {
		sessions.delete(wrapper.realSessionId);
		wrapper.destroy();
	}
});

describe("gateway ask channel", () => {
	test("one frame carries every question; one POST answers them all", async () => {
		const { wrapper, frames } = makeSession("sess-ask-roundtrip");
		const questions: ExtensionAskDialogQuestion[] = [
			{ id: "q1", question: "Ship it?", options: OPTIONS, recommended: 1 },
			{ id: "q2", question: "Which files?", options: [{ label: "a.ts" }, { label: "b.ts" }], multi: true },
		];
		const pending = uiContext(wrapper).askDialog!(questions, { timeout: 500 });

		const frame = frames.find(f => f.type === "extension_ui_request" && f.method === "ask");
		expect(frame?.questions).toEqual(questions);
		expect(frame?.timeout).toBe(500);

		const id = askId(frames);
		const res = await respond({
			id,
			answers: [
				{ id: "q1", selectedOptions: ["No"] },
				{ id: "q2", selectedOptions: ["a.ts", "b.ts"], note: "both files" },
			],
		});
		expect(res.status).toBe(200);

		const result = await pending;
		expect(result?.kind).toBe("submit");
		const results = result?.kind === "submit" ? result.results : [];
		expect(results.map(r => r.selectedOptions)).toEqual([["No"], ["a.ts", "b.ts"]]);
		expect(results.map(r => r.multi)).toEqual([false, true]);
		expect(results[1]?.note).toBe("both files");
		expect(frames.some(f => f.type === "extension_ui_resolved" && f.id === id)).toBe(true);

		// The dialog is settled: a second reply to the same id is unknown.
		expect((await respond({ id, answers: [] })).status).toBe(404);
	});

	test("timeout resolves every question to its recommended option and closes the client dialog", async () => {
		const { wrapper, frames } = makeSession("sess-ask-timeout");
		const questions: ExtensionAskDialogQuestion[] = [
			{ id: "q1", question: "Pick", options: OPTIONS, recommended: 1 },
			{ id: "q2", question: "Multi", options: [{ label: "x" }, { label: "y" }], multi: true },
		];
		const result = await uiContext(wrapper).askDialog!(questions, { timeout: 20 });

		expect(result?.kind).toBe("submit");
		const results = result?.kind === "submit" ? result.results : [];
		expect(results.map(r => r.selectedOptions)).toEqual([["No"], ["x"]]);
		expect(results.every(r => r.timedOut === true)).toBe(true);

		const cancelFrame = frames.find(f => f.type === "extension_ui_request" && f.method === "cancel");
		expect(cancelFrame?.targetId).toBe(askId(frames));
	});

	test("a cancelled dialog reports cancellation, not an empty answer", async () => {
		const { wrapper, frames } = makeSession("sess-ask-cancel");
		const questions: ExtensionAskDialogQuestion[] = [{ id: "q1", question: "Ship it?", options: OPTIONS }];
		const pending = uiContext(wrapper).askDialog!(questions, { timeout: 500 });

		expect((await respond({ id: askId(frames), cancelled: true })).status).toBe(200);
		expect(await pending).toBeUndefined();
	});

	test("malformed answers reject the ask call instead of resolving it", async () => {
		const { wrapper, frames } = makeSession("sess-ask-invalid");
		const questions: ExtensionAskDialogQuestion[] = [
			{ id: "q1", question: "Ship it?", options: OPTIONS },
			{ id: "q2", question: "Which files?", options: [{ label: "a.ts" }] },
		];
		const pending = uiContext(wrapper).askDialog!(questions, { timeout: 500 });
		const id = askId(frames);

		// Too few answers for the questions asked: the extension's await rejects.
		let outcome = "pending";
		pending.then(
			() => (outcome = "resolved"),
			(error: Error) => (outcome = `rejected: ${error.message}`),
		);
		expect((await respond({ id, answers: [{ id: "q1", selectedOptions: ["Yes"] }] })).status).toBe(200);
		expect(outcome).toMatch(/^rejected: .*must carry 2 answers/);

		// Shallow body validation never reaches a session.
		expect((await respond({ id, answers: { id: "q1" } })).status).toBe(400);
		expect((await respond({ id: "nope", answers: [] })).status).toBe(404);
	});

	test("the shared validator keeps its fail-closed rules", () => {
		const single: ExtensionAskDialogQuestion[] = [{ id: "q1", question: "Ship it?", options: OPTIONS }];
		expect(() =>
			parseAskDialogResponse({ answers: [{ id: "q1", selectedOptions: ["Yes", "No"] }] }, single, {}),
		).toThrow(/single-select/);
		expect(() => parseAskDialogResponse({ answers: [{ id: "q1", selectedOptions: ["Maybe"] }] }, single, {})).toThrow(
			/unknown option/,
		);
		expect(() =>
			parseAskDialogResponse(
				{ answers: [{ id: "q1", selectedOptions: ["Yes"], customInputImages: [{}] }] },
				single,
				{},
			),
		).toThrow(/image attachments/);
		expect(
			parseAskDialogResponse({ answers: [{ id: "q1", selectedOptions: ["Yes"], note: "ok" }] }, single, {})
				?.results[0]?.note,
		).toBe("ok");
	});
});
