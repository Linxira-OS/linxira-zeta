/**
 * Contract: Studio conversation compaction and its queue use the real native
 * session policy and prepared message objects. Thresholds survive reopening,
 * rewind and model-window changes but never leak into a fork; duplicate text
 * keeps distinct identities; a queued compaction holds later follow-ups
 * outside executable queues until its actual yield boundary, and abort or a
 * transcript switch never replays them into another conversation.
 */
import { afterEach, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { shouldCompact } from "@linxiraos/pi-agent-core/compaction";
import { Agent, type AgentMessage } from "@linxiraos/pi-agent-core";
import { createMockModel, type MockResponse } from "@linxiraos/pi-ai/providers/mock";
import type { Model } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { tagImageAttachmentSource } from "@linxiraos/pi-tui/prompt/image-source";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { StudioQueuedCompactionService } from "../src/server/studio-host/services/queued-compaction-service";
import { StudioRuntimeQueueService } from "../src/server/studio-host/services/runtime-queue-service";
import {
	StudioRuntimeViewService,
	type RuntimeViewArtifactPort,
	type RuntimeViewQueueHost,
} from "../src/server/studio-host/services/runtime-view-service";
import type { RuntimeQueueResult } from "../src/server/studio-host/protocol/contracts/runtime-queue";
import {
	StudioSessionCompactionService,
	type SessionCompactionHost,
} from "../src/server/studio-host/services/session-compaction-service";
import { resolveSessionCompactionSettings } from "../src/server/studio-host/services/session-compaction-policy";
import { cfgCompactionModelThresholds } from "../src/session/context-settings";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const image = tagImageAttachmentSource(
	{
		type: "image",
		mimeType: "image/png",
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
	},
	"/private/queued.png",
	"image",
);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Stands in for the host's live-view fence where the test view never expires. */
const liveView = () => {};

function compactionHost(manager: SessionManager, settings: Settings, model: Model | undefined): SessionCompactionHost {
	return {
		sessionId: manager.getSessionId(),
		sessionManager: manager,
		settings,
		model,
		refreshIdleMaintenance() {},
	};
}

async function runtimeFixture(responses: MockResponse[]) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-compaction-queue-"));
	const auth = createInMemoryAuthStorage();
	auth.keys.setRuntime("anthropic", "test-only");
	const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	const mock = createMockModel({ id: model.id, provider: model.provider, responses });
	const agent = new Agent({
		getApiKey: () => "test-only",
		initialState: { model, systemPrompt: [], tools: [] },
		convertToLlm,
		streamFn: mock.stream,
	});
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.create(directory, path.join(directory, "sessions")),
		settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, "todo.enabled": false }),
		modelRegistry: new ModelRegistry(auth, path.join(directory, "models.yml")),
	});
	const compaction = new StudioQueuedCompactionService(session);
	const queue = new StudioRuntimeQueueService(session, compaction);
	cleanups.push(async () => {
		compaction.dispose();
		await session.dispose();
		auth.close();
		await fs.rm(directory, { recursive: true, force: true });
	});
	return { directory, session, agent, mock, compaction, queue };
}

/** Resolves on the nth `agent_start`, so delivery assertions await the real turn. */
function nextTurn(session: AgentSession, expected: number): Promise<void> {
	let starts = 0;
	const reached = Promise.withResolvers<void>();
	const unsubscribe = session.subscribe(event => {
		if (event.type === "agent_start" && ++starts === expected) reached.resolve();
	});
	cleanups.push(async () => unsubscribe());
	return reached.promise;
}

function runtimeQueueHost(): {
	host: RuntimeViewQueueHost;
	artifacts: RuntimeViewArtifactPort;
	get pending(): boolean;
	get exports(): number;
	get cleanups(): number;
	get removeCalls(): number;
	releaseWrite(): void;
	writeStarted: Promise<void>;
} {
	let pending = true;
	let exports = 0;
	let cleanups = 0;
	let removeCalls = 0;
	const writeGate = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	const item = {
		id: "message",
		queue: "followUp" as const,
		state: "pending" as const,
		text: "with image",
		imageCount: 1,
	};
	const asset = {
		artifactId: "11111111-1111-1111-1111-111111111111",
		kind: "image" as const,
		name: "a.png",
		mimeType: "image/png",
		bytes: 1,
		sha256: "a".repeat(64),
	};
	const host: RuntimeViewQueueHost = {
		sessionId: "s",
		followUpMode: "one-at-a-time",
		steeringMode: "all",
		getStudioQueueSnapshot: () => (pending ? [item] : []),
		getStudioQueueDraft: () =>
			pending ? { text: "with image", images: [{ type: "image", mimeType: "image/png", data: "YQ==" }] } : undefined,
		removeStudioQueuedMessage: () => {
			removeCalls++;
			const found = pending;
			pending = false;
			return found;
		},
		steerStudioQueuedMessage: () => false,
	};
	const artifacts: RuntimeViewArtifactPort = {
		writeSessionMediaArtifact: async () => {
			exports++;
			started.resolve();
			await writeGate.promise;
			return asset;
		},
		removeSessionMediaArtifacts: async () => {
			cleanups++;
		},
	};
	return {
		host,
		artifacts,
		get pending() {
			return pending;
		},
		get exports() {
			return exports;
		},
		get cleanups() {
			return cleanups;
		},
		get removeCalls() {
			return removeCalls;
		},
		releaseWrite: () => writeGate.resolve(),
		writeStarted: started.promise,
	};
}

