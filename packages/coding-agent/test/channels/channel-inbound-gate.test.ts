/**
 * Inbound channel gate: the instance allowlist runs before any routing, and
 * platform message-id dedupe (including across a restart) drops retried
 * updates before they can start a second turn.
 *
 * Both are exercised through the real Telegram adapter + `startChannels`, so
 * the test covers the same path `zetacode serve` uses (channel → routeInbound →
 * `onInbound`), not just the host helper.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ChannelSession,
	type ChannelSessionEvent,
	type IrcMessage,
	channelSeenStatePath,
	startChannels,
} from "@linxiraos/pi-channels";
import type { SessionRouter } from "../../src/channels/session-router";
import { routeWorkspaceCommand } from "../../src/channels/workspace-router";
import { WebConfig } from "../../src/config/web-config";

type TelegramUpdate = {
	update_id: number;
	message: { message_id: number; chat: { id: number }; text: string };
};

interface TelegramMock {
	sent: Array<{ to: string; text: string }>;
	release(): void;
	/**
	 * Resolves once the adapter has called `getUpdates` at least `count` times.
	 * Call `count = batches.length + 2` to be sure a served batch was processed.
	 */
	pollsAtLeast(count: number): Promise<void>;
	waitForSent(predicate: (entry: { to: string; text: string }) => boolean): Promise<void>;
}

