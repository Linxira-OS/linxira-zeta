/**
 * Messaging rules and per-workspace gears.
 *
 * - a subagent may only message the main agent that spawned it;
 * - the sender's outbound gear and the target's inbound gear must both allow a
 *   call, so a closed target cannot be bypassed;
 * - the default workspace runs open in both directions;
 * - a workspace hosted by the same process is delivered locally instead of
 *   being queued as an offline peer.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setMeshNode } from "../src/mesh/global";
import {
	CLOSED_MESH_GEARS,
	type MeshGear,
	type MeshGears,
	OPEN_MESH_GEARS,
	evaluateGearCall,
	gearAllows,
	readWorkspaceGears,
} from "../src/mesh/gears";
import { MeshNode } from "../src/mesh/mesh-node";
import { readMeshToken, sendMeshEnvelope } from "../src/mesh/transport";
import { MESH_PROTOCOL_VERSION, type MeshEnvelope } from "../src/mesh/types";
import { IrcBus } from "../src/irc/bus";
import { executeSend } from "../src/irc/messaging";
import { AgentRegistry } from "../src/registry/agent-registry";
import type { AgentSession } from "../src/session/agent-session";

const WORKSPACE_A = "aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbbbbbb";
const WORKSPACE_C = "cccccccccccc";

interface FakeSettings {
	project: Record<string, unknown>;
	root: string;
	getCwd(): string;
	getProjectSettings(): Record<string, unknown>;
}

function fakeSettings(root: string, gears?: Partial<MeshGears>): FakeSettings {
	return {
		root,
		project: gears ? { mesh: { inboundGear: gears.inbound, outboundGear: gears.outbound } } : {},
		getCwd: () => root,
		getProjectSettings() {
			return this.project;
		},
	};
}

interface FakeSession {
	session: AgentSession;
	delivered: IrcMessage[];
}

function fakeSession(settings: FakeSettings): FakeSession {
	const delivered: IrcMessage[] = [];
	const session = {
		settings,
		isStreaming: true,
		deliverIrcMessage: async (message: IrcMessage) => {
			delivered.push(message);
			return "injected" as const;
		},
		emitIrcRelayObservation: () => {},
	};
	return { session: session as unknown as AgentSession, delivered };
}

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `zeta-${prefix}-`));
	roots.push(root);
	return root;
}

describe("messaging gears", () => {
	const originalDefault = process.env.ZETA_DEFAULT_WORKSPACE;
	let registry: AgentRegistry;

	beforeEach(() => {
		registry = new AgentRegistry();
	});

	afterEach(async () => {
		if (originalDefault === undefined) delete process.env.ZETA_DEFAULT_WORKSPACE;
		else process.env.ZETA_DEFAULT_WORKSPACE = originalDefault;
		setMeshNode(undefined);
		await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
	});

	describe("policy", () => {
		const allows = (gear: MeshGear, otherRole: "main" | "sub", otherDefault: boolean, same = false) =>
			gearAllows(gear, { sameWorkspace: same, otherRole, otherIsDefaultWorkspace: otherDefault });

		it("closed refuses cross-workspace calls but not same-workspace subagents", () => {
			expect(allows("closed", "main", false)).toBe(false);
			expect(allows("closed", "main", true)).toBe(false);
			expect(allows("closed", "sub", false)).toBe(false);
			expect(allows("closed", "sub", false, true)).toBe(true);
			expect(allows("closed", "main", false, true)).toBe(false);
		});

		it("repo-main-agents accepts the default workspace main only", () => {
			expect(allows("repo-main-agents", "main", true)).toBe(true);
			expect(allows("repo-main-agents", "main", false)).toBe(false);
			expect(allows("repo-main-agents", "sub", true)).toBe(false);
		});

		it("repo-all accepts every main agent but no cross-workspace subagent", () => {
			expect(allows("repo-all", "main", true)).toBe(true);
			expect(allows("repo-all", "main", false)).toBe(true);
			expect(allows("repo-all", "sub", false)).toBe(false);
		});

		it("cross-repo-except-default accepts non-default agents and the default main", () => {
			expect(allows("cross-repo-except-default", "main", false)).toBe(true);
			expect(allows("cross-repo-except-default", "sub", false)).toBe(true);
			expect(allows("cross-repo-except-default", "main", true)).toBe(true);
			expect(allows("cross-repo-except-default", "sub", true)).toBe(false);
		});

		it("open accepts everyone", () => {
			expect(allows("open", "sub", true)).toBe(true);
			expect(allows("open", "main", false)).toBe(true);
		});

		it("both directions must permit the call", () => {
			const sender = {
				workspaceId: WORKSPACE_A,
				isDefaultWorkspace: false,
				role: "main" as const,
				address: "A/Main",
			};
			const target = {
				workspaceId: WORKSPACE_B,
				isDefaultWorkspace: false,
				role: "main" as const,
				address: "B/Main",
			};
			expect(evaluateGearCall({ sender, target, senderOutbound: "closed", targetInbound: "open" })).toMatchObject({
				allowed: false,
				direction: "outbound",
			});
			expect(evaluateGearCall({ sender, target, senderOutbound: "open", targetInbound: "closed" })).toMatchObject({
				allowed: false,
				direction: "inbound",
			});
			expect(evaluateGearCall({ sender, target, senderOutbound: "open", targetInbound: "repo-all" })).toEqual({
				allowed: true,
			});
		});
	});

	describe("subagent rule", () => {
		function registerParties() {
			const main = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Main",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_A,
				session: main.session,
			});
			const other = fakeSession(fakeSettings("C:/fake/other", OPEN_MESH_GEARS));
			const otherRef = registry.register({
				id: "OtherMain",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_B,
				session: other.session,
			});
			const child = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Child",
				displayName: "task",
				kind: "sub",
				parentId: "Main",
				workspaceId: WORKSPACE_A,
				session: child.session,
			});
			const sibling = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Sibling",
				displayName: "task",
				kind: "sub",
				parentId: "Main",
				workspaceId: WORKSPACE_A,
				session: sibling.session,
			});
			return { main, other, otherRef, child, sibling };
		}

		it("delivers a subagent message to its spawning main", async () => {
			const { main } = registerParties();
			const receipt = await new IrcBus(registry).send({ from: "Child", to: "Main", body: "done" });
			expect(receipt.outcome).toBe("injected");
			expect(main.delivered.map(message => message.body)).toEqual(["done"]);
		});

		it("refuses a subagent message to another main agent", async () => {
			const { other } = registerParties();
			const receipt = await new IrcBus(registry).send({ from: "Child", to: "OtherMain", body: "hello" });
			expect(receipt.outcome).toBe("failed");
			expect(receipt.error).toContain('may only message its spawning main agent "Main"');
			expect(other.delivered).toEqual([]);

			const crossWorkspace = await new IrcBus(registry).send({
				from: "Child",
				to: `${WORKSPACE_B}/OtherMain`,
				body: "hello",
			});
			expect(crossWorkspace.outcome).toBe("failed");
			expect(crossWorkspace.error).toContain("may only message its spawning main agent");
		});

		it("refuses a subagent message to another subagent", async () => {
			const { sibling } = registerParties();
			const receipt = await new IrcBus(registry).send({ from: "Child", to: "Sibling", body: "psst" });
			expect(receipt.outcome).toBe("failed");
			expect(receipt.error).toContain("may only message its spawning main agent");
			expect(sibling.delivered).toEqual([]);
		});

		it("refuses a subagent broadcast", async () => {
			registerParties();
			const result = await executeSend(
				{ registry, senderId: "Child", sessionFileHint: null },
				{ to: "all", message: "everyone" },
			);
			expect(result.isError).toBe(true);
			expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain(
				"broadcast is not available",
			);
		});
	});

	describe("workspace gears on local delivery", () => {
		it("delivers a second workspace hosted by this process locally, not through the mesh", async () => {
			process.env.ZETA_DEFAULT_WORKSPACE = "C:/fake/default";
			let queued = 0;
			setMeshNode({
				stripLocalAddress: (raw: string) => (raw === `${WORKSPACE_A}/Main` ? "Main" : undefined),
				isCrossProcessAddress: (raw: string) => raw.includes("/") && !raw.startsWith(`${WORKSPACE_A}/`),
				send: async () => {
					queued++;
					return { to: "unused", outcome: "queued" as const };
				},
			} as unknown as MeshNode);

			const sender = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Main",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_A,
				session: sender.session,
			});
			const target = fakeSession(
				fakeSettings("C:/fake/repo-b", { inbound: "repo-main-agents", outbound: "closed" }),
			);
			registry.register({
				id: "MainB",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_B,
				session: target.session,
			});

			const receipt = await new IrcBus(registry).send({
				from: "Main",
				to: `${WORKSPACE_B}/MainB`,
				body: "local, not remote",
			});
			expect(receipt.outcome).toBe("injected");
			expect(target.delivered.map(message => message.body)).toEqual(["local, not remote"]);
			expect(queued).toBe(0);
		});

		it("the default workspace calls repo-main-agents but not a closed workspace", async () => {
			process.env.ZETA_DEFAULT_WORKSPACE = "C:/fake/default";
			const sender = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Main",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_A,
				session: sender.session,
			});
			const settingsB = fakeSettings("C:/fake/repo-b", { inbound: "repo-main-agents", outbound: "closed" });
			const openInbound = fakeSession(settingsB);
			registry.register({
				id: "MainB",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_B,
				session: openInbound.session,
			});
			const bus = new IrcBus(registry);

			const allowed = await bus.send({ from: "Main", to: `${WORKSPACE_B}/MainB`, body: "hello" });
			expect(allowed.outcome).toBe("injected");

			settingsB.project = { mesh: { inboundGear: "closed", outboundGear: "closed" } };
			const refused = await bus.send({ from: "Main", to: `${WORKSPACE_B}/MainB`, body: "again" });
			expect(refused.outcome).toBe("failed");
			expect(refused.error).toContain('inbound messaging gear "closed"');
		});

		it("enforces the sender's outbound gear independently", async () => {
			process.env.ZETA_DEFAULT_WORKSPACE = "C:/fake/default";
			const sender = fakeSession(fakeSettings("C:/fake/repo-c", { inbound: "open", outbound: "closed" }));
			registry.register({
				id: "MainC",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_C,
				session: sender.session,
			});
			const target = fakeSession(fakeSettings("C:/fake/default", OPEN_MESH_GEARS));
			registry.register({
				id: "Main",
				displayName: "main",
				kind: "main",
				workspaceId: WORKSPACE_A,
				session: target.session,
			});

			const receipt = await new IrcBus(registry).send({
				from: "MainC",
				to: `${WORKSPACE_A}/Main`,
				body: "outbound should stop this",
			});
			expect(receipt.outcome).toBe("failed");
			expect(receipt.error).toContain('outbound messaging gear "closed"');
		});
	});

	describe("project settings and the mesh delivery path", () => {
		it("reads only the workspace project layer, with the default workspace always open", async () => {
			const root = await tempRoot("gears-project");
			await fs.mkdir(path.join(root, ".zeta"), { recursive: true });
			await fs.writeFile(
				path.join(root, ".zeta", "settings.json"),
				JSON.stringify({ mesh: { inboundGear: "repo-all", outboundGear: "cross-repo-except-default" } }),
			);
			await fs.writeFile(path.join(root, ".zeta", "config.yml"), "mesh:\n  outboundGear: open\n");
			expect(await readWorkspaceGears(root)).toEqual({
				inbound: "repo-all",
				outbound: "open",
			});
			process.env.ZETA_DEFAULT_WORKSPACE = root;
			expect(await readWorkspaceGears(root)).toEqual(OPEN_MESH_GEARS);
		});

		it("delivers through a live endpoint and lets the receiver enforce a closed inbound gear", async () => {
			const meshRoot = await tempRoot("gears-mesh");
			const rootA = await tempRoot("gears-a");
			const rootB = await tempRoot("gears-b");
			process.env.ZETA_DEFAULT_WORKSPACE = rootA;
			let bGears: MeshGears = { inbound: "repo-main-agents", outbound: "closed" };
			const delivered: MeshEnvelope[] = [];
			const nodeOptions = (root: string, gears: () => MeshGears) => ({
				workspaceRoot: root,
				meshRoot,
				injectOnStart: false,
				localAgents: () => [{ id: "Main", role: "main" as const, status: "running" as const }],
				deliver: async (envelope: MeshEnvelope) => {
					delivered.push(envelope);
					return { outcome: "injected" as const };
				},
				gears,
			});
			const a = await MeshNode.start(nodeOptions(rootA, () => OPEN_MESH_GEARS));
			const b = await MeshNode.start(nodeOptions(rootB, () => bGears));
			try {
				const first = await a.send({ from: "Main", to: b.addressFor("Main"), body: "hello B" });
				expect(first.outcome).toBe("injected");
				expect(delivered.map(envelope => envelope.body)).toEqual(["hello B"]);

				bGears = CLOSED_MESH_GEARS;
				const precheck = await a.send({ from: "Main", to: b.addressFor("Main"), body: "blocked early" });
				expect(precheck.outcome).toBe("failed");
				expect(precheck.error).toContain('inbound messaging gear "closed"');

				// A caller that ignores the advertised gear must still be refused by
				// the receiver's delivery path.
				const token = await readMeshToken(b.paths.tokenFile(b.workspaceId));
				expect(token).toBeDefined();
				const envelope: MeshEnvelope = {
					v: MESH_PROTOCOL_VERSION,
					id: randomUUID(),
					from: a.addressFor("Main"),
					to: b.addressFor("Main"),
					kind: "message",
					body: "bypass attempt",
					sentAt: Date.now(),
				};
				const direct = await sendMeshEnvelope({
					endpoint: b.endpoint,
					token: token!,
					envelope,
					timeoutMs: 5_000,
				});
				expect(direct.delivered).toBe(true);
				expect(direct.payload?.ok).toBe(false);
				expect(direct.payload?.error).toContain("inbound messaging gear");
				expect(delivered.map(envelope => envelope.body)).toEqual(["hello B"]);
			} finally {
				await Promise.all([a.stop(), b.stop()]);
			}
		});
	});
});