test("conversation threshold survives reopen and rewind, follows the model window, and never leaks into a fork", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-compaction-policy-"));
	const settings = Settings.isolated({ "compaction.enabled": true });
	const model = { ...getBundledModel("anthropic", "claude-sonnet-4-5")!, contextWindow: 1_000_000 };
	cfgCompactionModelThresholds.set(settings, { [`${model.provider}/${model.id}`]: "90%" });
	const manager = SessionManager.create(directory, directory);
	const original = manager.appendMessage({ role: "user", content: "before threshold", timestamp: Date.now() });
	const controls = new StudioSessionCompactionService(compactionHost(manager, settings, model));
	cleanups.push(async () => {
		await manager.close();
	});
	expect(controls.get().triggerTokens).toBe(900_000);
	expect((await controls.set("75")).triggerTokens).toBe(750_000);
	const policy = resolveSessionCompactionSettings(settings, model, manager);
	expect(shouldCompact(749_999, model.contextWindow, policy)).toBe(false);
	expect(shouldCompact(750_001, model.contextWindow, policy)).toBe(true);
	manager.branch(original);
	expect(controls.get().triggerTokens).toBe(750_000);
	await controls.set("150k");
	expect(controls.get().triggerTokens).toBe(150_000);
	expect(
		resolveSessionCompactionSettings(settings, { ...model, contextWindow: 200_000 }, manager).thresholdTokens,
	).toBe(150_000);
	await controls.set("0.5");
	expect(controls.get().triggerTokens).toBe(5_000);
	expect(
		resolveSessionCompactionSettings(settings, { ...model, contextWindow: 200_000 }, manager).thresholdTokens,
	).toBe(1_000);
	await controls.set("0.5M");
	expect(controls.get().triggerTokens).toBe(500_000);
	await controls.set("");
	expect(controls.get().threshold).toBeNull();
	expect(controls.get().triggerTokens).toBe(900_000);
	await controls.set("75");
	const file = manager.getSessionFile()!;
	await manager.close();
	const reopened = await SessionManager.open(file);
	cleanups.push(async () => {
		await reopened.close();
	});
	const reopenedControls = new StudioSessionCompactionService(compactionHost(reopened, settings, model));
	expect(reopenedControls.get().threshold).toEqual({ kind: "percent", value: 75 });
	const fork = await SessionManager.forkFrom(file, directory, directory, undefined, { copyArtifacts: false });
	cleanups.push(async () => {
		await fork.close();
	});
	cleanups.push(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});
	expect(new StudioSessionCompactionService(compactionHost(fork, settings, model)).get().threshold).toBeNull();
	expect(new StudioSessionCompactionService(compactionHost(fork, settings, model)).get().triggerTokens).toBe(900_000);
	expect(cfgCompactionModelThresholds.get(settings)).toEqual({ [`${model.provider}/${model.id}`]: "90%" });
});

