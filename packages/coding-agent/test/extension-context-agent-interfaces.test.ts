import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { ExtensionContext, ExtensionFactory } from "@linxiraos/zeta/extensibility/extensions/types";
import { IrcBus } from "@linxiraos/zeta/irc/bus";
import { AgentRegistry, MAIN_AGENT_ID } from "@linxiraos/zeta/registry/agent-registry";
import { type CreateAgentSessionOptions, createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import type { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { Snowflake } from "@linxiraos/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

// Extensions reach peer agents through `ctx.agents` / `ctx.messaging`. Those must be
// backed by the SESSION's registry and the shared bus, so a private registry (used by
// embedded hosts) is visible and no second transport appears.
describe("ExtensionContext.agents / messaging", () => {
	let tempDir: string;
	const authStorages: AuthStorage[] = [];

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-ext-agent-interfaces-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		IrcBus.resetGlobalForTests();
	});

	afterEach(() => {
		for (const authStorage of authStorages.splice(0)) authStorage.close();
		IrcBus.resetGlobalForTests();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function createSession(
		extension: ExtensionFactory,
		options: Partial<CreateAgentSessionOptions> = {},
	): Promise<AgentSession> {
		const authStorage = createInMemoryAuthStorage();
		authStorages.push(authStorage);
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			modelRegistry: new ModelRegistry(authStorage, path.join(tempDir, "models.yml")),
			settings: Settings.isolated(),
			sessionManager: SessionManager.inMemory(),
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
			rules: [],
			preloadedCustomToolPaths: [],
			toolNames: ["read"],
			...options,
		});
		return session;
	}

	test("an extension sees the session registry's agents and the shared messenger", async () => {
		const registry = new AgentRegistry();
		registry.register({
			id: "0-Explore",
			displayName: "Explore",
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: null,
			status: "idle",
			sessionFile: path.join(tempDir, "0-Explore.jsonl"),
		});
		let seen: ExtensionContext | undefined;
		const session = await createSession(
			pi => {
				pi.on("before_agent_start", (_event, ctx) => {
					seen = ctx;
				});
			},
			{ agentRegistry: registry },
		);
		try {
			await session.extensionRunner!.emitBeforeAgentStart("hi", undefined, []);
			expect(seen).toBeDefined();

			// The private registry is visible; the global one would not have this ref.
			expect(seen!.agents.get("0-Explore")).toEqual({
				id: "0-Explore",
				displayName: "Explore",
				kind: "sub",
				status: "idle",
				parentId: MAIN_AGENT_ID,
			});
			expect(seen!.agents.list().map(descriptor => descriptor.id)).toContain(MAIN_AGENT_ID);
			expect(seen!.agents.get("missing")).toBeUndefined();

			// Messaging delegates to the same bus: unknown peers fail cleanly and
			// a short wait times out instead of throwing.
			expect(seen!.messaging.inbox("0-Explore")).toEqual([]);
			await expect(seen!.messaging.wait(MAIN_AGENT_ID, { from: "0-Explore" }, 5)).resolves.toBeNull();
			await expect(seen!.messaging.send(MAIN_AGENT_ID, "unknown-peer", "ping")).resolves.toMatchObject({
				to: "unknown-peer",
				outcome: "failed",
			});
		} finally {
			await session.dispose();
		}
	});
});
