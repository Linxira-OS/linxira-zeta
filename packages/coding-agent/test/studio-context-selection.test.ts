import { expect, test } from "bun:test";
import {
	currentStudioSelection,
	requireStudioWorkspace,
	runWithStudioSelection,
	selectStudioSession,
	type StudioSelection,
} from "../src/server/studio-host/selection.js";

test("interleaved operations retain independent session selections", async () => {
	const first: StudioSelection = { workspaceId: "workspace-a", closed: false };
	const second: StudioSelection = { workspaceId: "workspace-b", sessionId: "session-b", closed: false };
	const gate = Promise.withResolvers<void>();
	const pending = runWithStudioSelection(first, async () => {
		await gate.promise;
		selectStudioSession("session-a");
		expect(currentStudioSelection()).toBe(first);
	});
	await runWithStudioSelection(second, async () => {
		await Promise.resolve();
		expect(currentStudioSelection()?.sessionId).toBe("session-b");
		expect(() => requireStudioWorkspace("workspace-a")).toThrow("workspace does not belong");
		gate.resolve();
	});
	await pending;
	expect(first.sessionId).toBe("session-a");
	expect(second.sessionId).toBe("session-b");
	expect(currentStudioSelection()).toBeUndefined();
});

test("closing a context rejects already admitted async continuations", async () => {
	const selection: StudioSelection = { workspaceId: "workspace-a", closed: false };
	await runWithStudioSelection(selection, async () => {
		selection.closed = true;
		await Promise.resolve();
		expect(() => selectStudioSession("late-session")).toThrow("conversation context is closed");
	});
	expect(selection.sessionId).toBeUndefined();
});