function installTelegramMock(batches: TelegramUpdate[][]): TelegramMock {
	const sent: Array<{ to: string; text: string }> = [];
	const sentWaiters: Array<{ predicate: (entry: { to: string; text: string }) => boolean; resolve: () => void }> = [];
	const pollWaiters: Array<{ count: number; resolve: () => void }> = [];
	const { promise: released, resolve: release } = Promise.withResolvers<void>();
	let index = 0;
	let polls = 0;

	const noteSent = (entry: { to: string; text: string }): void => {
		sent.push(entry);
		for (const waiter of [...sentWaiters]) {
			if (!waiter.predicate(entry)) continue;
			sentWaiters.splice(sentWaiters.indexOf(waiter), 1);
			waiter.resolve();
		}
	};

	const fetchImpl = async (input: unknown, init?: unknown): Promise<Response> => {
		const url = String(typeof input === "string" ? input : (input as Request).url);
		const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
		if (url.includes("/sendMessage")) {
			const parsed = JSON.parse(String((init as RequestInit).body)) as { chat_id?: number | string; text?: string };
			noteSent({ to: String(parsed.chat_id), text: parsed.text ?? "" });
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		polls += 1;
		for (const waiter of [...pollWaiters]) {
			if (polls < waiter.count) continue;
			pollWaiters.splice(pollWaiters.indexOf(waiter), 1);
			waiter.resolve();
		}
		await released;
		if (index < batches.length) {
			const result = batches[index++];
			return new Response(JSON.stringify({ ok: true, result }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		// Long poll: hold the request until the channel stops.
		const { promise, reject } = Promise.withResolvers<Response>();
		if (!signal) throw new Error("getUpdates without an abort signal");
		if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
		else signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
		return promise;
	};

	vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl as unknown as typeof globalThis.fetch);

	return {
		sent,
		release,
		pollsAtLeast(count) {
			if (polls >= count) return Promise.resolve();
			const { promise, resolve } = Promise.withResolvers<void>();
			pollWaiters.push({ count, resolve });
			return promise;
		},
		waitForSent(predicate) {
			const existing = sent.find(predicate);
			if (existing) return Promise.resolve();
			const { promise, resolve } = Promise.withResolvers<void>();
			sentWaiters.push({ predicate, resolve });
			return promise;
		},
	};
}

function makeSessionStub(): { session: ChannelSession; deliveries: IrcMessage[] } {
	const deliveries: IrcMessage[] = [];
	const session: ChannelSession = {
		getAgentId: () => "coordinator",
		deliverIrcMessage: async (msg: IrcMessage) => {
			deliveries.push(msg);
			return "woken" as const;
		},
		subscribe: (_handler: (event: ChannelSessionEvent) => void) => () => {},
		setIrcAutoReplyListener: () => {},
	};
	return { session, deliveries };
}

async function makeTelegramConfig(agentDir: string, allowedPeers: string[]): Promise<WebConfig> {
	await Bun.write(
		join(agentDir, "web.yml"),
		JSON.stringify({
			channels: {
				instances: [
					{
						id: "telegram",
						platform: "telegram",
						label: "Telegram",
						enabled: true,
						agentProfile: "companion",
						allow: { peers: allowedPeers },
						credentials: { botToken: "tok" },
					},
				],
			},
			imAgents: [
				{
					id: "companion",
					label: "Companion",
					persona: { mode: "workspace" },
					location: { kind: "workspace", workspace: "main" },
					tools: {
						builtin: [],
						extensions: [],
						customTools: [],
						mcpServers: [],
						skills: [],
						commands: [],
					},
					memory: {},
				},
			],
			remote: {},
		}),
	);
	return WebConfig.load(join(agentDir, "web.yml"));
}

describe("channel inbound authorization gate", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	test("an unauthorized peer cannot open a workspace or reach routing", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-channel-gate-"));
		const evilDir = await mkdtemp(join(tmpdir(), "zeta-channel-evil-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		cleanups.push(() => rm(evilDir, { recursive: true, force: true }));
		const webConfig = await makeTelegramConfig(agentDir, ["1001"]);

		const openWorkspace = vi.fn(async () => ({ ok: true as const, alias: "evil" }));
		const routerStub = {
			open: openWorkspace,
			list: () => [],
			bindingFor: async () => null,
		} as unknown as SessionRouter;

		const inbound: Array<{ peer: string; body: string }> = [];
		const mock = installTelegramMock([
			[
				{ update_id: 1, message: { message_id: 1, chat: { id: 2002 }, text: `@workspace open "${evilDir}" evil` } },
				{ update_id: 2, message: { message_id: 2, chat: { id: 1001 }, text: "!hello" } },
			],
		]);
		const { session } = makeSessionStub();
		let runtime: Awaited<ReturnType<typeof startChannels>> | null = null;
		runtime = await startChannels(
			session,
			webConfig,
			async (channelId, peer, body) => {
				inbound.push({ peer, body });
				await routeWorkspaceCommand(body, peer, {
					router: routerStub,
					channelId,
					peer,
					sendText: text => runtime!.sendText(channelId, peer, text),
					planRequest: async () => {},
					fallback: async () => {},
				});
			},
			undefined,
			{ stateDir: agentDir },
		);
		cleanups.push(async () => {
			await runtime!.stop();
		});
		mock.release();

		// The authorized chat still works; the unauthorized one is refused.
		await mock.waitForSent(entry => entry.to === "1001" && entry.text.includes("[Telegram]"));
		await mock.waitForSent(entry => entry.to === "2002" && entry.text.includes("Not authorized"));

		// The command never reached the router: no workspace was opened.
		expect(openWorkspace).not.toHaveBeenCalled();
		expect(inbound.map(entry => entry.peer)).toEqual(["1001"]);
	});
});

describe("channel inbound dedupe", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	test("a retried message id is routed once", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-channel-dedupe-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		const webConfig = await makeTelegramConfig(agentDir, ["1001"]);

		const inbound: string[] = [];
		const mock = installTelegramMock([
			[{ update_id: 1, message: { message_id: 7, chat: { id: 1001 }, text: "hello" } }],
			[{ update_id: 2, message: { message_id: 7, chat: { id: 1001 }, text: "hello" } }],
		]);
		const { session } = makeSessionStub();
		const runtime = await startChannels(session, webConfig, (_channelId, peer) => {
			inbound.push(peer);
		});
		cleanups.push(async () => {
			await runtime.stop();
		});
		mock.release();

		// Third poll ⇒ the second batch has been processed.
		await mock.pollsAtLeast(3);
		expect(inbound).toEqual(["1001"]);
	});

	test("seen state persists across a restart and drops the replay", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-channel-restart-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		const webConfig = await makeTelegramConfig(agentDir, ["1001"]);
		const replayed: TelegramUpdate[][] = [
			[{ update_id: 1, message: { message_id: 42, chat: { id: 1001 }, text: "hello" } }],
		];

		const firstInbound: string[] = [];
		const firstMock = installTelegramMock(replayed);
		const first = await startChannels(
			makeSessionStub().session,
			webConfig,
			(_channelId, peer) => {
				firstInbound.push(peer);
			},
			undefined,
			{ stateDir: agentDir },
		);
		firstMock.release();
		await firstMock.pollsAtLeast(2);
		expect(firstInbound).toEqual(["1001"]);
		await first.stop();

		// The state file is durable and names the accepted id.
		const statePath = channelSeenStatePath(agentDir);
		const state = await readFile(statePath, "utf8");
		expect(state).toContain("42");

		// A fresh runtime (a restart) replays the same update.
		vi.restoreAllMocks();
		const secondInbound: string[] = [];
		const secondMock = installTelegramMock([[replayed[0]![0]!]]);
		const second = await startChannels(
			makeSessionStub().session,
			webConfig,
			(_channelId, peer) => {
				secondInbound.push(peer);
			},
			undefined,
			{ stateDir: agentDir },
		);
		cleanups.push(async () => {
			await second.stop();
		});
		secondMock.release();
		await secondMock.pollsAtLeast(2);
		expect(secondInbound).toEqual([]);
	});
});