test("duplicate prepared text keeps distinct ids and image companions through edit, removal and promotion", async () => {
	const f = await runtimeFixture([{ content: ["first"] }, { content: ["next"] }]);
	let before: RuntimeQueueResult | undefined;
	let after: RuntimeQueueResult | undefined;
	let staleRejected = false;
	let once = false;
	f.agent.setOnBeforeYield(async () => {
		if (once) return;
		once = true;
		await f.session.followUp("duplicate");
		await f.session.followUp("duplicate", [image]);
		before = f.queue.get();
		const [first, second] = before.entries;
		f.queue.execute({
			kind: "session.queue.entry.remove",
			sessionId: f.session.sessionId,
			id: first!.id,
			queue: "followUp",
		});
		try {
			f.queue.execute({
				kind: "session.queue.edit",
				sessionId: f.session.sessionId,
				id: second!.id,
				queue: "followUp",
				expectedText: "stale",
				text: "incorrect",
			});
		} catch {
			staleRejected = true;
		}
		f.queue.execute({
			kind: "session.queue.edit",
			sessionId: f.session.sessionId,
			id: second!.id,
			queue: "followUp",
			expectedText: second!.text,
			text: "edited",
		});
		after = f.queue.execute({
			kind: "session.queue.promote",
			sessionId: f.session.sessionId,
			id: second!.id,
			queue: "followUp",
		});
	});
	await f.session.prompt("start");
	await f.session.waitForIdle();
	expect(before?.entries).toHaveLength(2);
	expect(before?.entries[0]?.id).not.toBe(before?.entries[1]?.id);
	expect(staleRejected).toBe(true);
	expect(after?.entries).toHaveLength(1);
	expect(after?.entries[0]).toMatchObject({
		id: before!.entries[1]!.id,
		text: "edited",
		queue: "steering",
		imageCount: 1,
	});
	const wire = JSON.stringify(after);
	expect(wire).not.toContain("/private/");
	expect(f.mock.calls).toHaveLength(2);
	const delivered = JSON.stringify(f.mock.calls[1]!.context.messages);
	expect(delivered).toContain("edited");
	expect(delivered).not.toContain("duplicate");
	const passedImages = f.mock.calls[1]!.context.messages.flatMap(message =>
		typeof message.content === "string" ? [] : message.content,
	).filter(part => part.type === "image");
	expect(passedImages).toHaveLength(1);
	expect(f.queue.get().entries).toEqual([]);
	expect(() =>
		f.queue.execute({
			kind: "session.queue.entry.remove",
			sessionId: f.session.sessionId,
			id: before!.entries[1]!.id,
			queue: "steering",
		}),
	).toThrow("no longer queued");
	expect(() => f.queue.execute({ kind: "session.queue.get", sessionId: "other" })).toThrow("another session");
});

test("a later follow-up stays held behind queued compaction and is delivered exactly once after the barrier", async () => {
	const f = await runtimeFixture([{ content: ["first"] }, { content: ["next"] }]);
	const yielded = Promise.withResolvers<void>();
	const finishTurn = Promise.withResolvers<void>();
	const compacting = Promise.withResolvers<void>();
	const finishCompaction = Promise.withResolvers<void>();
	let first = true;
	f.agent.setOnBeforeYield(async () => {
		if (!first) return;
		first = false;
		yielded.resolve();
		await finishTurn.promise;
	});
	spyOn(f.session, "compact").mockImplementation(async () => {
		compacting.resolve();
		await finishCompaction.promise;
		return {
			summary: "kept",
			firstKeptEntryId: f.session.sessionManager.getLeafId()!,
			tokensBefore: 10,
		};
	});
	const delivered = nextTurn(f.session, 2);
	const running = f.session.prompt("before compaction");
	await yielded.promise;
	f.compaction.enqueue();
	await f.session.prompt("after compaction", { streamingBehavior: "followUp", images: [image] });
	const queued = f.queue.get();
	expect(queued.entries.map(entry => entry.kind ?? entry.heldFor)).toEqual(["compaction", "compaction"]);
	expect(queued.entries[1]).toMatchObject({ text: "after compaction", imageCount: 1, state: "held" });
	expect(f.session.queuedMessageCount).toBe(0);
	finishTurn.resolve();
	await running;
	await compacting.promise;
	expect(f.mock.calls).toHaveLength(1);
	finishCompaction.resolve();
	await f.compaction.wait();
	await delivered;
	await f.session.waitForIdle();
	const messages = f.mock.calls[1]!.context.messages;
	const images = messages.flatMap(message =>
		typeof message.content === "string" ? [] : message.content.filter(part => part.type === "image"),
	);
	expect(images).toHaveLength(1);
	expect(JSON.stringify(messages)).toContain("/private/queued.png");
	expect(f.queue.get().entries).toEqual([]);
});

