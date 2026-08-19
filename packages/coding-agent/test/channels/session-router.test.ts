/**
 * SessionRouter contracts — multi-workspace registration plus the delegated
 * `workspace_run` reply path (`[name] <reply>` prefix), verified with stubbed
 * target sessions so the observable delegation contract is pinned without a
 * live agent/model.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { SessionRouter } from "../../src/channels/session-router";
import { WebConfig } from "../../src/config/web-config";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdk from "../../src/sdk";
import type { AgentSession } from "../../src/session/agent-session";
import type { AgentSessionEvent } from "../../src/session/agent-session-events";
import { EventBus } from "../../src/utils/event-bus";

/** Stub target session: delivers IRC messages, emits a `turn_end` reply. */
function makeStubSession(agentId: string): AgentSession {
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

describe("SessionRouter", () => {
	const cleanups: Array<() => Promise<void>> = [];
	let webConfig: WebConfig;

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function makeRouter(dirs: string[]): Promise<SessionRouter> {
		webConfig = await WebConfig.load(join(await mkdtemp(join(tmpdir(), "zeta-router-")), "web.yml"));
		const coordinator = { getAgentId: () => "coordinator" } as unknown as AgentSession;
		const router = new SessionRouter({
			coordinator,
			webConfig,
			getLastInbound: () => null,
			sendText: async () => {},
		});
		cleanups.push(async () => {
			await router.stopAll();
		});
		// open() creates real AgentSessions via createAgentSession; stub that so
		// registration and the delegation path are exercised in isolation.
		vi.spyOn(sdk, "createAgentSession").mockImplementation(async options => ({
			session: makeStubSession(`agent-${path.basename(options?.cwd ?? "")}`),
			extensionsResult: { loaded: [] } as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
			eventBus: new EventBus(),
		}));
		for (const dir of dirs) {
			const result = await router.open(dir);
			expect(result.ok).toBe(true);
		}
		return router;
	}

	test("open/list registers multiple workspace sessions and persists in web.yml", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		const dir2 = await mkdtemp(join(tmpdir(), "zeta-repo2-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));
		cleanups.push(() => rm(dir2, { recursive: true, force: true }));

		const router = await makeRouter([dir1, dir2]);

		expect(router.list().sort()).toEqual([path.basename(dir1), path.basename(dir2)].sort());
		expect(webConfig.getData().remote.workspaces).toEqual([dir1, dir2]);
	});

	test("run() delegates a task and prefixes the reply with the workspace name", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		const dir2 = await mkdtemp(join(tmpdir(), "zeta-repo2-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));
		cleanups.push(() => rm(dir2, { recursive: true, force: true }));

		const router = await makeRouter([dir1, dir2]);

		const result = await router.run(path.basename(dir2), "implement the auth flow");
		expect(result.reply).toBe(`[${path.basename(dir2)}] delegated task done`);
	});

	test("run() reports unknown workspaces and close() removes a registration", async () => {
		const dir1 = await mkdtemp(join(tmpdir(), "zeta-repo1-"));
		cleanups.push(() => rm(dir1, { recursive: true, force: true }));

		const router = await makeRouter([dir1]);

		expect((await router.run("nope", "task")).reply).toBe('workspace_run: unknown workspace "nope"');

		await router.close(path.basename(dir1));
		expect(router.list()).toEqual([]);
		expect(webConfig.getData().remote.workspaces).toEqual([]);
	});
});
