import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { DesktopCapabilities, DesktopCapture, DesktopDisplay } from "@linxiraos/pi-natives";
import { Settings } from "../src/config/settings";
import type { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { registerLocalSession } from "../src/thread/session-directory";
import {
	StudioComputerWorkspaceService,
	type ComputerWorkspaceView,
} from "../src/server/studio-host/services/computer-workspace-service";
import type { ComputerObserver } from "../src/server/studio-host/services/computer-observer";
import type {
	ComputerObservationLease,
	ComputerWorkspaceSnapshot,
} from "../src/server/studio-host/protocol/contracts/computer-workspace";
import {
	computerRunPermits,
	emitComputerLifecycle,
	computerToolResultDelivered,
} from "../src/tools/computer/lifecycle";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3WQAAAAASUVORK5CYII=",
	"base64",
);
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposers.splice(0).reverse()) await dispose();
});
async function harness(capture?: () => Promise<DesktopCapture>, supported = true) {
	const directory = await mkdtemp(fileURLToPath(new URL("../../../temp/zeta-computer-workspace-", import.meta.url)));
	disposers.push(() => rm(directory, { recursive: true, force: true }));
	const manager = SessionManager.inMemory();
	const id = manager.getSessionId(),
		key = "main:" + crypto.randomUUID();
	// Native observer/session seams are supplied without ever opening a real desktop in a behavior test.
	const session = {
		sessionId: id,
		instanceKey: key,
		sessionManager: manager,
		settings: Settings.isolated({ "computer.enabled": true }),
		getEvalKernelOwnerId: () => key,
		getEvalToolSession: () => undefined,
		getEvalPreludes: () => [],
		isDisposed: false,
	} as unknown as AgentSession;
	registerLocalSession(session);
	let reads = 0,
		closed = 0,
		cancelled = 0,
		live = true;
	const frame: DesktopCapture = {
		data: png,
		width: 1,
		height: 1,
		coordinateWidth: 1,
		coordinateHeight: 1,
		sourceWidth: 1,
		sourceHeight: 1,
		target: "display:test",
		backend: "x11",
		displays: [],
		screenLocked: false,
	};
	const capabilities: DesktopCapabilities = {
		backend: "x11",
		capture: true,
		input: false,
		ax: false,
		backgroundWindowInput: false,
		takeover: false,
		applications: false,
		menus: false,
		heldInput: false,
		spaces: false,
		globalEscape: false,
		secureInput: false,
		capturePermission: "granted",
		inputPermission: "unavailable",
		axPermission: "unavailable",
		displayCount: 1,
		screenLocked: false,
		displayAsleep: false,
	};
	const display: DesktopDisplay = {
		id: "test",
		name: "Test",
		width: 1,
		height: 1,
		x: 0,
		y: 0,
		scale: 1,
		pixelX: 0,
		pixelY: 0,
		pixelWidth: 1,
		pixelHeight: 1,
		isPrimary: true,
	};
	const observer = (): ComputerObserver => ({
		observationOnly: supported,
		capabilities,
		screenState: { screenLocked: false, displayAsleep: false },
		listDisplays: async () => {
			reads++;
			return [display];
		},
		listWindows: async () => [],
		capture: capture ?? (async () => frame),
		observe: async () => {
			throw new Error("AX unavailable");
		},
		cancel() {
			cancelled++;
		},
		close: async () => {
			closed++;
		},
	});
	const service = new StudioComputerWorkspaceService(session, {
		directory,
		observer,
		ownedSessions: () => [session],
		revoke: async () => {},
	});
	disposers.push(() => service.dispose());
	const view: ComputerWorkspaceView = { ownerId: "private-view", isLive: () => live };
	return {
		service,
		session,
		directory,
		frame,
		view,
		counters: () => ({ reads, closed, cancelled }),
		closeView: () => {
			live = false;
		},
	};
}