test("runtime view serializes concurrent takeback/ack and refuses removal during disposal", async () => {
	const fixture = runtimeQueueHost();
	const service = new StudioRuntimeViewService(fixture.host, fixture.artifacts);
	const first = service.takeback("s", "message", liveView);
	await fixture.writeStarted;
	const second = service.takeback("s", "message", liveView);
	const acknowledged = service.ack("s", "message", liveView);
	fixture.releaseWrite();
	const [taken, takenAgain, ack] = await Promise.all([first, second, acknowledged]);
	expect(taken).toEqual({
		removed: true,
		recoveryId: "message",
		text: "with image",
		images: [
			{
				artifactId: "11111111-1111-1111-1111-111111111111",
				kind: "image",
				name: "a.png",
				mimeType: "image/png",
				bytes: 1,
				sha256: "a".repeat(64),
			},
		],
	});
	expect(takenAgain).toEqual(taken);
	expect(ack).toEqual({ removed: true });
	expect(fixture.exports).toBe(1);
	expect(fixture.cleanups).toBe(1);
	expect(fixture.pending).toBe(false);
	expect(await service.takeback("s", "message", liveView)).toEqual({ removed: false, images: [] });
	expect(() => service.list("stale")).toThrow("Session changed");

	// Revoking the initiating view while its image write is staged must leave the
	// message pending without a recovery; a mutation queued while the view was
	// live must fail at execution, and the staged asset must be discarded.
	const revokedFixture = runtimeQueueHost();
	const revokedService = new StudioRuntimeViewService(revokedFixture.host, revokedFixture.artifacts);
	let viewLive = true;
	const assertCurrent = () => {
		if (!viewLive) throw new Error("The conversation view is not live");
	};
	const interrupted = revokedService.takeback("s", "message", assertCurrent);
	await revokedFixture.writeStarted;
	const queued = revokedService.remove("s", "message", assertCurrent);
	viewLive = false;
	revokedFixture.releaseWrite();
	const [takebackError, removeError] = await Promise.all([
		interrupted.then(
			() => undefined,
			error => error,
		),
		queued.then(
			() => undefined,
			error => error,
		),
	]);
	expect(takebackError).toBeInstanceOf(Error);
	expect(removeError).toBeInstanceOf(Error);
	expect(revokedFixture.pending).toBe(true);
	expect(revokedFixture.removeCalls).toBe(0);
	expect(revokedFixture.exports).toBe(1);
	expect(revokedFixture.cleanups).toBe(1);
	expect(revokedService.list("s").items).toEqual([
		{
			id: "message",
			queue: "followUp",
			state: "pending",
			text: "with image",
			imageCount: 1,
		},
	]);

	const disposing = runtimeQueueHost();
	const disposable = new StudioRuntimeViewService(disposing.host, disposing.artifacts);
	const pending = disposable.takeback("s", "message", liveView);
	await disposing.writeStarted;
	const disposal = disposable.dispose();
	disposing.releaseWrite();
	const failed = await pending.then(
		() => undefined,
		error => error,
	);
	expect(failed).toBeInstanceOf(Error);
	expect(disposing.removeCalls).toBe(0);
	expect(disposing.pending).toBe(true);
	expect(disposing.cleanups).toBe(1);
	await disposal;
	expect(await disposable.takeback("s", "message", liveView).catch(error => error)).toBeInstanceOf(Error);
});

test("abort retains held input for its own transcript and never replays it after a session switch", async () => {
	const f = await runtimeFixture([{ content: ["first"] }, { content: ["restored"] }]);
	const yielded = Promise.withResolvers<void>();
	const finishTurn = Promise.withResolvers<void>();
	let first = true;
	f.agent.setOnBeforeYield(async () => {
		if (!first) return;
		first = false;
		yielded.resolve();
		await finishTurn.promise;
	});
	const compact = spyOn(f.session, "compact");
	const running = f.session.prompt("original");
	await yielded.promise;
	const originalId = f.session.sessionId;
	const file = f.session.sessionManager.getSessionFile()!;
	f.compaction.enqueue();
	await f.session.prompt("recover me", { streamingBehavior: "followUp" });
	const aborting = f.session.abort();
	finishTurn.resolve();
	await Promise.all([running, aborting]);
	await f.compaction.wait();
	expect(compact).not.toHaveBeenCalled();
	const held = f.queue.get().entries[0]!;
	expect(held).toMatchObject({ text: "recover me", state: "held" });
	expect(held.heldFor).toBeUndefined();
	await f.session.newSession();
	expect(f.queue.get().entries).toEqual([]);
	await f.session.switchSession(file);
	expect(f.session.sessionId).toBe(originalId);
	expect(f.queue.get().entries[0]?.id).toBe(held.id);
	expect(f.mock.calls).toHaveLength(1);
	const restored = nextTurn(f.session, 1);
	f.queue.execute({ kind: "session.queue.restore", sessionId: originalId, id: held.id, queue: "followUp" });
	await restored;
	await f.session.waitForIdle();
	expect(JSON.stringify(f.mock.calls[1]!.context.messages)).toContain("recover me");
});
