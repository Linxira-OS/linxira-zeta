/**
 * Multi-root identity contracts (one process, several top-level sessions).
 *
 * `zeta serve` hosts a coordinator, bot sessions, web-UI chats and
 * router-opened workspaces in one process. They used to register as the
 * constant `MAIN_AGENT_ID`, so the last one silently displaced the rest:
 * broadcast and `agent://main` excluded the others, and a second session
 * addressing `main` hit its own id as a self-send.
 *
 * - the first/lone root keeps `MAIN_AGENT_ID`; later roots use their session id;
 * - `register()` refuses a duplicate id instead of replacing its owner;
 * - `agent://main` resolves to the caller's workspace main, never to itself;
 * - broadcast reaches every live peer and excludes only the sender.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { IrcBus } from "@linxiraos/zeta/irc/bus";
import { setMeshNode } from "@linxiraos/zeta/mesh/global";
import type { MeshNode } from "@linxiraos/zeta/mesh/mesh-node";
import { executeSend } from "@linxiraos/zeta/irc/messaging";
import { AgentRegistry, MAIN_AGENT_ID } from "@linxiraos/zeta/registry/agent-registry";

interface FakeSession {
	delivered: IrcMessage[];
	session: AgentSession;
}

function fakeSession(): FakeSession {
	const delivered: IrcMessage[] = [];
	const session = {
		deliverIrcMessage: async (msg: IrcMessage): Promise<"injected" | "woken"> => {
			delivered.push(msg);
			return "injected";
		},
		emitIrcRelayObservation: (): void => {},
	} as unknown as AgentSession;
	return { delivered, session };
}

describe("multi-root agent identity", () => {
	beforeEach(() => {
		IrcBus.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	afterEach(() => {
		setMeshNode(undefined);
		IrcBus.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("keeps MAIN_AGENT_ID for the first root and mints the session id for the next", () => {
		const registry = new AgentRegistry();
		const first = registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: null,
			workspaceId: "workspace-a",
			sessionId: "session-a",
		});
		const second = registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: null,
			workspaceId: "workspace-a",
			sessionId: "session-b",
		});

		expect(first.id).toBe(MAIN_AGENT_ID);
		expect(second.id).toBe("session-b");
		expect(registry.listVisibleTo(first.id).map(ref => ref.id)).toEqual(["session-b"]);
		expect(registry.listVisibleTo(second.id).map(ref => ref.id)).toEqual([MAIN_AGENT_ID]);
	});

	it("rejects a duplicate id instead of replacing the previous owner", () => {
		const registry = new AgentRegistry();
		const owner = registry.register({ id: "worker", displayName: "worker", kind: "sub", session: null });

		expect(() => registry.register({ id: "worker", displayName: "impostor", kind: "sub", session: null })).toThrow(
			/already registered/,
		);
		// The first registration is untouched.
		expect(registry.get("worker")).toBe(owner);
		expect(registry.get("worker")?.displayName).toBe("worker");
	});

	it("delivers agent://main from a second root to the workspace main, not to the sender", async () => {
		const registry = AgentRegistry.global();
		const main = fakeSession();
		const second = fakeSession();
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: main.session,
			workspaceId: "workspace-a",
			sessionId: "session-main",
		});
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: second.session,
			workspaceId: "workspace-a",
			sessionId: "session-second",
		});

		const receipt = await IrcBus.global().send({ from: "session-second", to: "agent://main", body: "ping" });

		expect(receipt).toMatchObject({ to: MAIN_AGENT_ID, outcome: "injected" });
		expect(main.delivered.map(message => message.body)).toEqual(["ping"]);
		expect(second.delivered).toHaveLength(0);
	});

	it("fails loudly when the workspace main addresses main itself", async () => {
		const registry = AgentRegistry.global();
		const main = fakeSession();
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: main.session,
			workspaceId: "workspace-a",
			sessionId: "session-main",
		});

		const result = await executeSend({ registry, senderId: MAIN_AGENT_ID }, { to: "main", message: "hi" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("yourself");
		expect(main.delivered).toHaveLength(0);
	});

	it("resolves main within the caller's workspace, not to another workspace's root", async () => {
		const registry = AgentRegistry.global();
		const workspaceA = fakeSession();
		const workspaceB = fakeSession();
		const workspaceBSecond = fakeSession();
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: workspaceA.session,
			workspaceId: "workspace-a",
			sessionId: "session-main",
		});
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: workspaceB.session,
			workspaceId: "workspace-b",
			sessionId: "session-b-main",
		});
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: workspaceBSecond.session,
			workspaceId: "workspace-b",
			sessionId: "session-b-second",
		});

		const receipt = await IrcBus.global().send({
			from: "session-b-second",
			to: "agent://main",
			body: "local main",
		});

		expect(receipt).toMatchObject({ to: "session-b-main", outcome: "injected" });
		expect(workspaceB.delivered.map(message => message.body)).toEqual(["local main"]);
		expect(workspaceA.delivered).toHaveLength(0);
	});

	it("fails an alias for a local workspace with no live main instead of bouncing it through the mesh", async () => {
		const registry = AgentRegistry.global();
		const meshSends: unknown[] = [];
		setMeshNode({
			workspaceId: "workspace-a",
			stripLocalAddress: (raw: string) => (raw === "workspace-a/main" ? "main" : undefined),
			isCrossProcessAddress: () => false,
			send: async (input: unknown) => {
				meshSends.push(input);
				return { to: "workspace-a/main", outcome: "queued" as const };
			},
		} as unknown as MeshNode);
		// Only a parked main exists: the alias cannot be delivered, and sending it
		// back into this process would re-enter the same mailbox drain.
		registry.register({
			id: MAIN_AGENT_ID,
			displayName: "main",
			kind: "main",
			session: null,
			workspaceId: "workspace-a",
			status: "parked",
		});

		const receipt = await IrcBus.global().send({ from: "workspace-b/Main", to: "agent://main", body: "ping" });

		expect(receipt.outcome).toBe("failed");
		expect(meshSends).toHaveLength(0);
	});

	it("broadcasts to every root and excludes only the sender", async () => {
		const registry = AgentRegistry.global();
		const main = fakeSession();
		const second = fakeSession();
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: main.session,
			workspaceId: "workspace-a",
			sessionId: "session-main",
		});
		registry.registerRoot({
			displayName: "main",
			kind: "main",
			session: second.session,
			workspaceId: "workspace-a",
			sessionId: "session-second",
		});

		const result = await executeSend(
			{ registry, senderId: "session-second" },
			{ to: "all", message: "status please" },
		);

		expect(result.isError).toBe(false);
		expect(main.delivered.map(message => message.body)).toEqual(["status please"]);
		expect(second.delivered).toHaveLength(0);
	});
});