test("positive passive probe precedes every native read; observer creation never enables fallback input", async () => {
	const h = await harness(undefined, false);
	const state = (await h.service.query(
		{ kind: "computer.workspace.get", sessionId: h.session.sessionId },
		h.view,
	)) as ComputerWorkspaceSnapshot;
	expect(state.capabilities.capture).toBe(false);
	expect(state.capabilities.observationOnly).toBe(false);
	expect(h.counters().reads).toBe(0);
	expect(h.counters().closed).toBe(1);
});

test("a closed view invalidates pending capture and removes its reservation and descriptor", async () => {
	const ready = Promise.withResolvers<void>(),
		deferred = Promise.withResolvers<DesktopCapture>();
	const h = await harness(() => {
		ready.resolve();
		return deferred.promise;
	});
	await h.service.query({ kind: "computer.workspace.get", sessionId: h.session.sessionId }, h.view);
	const lease = (await h.service.execute(
		{ kind: "computer.observe.open", sessionId: h.session.sessionId, consumerId: "panel" },
		h.view,
	)) as ComputerObservationLease;
	const capture = h.service.execute(
		{
			kind: "computer.frame.capture",
			sessionId: h.session.sessionId,
			leaseId: lease.leaseId,
			targetId: "display:test",
		},
		h.view,
	);
	await ready.promise;
	h.closeView();
	const rejection = capture.then(
		() => false,
		() => true,
	);
	const release = h.service.releaseOwner(h.view.ownerId);
	deferred.resolve(h.frame);
	expect(await rejection).toBe(true);
	await release;
	expect(h.counters().cancelled).toBeGreaterThan(0);
	await expect(readFile(join(h.directory, "computer-views", lease.leaseId + ".json"))).rejects.toThrow();
	const budget = JSON.parse(
		await readFile(join(h.directory, "computer-workspace", "observation-budget.json"), "utf8"),
	);
	expect(budget.reservations).toEqual([]);
});

test("execution evidence is metadata-only and delivered only when its bytes enter the real outer result", async () => {
	const h = await harness();
	await h.service.query({ kind: "computer.workspace.get", sessionId: h.session.sessionId }, h.view);
	const identity = {
		runId: crypto.randomUUID(),
		sessionId: h.session.sessionId,
		instanceKey: h.session.instanceKey,
		toolCallId: "outer-eval",
	};
	expect(
		(await computerRunPermits(identity.sessionId, h.session.getEvalKernelOwnerId(), identity.instanceKey)).length,
	).toBe(1);
	const file = join(h.directory, "native-source.png");
	await writeFile(file, png);
	emitComputerLifecycle({ kind: "run", identity, phase: "running", at: Date.now() });
	emitComputerLifecycle({
		kind: "frame",
		identity,
		at: Date.now(),
		screenshot: {
			path: file,
			target: "desktop",
			width: 1,
			height: 1,
			coordinateWidth: 1,
			coordinateHeight: 1,
			sourceWidth: 1,
			sourceHeight: 1,
			frameId: crypto.randomUUID(),
			sha256: createHash("sha256").update(png).digest("hex"),
		},
	});
	const wrong = { content: [], details: {} };
	computerToolResultDelivered(identity.sessionId, "other-call", wrong, identity.instanceKey);
	expect(wrong.details).toEqual({});
	const result = { content: [{ type: "image", mimeType: "image/png", data: png.toString("base64") }], details: {} };
	computerToolResultDelivered(identity.sessionId, "outer-eval", result, identity.instanceKey);
	const state = (await h.service.query(
		{ kind: "computer.workspace.get", sessionId: h.session.sessionId },
		h.view,
	)) as ComputerWorkspaceSnapshot;
	expect(state.frames[0]?.delivered).toBe(true);
	expect(JSON.stringify(state)).not.toContain(file);
	expect(JSON.stringify(state)).not.toContain(png.toString("base64"));
	expect(
		"computerFrames" in result.details &&
			Array.isArray(result.details.computerFrames) &&
			result.details.computerFrames.length === 1,
	).toBe(true);
	await h.service.dispose();
	expect(await readFile(file)).toEqual(png);
});
