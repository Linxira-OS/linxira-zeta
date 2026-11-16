import { expect, test } from "bun:test";
import { once, EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { AgentRegistry } from "../../src/registry/agent-registry";
import type { AgentSession } from "../../src/session/agent-session";
import { StudioBrowserObservationService } from "../../src/server/studio-host/services/browser-observation";
import type {
	BrowserObservationEvent,
	StudioBrowserTab,
} from "../../src/server/studio-host/protocol/contracts/browser-observation";
import { studioTabControlState, studioTabIdentity } from "../../src/tools/browser/studio-control";
import { acquireBrowser, releaseBrowser } from "../../src/tools/browser/registry";
import {
	acquireTab,
	createStudioBrowserObservation,
	releaseTab,
	runInTab,
} from "../../src/tools/browser/tab-supervisor";
import type { ToolSession } from "../../src/tools";

/** Real CDP and private pipe: signals come from socket/page events, never guessed sleeps. */
test("private browser observation scopes descendants, preserves viewport and returns control on owner loss", async () => {
	const scratch = path.resolve(import.meta.dir, "../../../../temp");
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(path.join(scratch, "studio-browser-"));
	const prefix = path.basename(directory);
	const settings = Settings.isolated();
	const makeOwner = (name: string) =>
		({
			sessionId: prefix + name,
			instanceKey: prefix + name,
			settings,
			isDisposed: false,
			getEvalKernelOwnerId: () => prefix + name + "-kernel",
			activeToolExecutionUpdates: () => [],
		}) as unknown as AgentSession;
	const parent = makeOwner("-parent"),
		child = makeOwner("-child"),
		foreign = makeOwner("-foreign");
	const registry = AgentRegistry.global();
	const refs = [
		registry.register({ id: parent.sessionId, displayName: "Parent", kind: "main", session: parent }),
		registry.register({
			id: child.sessionId,
			displayName: "Child",
			kind: "sub",
			parentId: parent.sessionId,
			session: child,
		}),
		registry.register({ id: foreign.sessionId, displayName: "Foreign", kind: "main", session: foreign }),
	];
	let live = true;
	const service = new StudioBrowserObservationService(parent, directory, directory, () => live);
	const foreignService = new StudioBrowserObservationService(foreign, directory, directory);
	const clicked = Promise.withResolvers<void>();
	const server = Bun.serve({
		port: 0,
		fetch: req => {
			if (new URL(req.url).pathname === "/clicked") {
				clicked.resolve();
				return new Response("ok");
			}
			return new Response(
				'<!doctype html><title>Observation fixture</title><body style="margin:0"><button style="position:absolute;left:100px;top:100px;width:200px;height:80px" onclick="this.textContent=\'Clicked\';fetch(\'/clicked\')">Click</button>',
				{ headers: { "content-type": "text/html" } },
			);
		},
	});
	const browser = await acquireBrowser({ kind: "headless", headless: true }, { cwd: directory });
	const names = [prefix + "-owned", prefix + "-foreign"];
	const sockets: Socket[] = [];
	try {
		const tabs = [];
		for (const [index, owner] of [child, foreign].entries()) {
			tabs.push(
				(
					await acquireTab(names[index]!, browser, {
						ownerSessionId: owner.getEvalKernelOwnerId(),
						url: `http://127.0.0.1:${server.port}`,
						viewport: { width: 1000, height: 600 },
						timeoutMs: 30_000,
					})
				).tab,
			);
		}
		const tab = tabs[0]!;
		const toolSession = { cwd: directory, settings, getSessionId: () => child.sessionId } as unknown as ToolSession;
		const baseline = (
			await runInTab(tab.name, {
				code: "return await page.evaluate(() => ({width:innerWidth,height:innerHeight}))",
				timeoutMs: 5000,
				session: toolSession,
			})
		).returnValue as { width: number; height: number };
		const listed = (await service.execute({ kind: "browser.tabs.get", sessionId: parent.sessionId })) as {
			tabs: StudioBrowserTab[];
		};
		expect(listed.tabs.map(row => row.ownerSessionId)).toEqual([child.sessionId]);
		await expect(
			foreignService.execute({
				kind: "browser.observe.prepare",
				sessionId: foreign.sessionId,
				tabId: studioTabIdentity(tab),
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(service.execute({ kind: "browser.tabs.get", sessionId: foreign.sessionId })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		const prepared = (await service.execute({
			kind: "browser.observe.prepare",
			sessionId: parent.sessionId,
			tabId: studioTabIdentity(tab),
		})) as { observationId: string };
		const descriptorPath = path.join(directory, "browser", prepared.observationId + ".json");
		const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as { endpoint: string; token: string };
		expect(JSON.stringify(prepared)).not.toContain(descriptor.token);
		expect(JSON.stringify(prepared)).not.toContain(descriptor.endpoint);
		// UTF-8 token text with 64 code units must reject without throwing timingSafeEqual's size error.
		const malformed = connect(descriptor.endpoint);
		sockets.push(malformed);
		malformed.on("error", () => {});
		const malformedClosed = once(malformed, "close");
		await once(malformed, "connect");
		malformed.write("é".repeat(64) + "\n");
		await malformedClosed;
		const peer = connect(descriptor.endpoint);
		sockets.push(peer);
		peer.on("error", () => {});
		const events: BrowserObservationEvent[] = [];
		const signal = new EventEmitter();
		let pending = "";
		peer.on("data", bytes => {
			pending += bytes.toString("utf8");
			for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
				const line = pending.slice(0, at);
				pending = pending.slice(at + 1);
				if (line === "OK") continue;
				const event = JSON.parse(line) as BrowserObservationEvent;
				events.push(event);
				if (event.kind === "frame") peer.write(JSON.stringify({ kind: "ack", sequence: event.sequence }) + "\n");
				signal.emit("event");
			}
		});
		const waitFor = async (predicate: () => boolean) => {
			while (!predicate()) await once(signal, "event");
		};
		await once(peer, "connect");
		peer.write(descriptor.token + "\n");
		await waitFor(() => events.some(event => event.kind === "frame"));
		const frame = events.find(event => event.kind === "frame")!;
		if (frame.kind !== "frame") throw new Error("Expected browser frame");
		expect({ width: frame.width, height: frame.height }).toEqual(baseline);
		expect(Buffer.from(frame.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
		const catalog = (
			await runInTab(tab.name, {
				code: "throw new Error('typed route must not execute code')",
				webmcp: { action: "list" },
				timeoutMs: 5000,
				session: toolSession,
			})
		).returnValue;
		expect(catalog).toMatchObject({ untrusted: true, tools: [] });
		const changes = (
			await runInTab(tab.name, {
				code: "throw new Error('typed route must not execute code')",
				webmcp: { action: "events" },
				timeoutMs: 5000,
				session: toolSession,
			})
		).returnValue;
		expect(changes).toMatchObject({ untrusted: true, events: [], cursor: 0 });
		peer.write('{"kind":"take"}\n');
		await waitFor(() => events.some(event => event.kind === "state" && event.control === "human"));
		await expect(runInTab(tab.name, { code: "return 1", timeoutMs: 1000, session: toolSession })).rejects.toThrow(
			"human control",
		);
		const latest = events.filter(event => event.kind === "frame").at(-1)!;
		peer.write(
			JSON.stringify({ kind: "click", sequence: latest.sequence, x: 0.2, y: 140 / 600, button: "left" }) + "\n",
		);
		await clicked.promise;
		peer.write('{"kind":"release"}\n');
		await waitFor(() => events.filter(event => event.kind === "state").at(-1)?.control === "agent");
		expect(
			(
				await runInTab(tab.name, {
					code: "return await page.evaluate(() => ({width:innerWidth,height:innerHeight}))",
					timeoutMs: 5000,
					session: toolSession,
				})
			).returnValue,
		).toEqual(baseline);
		peer.write('{"kind":"take"}\n');
		await waitFor(() => studioTabControlState(tab) === "other-window");
		const closed = once(peer, "close");
		registry.unregister(child.sessionId, refs[1]);
		await closed;
		expect(studioTabControlState(tab)).toBe("agent");
		expect(tab.state).toBe("alive");
		expect(events.filter(event => event.kind === "error")).toEqual([]);
		live = false;
		await expect(service.execute({ kind: "browser.tabs.get", sessionId: parent.sessionId })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	} finally {
		for (const socket of sockets) socket.destroy();
		service.dispose();
		foreignService.dispose();
		for (const name of names) await releaseTab(name, { kill: true }).catch(() => false);
		await releaseBrowser(browser, { kill: true });
		server.stop(true);
		for (const ref of refs) registry.unregister(ref.id, ref);
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);

/** A crashed renderer leaves no document to observe: the window loses control and its frame stream closes. */
test("private browser observation closes and releases control when the page crashes", async () => {
	const scratch = path.resolve(import.meta.dir, "../../../../temp");
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(path.join(scratch, "studio-browser-crash-"));
	const prefix = path.basename(directory);
	const settings = Settings.isolated();
	const owner = {
		sessionId: prefix,
		instanceKey: prefix,
		settings,
		isDisposed: false,
		getEvalKernelOwnerId: () => prefix + "-kernel",
		activeToolExecutionUpdates: () => [],
	} as unknown as AgentSession;
	const registry = AgentRegistry.global();
	const ref = registry.register({ id: owner.sessionId, displayName: "Crash", kind: "main", session: owner });
	const service = new StudioBrowserObservationService(owner, directory, directory);
	const server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response("<!doctype html><title>Crash fixture</title><body>crash</body>", {
				headers: { "content-type": "text/html" },
			}),
	});
	const browser = await acquireBrowser({ kind: "headless", headless: true }, { cwd: directory });
	const name = prefix + "-observed";
	let tab: Awaited<ReturnType<typeof acquireTab>>["tab"] | undefined;
	let peer: Socket | undefined;
	try {
		tab = (
			await acquireTab(name, browser, {
				ownerSessionId: owner.getEvalKernelOwnerId(),
				url: `http://127.0.0.1:${server.port}`,
				timeoutMs: 30_000,
			})
		).tab;
		const prepared = (await service.execute({
			kind: "browser.observe.prepare",
			sessionId: owner.sessionId,
			tabId: studioTabIdentity(tab),
		})) as { observationId: string };
		const descriptor = JSON.parse(
			await readFile(path.join(directory, "browser", prepared.observationId + ".json"), "utf8"),
		) as { endpoint: string; token: string };
		peer = connect(descriptor.endpoint);
		peer.on("error", () => {});
		const events: BrowserObservationEvent[] = [];
		const signal = new EventEmitter();
		let pending = "";
		peer.on("data", bytes => {
			pending += bytes.toString("utf8");
			for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
				const line = pending.slice(0, at);
				pending = pending.slice(at + 1);
				if (line === "OK") continue;
				const event = JSON.parse(line) as BrowserObservationEvent;
				events.push(event);
				if (event.kind === "frame") peer!.write(JSON.stringify({ kind: "ack", sequence: event.sequence }) + "\n");
				signal.emit("event");
			}
		});
		const waitFor = async (predicate: () => boolean) => {
			while (!predicate()) await once(signal, "event");
		};
		await once(peer, "connect");
		peer.write(descriptor.token + "\n");
		await waitFor(() => events.some(event => event.kind === "frame"));
		const first = events.find(event => event.kind === "frame");
		if (first?.kind !== "frame") throw new Error("Expected a frame");
		peer.write('{"kind":"take"}\n');
		await waitFor(() => studioTabControlState(tab!, prepared.observationId) === "human");
		const closed = once(peer, "close");
		const cdp = await createStudioBrowserObservation(tab);
		// A cross-document navigation starts a new frame epoch: the previous frame's sequence cannot drive the new document.
		await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?next` });
		await waitFor(() => events.some(event => event.kind === "frame" && event.sequence > first.sequence));
		peer.write(JSON.stringify({ kind: "click", sequence: first.sequence, x: 0.5, y: 0.5, button: "left" }) + "\n");
		await waitFor(() => events.some(event => event.kind === "error"));
		expect(studioTabControlState(tab!, prepared.observationId)).toBe("human");
		void cdp.send("Page.crash").catch(() => undefined);
		await closed;
		expect(events.some(event => event.kind === "closed")).toBe(true);
		expect(studioTabControlState(tab)).toBe("agent");
	} finally {
		peer?.destroy();
		service.dispose();
		await releaseTab(name, { kill: true }).catch(() => false);
		await releaseBrowser(browser, { kill: true });
		server.stop(true);
		registry.unregister(ref.id, ref);
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);
