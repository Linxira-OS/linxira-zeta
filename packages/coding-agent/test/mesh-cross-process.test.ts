/**
 * Scenario S1 — Feishu/GUI chat bound to workspace A sends to workspace B,
 * whose `serve` process is running, and gets an answer back. Two real
 * processes, two workspace ids, one shared mesh plane.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { IrcBus } from "../src/irc/bus";
import { AgentProtocolHandler } from "../src/internal-urls/agent-protocol";
import { setMeshNode } from "../src/mesh/global";
import type { MeshNode } from "../src/mesh/mesh-node";
import { spawnMeshChild, tempDir, type MeshChild } from "./mesh/helpers";

describe("mesh cross-process (S1)", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	}, 30_000);

	test("A's main agent messages B's main agent, B answers, A's inbox has one reply", async () => {
		const meshRoot = await tempDir("mesh-s1");
		const rootA = path.join(meshRoot, "workspace-a");
		const rootB = path.join(meshRoot, "workspace-b");
		cleanups.push(() => rm(meshRoot, { recursive: true, force: true }));

		const children: MeshChild[] = [];
		const spawnChild = async (root: string, alias: string, reply = false) => {
			const child = await spawnMeshChild({ workspaceRoot: root, meshRoot, alias, reply });
			children.push(child);
			cleanups.push(() => child.stop());
			return child;
		};

		const a = await spawnChild(rootA, "alpha");
		const b = await spawnChild(rootB, "beta", true);

		expect(a.workspaceId).not.toBe(b.workspaceId);
		expect(a.address).toBe(`${a.workspaceId}/Main`);
		expect(b.address).toBe(`${b.workspaceId}/Main`);

		await a.command(`send ${b.address} ping-from-alpha`);
		const sent = await a.next<{ to: string; outcome: string }>("SEND");
		expect(sent.to).toBe(b.address);
		expect(sent.outcome).toBe("injected");

		const receivedByB = await b.next<{ from: string; to: string; body: string }>("DELIVERED");
		expect(receivedByB.from).toBe(a.address);
		expect(receivedByB.to).toBe(b.address);
		expect(receivedByB.body).toBe("ping-from-alpha");

		// B's auto-reply reaches A as a real delivery.
		const replyAtA = await a.next<{ from: string; body: string; to: string }>("DELIVERED");
		expect(replyAtA.from).toBe(b.address);
		expect(replyAtA.to).toBe(a.address);
		expect(replyAtA.body).toBe("re: ping-from-alpha");

		await a.command("inbox");
		const inbox = await a.next<Array<{ from: string; body: string }>>("INBOX");
		expect(inbox).toHaveLength(1);
		expect(inbox[0]?.from).toBe(b.address);

		// Both endpoints are advertised with their workspace prefix.
		await a.command("agents");
		const agents = await a.next<Array<{ address: string; local: boolean }>>("AGENTS");
		expect(agents.find(agent => agent.local)?.address).toBe("Main");
		expect(agents.some(agent => agent.address === b.address && !agent.local)).toBe(true);

		await Promise.all(children.map(child => child.stop()));
	}, 90_000);

	test("IrcBus only engages the mesh for cross-process addresses", async () => {
		const id = "abcdabcdabcd";
		const sent: unknown[] = [];
		const fake = {
			stripLocalAddress: (raw: string) => (raw === `${id}/Main` ? "Main" : undefined),
			isCrossProcessAddress: (raw: string) => raw.includes("/") && !raw.startsWith(`${id}/`),
			send: async (input: unknown) => {
				sent.push(input);
				return { to: "beta/Main", outcome: "queued" as const };
			},
		} as unknown as MeshNode;
		setMeshNode(fake);
		try {
			const receipt = await IrcBus.global().send({ from: "Main", to: "beta/Main", body: "cross" });
			expect(receipt.outcome).toBe("queued");
			expect(sent).toHaveLength(1);
			expect(sent[0]).toMatchObject({ from: "Main", to: "beta/Main", body: "cross" });
		} finally {
			setMeshNode(undefined);
		}
		// No node installed: exactly the historical local error, same wording.
		const failed = await IrcBus.global().send({ from: "Main", to: "beta/Main", body: "cross" });
		expect(failed.outcome).toBe("failed");
		expect(failed.error).toContain('Unknown agent "beta/Main"');
	});

	test("write agent://<workspace>/<agent> targets the cross-process address", async () => {
		const sent: Array<{ to: string; body: string }> = [];
		const fake = {
			stripLocalAddress: () => undefined,
			isCrossProcessAddress: (raw: string) => raw.startsWith("zeta/"),
			send: async (input: { to: string; body: string }) => {
				sent.push({ to: input.to, body: input.body });
				return { to: input.to, outcome: "queued" as const };
			},
		} as unknown as MeshNode;
		setMeshNode(fake);
		try {
			const handler = new AgentProtocolHandler();
			const result = await handler.write(
				{ scheme: "agent", rawHost: "zeta", hostname: "zeta", pathname: "/Main" } as never,
				"cross-process write",
				{
					session: {
						agentRegistry: { get: () => undefined },
						getAgentId: () => "Main",
						enableIrc: true,
						taskDepth: 1,
						settings: {},
						getSessionFile: () => null,
					},
				} as never,
			);
			expect(sent).toEqual([{ to: "zeta/Main", body: "cross-process write" }]);
			const first = result.content[0];
			expect(first !== undefined && "text" in first ? first.text : "").toContain("Queued for zeta/Main");
		} finally {
			setMeshNode(undefined);
		}
	});
});
