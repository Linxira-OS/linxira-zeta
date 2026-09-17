/**
 * End-to-end channel message flow: a real SessionRouter + startChannels with a
 * stubbed coordinator, mirroring zeta-server's inbound handler. Drives Telegram
 * updates (`!hello` + a plain message) through the actual channel → onInbound →
 * router → host path and asserts replies reach the channel.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChannels } from "../../src/channels";
import { SessionRouter } from "../../src/channels/session-router";
import { routeWorkspaceCommand } from "../../src/channels/workspace-router";
import { WebConfig } from "../../src/config/web-config";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";

function makeStubCoordinator(): AgentSession {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	return {
		getAgentId: () => "coordinator",
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		deliverIrcMessage: async (_msg: unknown, _opts?: unknown) => {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({
						type: "turn_end",
						turnIndex: 1,
						message: {
							role: "assistant",
							content: [{ type: "text", text: "relay reply" }],
						},
						toolResults: [],
					} as unknown as AgentSessionEvent);
				}
			});
			return "woken" as const;
		},
		setIrcAutoReplyListener: () => {},
		dispose: async () => {},
	} as unknown as AgentSession;
}

/** Poll until `sent` contains an entry matching `predicate` (bounded, no fixed sleeps). */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const started = Date.now();
	const timer = setInterval(() => {
		if (predicate()) {
			clearInterval(timer);
			resolve(true);
		} else if (Date.now() - started > timeoutMs) {
			clearInterval(timer);
			resolve(false);
		}
	}, 10);
	return promise;
}

describe("channel message flow with SessionRouter routing", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	test("!hello and a plain message both produce a channel reply through the relay", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-flow-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		const webConfig = await WebConfig.load(join(agentDir, "web.yml"));
		await webConfig.set("channels.telegram.enabled", true);
		await webConfig.set("channels.telegram.botToken", "tok");

		// Delivered outbound messages (channel.sendText → mocked fetch).
		const sent: Array<{ to: string; text: string }> = [];

		// First poll returns the `!hello` + plain-message updates; later polls
		// long-poll (wait for the abort signal) so the channel loop yields.
		const updates = [
			[
				{ update_id: 1, message: { message_id: 1, chat: { id: 1001 }, text: "!hello" } },
				{ update_id: 2, message: { message_id: 2, chat: { id: 1001 }, text: "hi there" } },
			],
		];
		let updateIdx = 0;
		const updatesReady = Promise.withResolvers<void>();
		const fetchImpl = async (input: unknown, init?: unknown): Promise<Response> => {
			const url = String(typeof input === "string" ? input : (input as Request).url);
			const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
			if (url.includes("/sendMessage")) {
				const parsed = JSON.parse(String((init as RequestInit).body)) as {
					chat_id?: number;
					text?: string;
				};
				sent.push({ to: String(parsed.chat_id), text: parsed.text ?? "" });
				return new Response(JSON.stringify({ ok: true, result: {} }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			// getUpdates: wait until the inbound handler is wired (runtime set),
			// then deliver the queued updates once, then long-poll on the signal.
			await updatesReady.promise;
			if (updateIdx < updates.length) {
				const result = updates[updateIdx++];
				return new Response(JSON.stringify({ ok: true, result }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (signal) {
				const { promise, reject } = Promise.withResolvers<Response>();
				if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
				signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
					once: true,
				});
				return promise;
			}
			throw new Error("unreachable: getUpdates without abort signal");
		};
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl as unknown as typeof globalThis.fetch);

		const coordinator = makeStubCoordinator();
		const router = new SessionRouter({
			coordinator,
			webConfig,
			getLastInbound: () => null,
			sendText: async () => {},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});

		let runtime: Awaited<ReturnType<typeof startChannels>> | null = null;
		runtime = await startChannels(coordinator, webConfig, async (channelId, peer, body) => {
			if (!runtime) return;
			// Mirror zeta-server's inbound handler.
			const consumed = await routeWorkspaceCommand(body, peer, {
				router,
				channelId,
				peer,
				sendText: text => runtime!.sendText(channelId, peer, text),
				planRequest: async () => {},
				fallback: async () => {},
			});
			if (consumed) return;
			const binding = await router.bindingFor(channelId as never, peer);
			if (binding && binding !== "main" && router) {
				await router.deliverDirect(binding, channelId as never, peer, body);
				return;
			}
			await runtime.host.deliver(channelId, peer, body);
		});
		cleanups.push(async () => {
			await runtime!.stop();
		});
		// Wire the inbound handler first; only then let the channel deliver updates.
		updatesReady.resolve();

		// `!hello` is consumed by the command router → platform reply.
		const helloDelivered = await waitFor(() => sent.some(s => s.to === "1001" && s.text.includes("[Telegram]")));
		expect(helloDelivered).toBe(true);

		// Plain message falls through to the relay host → coordinator turn reply.
		const replyDelivered = await waitFor(() => sent.some(s => s.to === "1001" && s.text === "relay reply"));
		expect(replyDelivered).toBe(true);
	});
});
