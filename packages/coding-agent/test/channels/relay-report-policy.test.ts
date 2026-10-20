/**
 * D4 — `channels.reportPolicy` decides how delegated work reaches the IM user:
 *
 * - `all` forwards every report (delegation start plus outcome);
 * - `summary` (default) sends one merged message on stage completion/failure;
 * - `silent` forwards nothing; the report stays in the coordinator transcript.
 *
 * The delegation seam is `workspace_run` (`SessionRouter.run`), the only place
 * a delegated stage currently starts and finishes.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { SessionRouter } from "../../src/channels/session-router";
import { Settings } from "../../src/config/settings";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

/** Stub target session: delivers IRC messages and emits a `turn_end` reply. */
function makeStubSession(agentId: string, opts: { failDelivery?: boolean } = {}): AgentSession {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	return {
		getAgentId: () => agentId,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		deliverIrcMessage: async () => {
			if (opts.failDelivery) throw new Error("delivery refused");
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({
						type: "turn_end",
						turnIndex: 1,
						message: {
							role: "assistant",
							content: [{ type: "text", text: "delegated task done" }],
						},
						toolResults: [],
					} as unknown as AgentSessionEvent);
				}
			});
			return "woken" as const;
		},
		dispose: async () => {},
	} as unknown as AgentSession;
}

describe("relay report policy (D4)", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const sent: string[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		sent.length = 0;
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function makeRouter(policy: "all" | "summary" | "silent", opts: { failDelivery?: boolean } = {}) {
		const dir = await mkdtemp(join(tmpdir(), "zeta-report-policy-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const webConfig = await WebConfig.load(join(dir, "web.yml"));
		const router = new SessionRouter({
			coordinator: {
				getAgentId: () => "coordinator",
				settings: Settings.isolated({ "channels.reportPolicy": policy }),
			} as unknown as AgentSession,
			webConfig,
			getLastInbound: () => ({ channelId: "feishu", peer: "peer-1" }),
			sendText: async (_channel, _to, text) => {
				sent.push(text);
			},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`, opts),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		const opened = await router.open(dir, "repo");
		expect(opened.ok).toBe(true);
		return { router, label: path.basename(dir) };
	}

	test("all forwards the delegation start and the completion", async () => {
		const { router, label } = await makeRouter("all");
		const result = await router.run("repo", "survey CI");
		expect(result.reply).toBe(`[${label}] delegated task done`);
		expect(sent).toHaveLength(2);
		expect(sent[0]).toContain(`[${label}] delegated: survey CI`);
		expect(sent[1]).toContain("delegated task done");
	});

	test("all forwards a delegation failure too", async () => {
		const { router } = await makeRouter("all", { failDelivery: true });
		const result = await router.run("repo", "survey CI");
		expect(result.reply).toContain("failed");
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("failed");
	});

	test("summary sends one merged message on completion", async () => {
		const { router, label } = await makeRouter("summary");
		await router.run("repo", "survey CI");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain(`[${label}] delegated: survey CI`);
		expect(sent[0]).toContain("delegated task done");
	});

	test("summary sends the failure alone", async () => {
		const { router } = await makeRouter("summary", { failDelivery: true });
		await router.run("repo", "survey CI");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("failed");
	});

	test("silent forwards nothing", async () => {
		const { router, label } = await makeRouter("silent");
		const result = await router.run("repo", "survey CI");
		expect(result.reply).toBe(`[${label}] delegated task done`);
		expect(sent).toEqual([]);
	});

	test("a delegation with no inbound chat reports nowhere", async () => {
		const dir = await mkdtemp(join(tmpdir(), "zeta-report-policy-none-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const webConfig = await WebConfig.load(join(dir, "web.yml"));
		const router = new SessionRouter({
			coordinator: {
				getAgentId: () => "coordinator",
				settings: Settings.isolated({ "channels.reportPolicy": "all" }),
			} as unknown as AgentSession,
			webConfig,
			getLastInbound: () => null,
			sendText: async (_channel, _to, text) => {
				sent.push(text);
			},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		expect((await router.open(dir, "repo")).ok).toBe(true);
		await router.run("repo", "survey CI");
		expect(sent).toEqual([]);
	});
});
