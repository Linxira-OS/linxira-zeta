import { beforeAll, describe, expect, it } from "bun:test";
import { TeamHubOverlayComponent, type TeamHubSnapshot } from "../src/overlays/team-hub";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});

const coreRoom = {
	id: "acme:core",
	name: "core",
	kind: "pm" as const,
	pmId: "acme:core",
	pmName: "core",
	memberCount: 2,
	lastSeq: 2,
	lastSentAt: 2,
};

const sharedRoom = {
	id: "acme:coordination",
	name: "coordination",
	kind: "coordination" as const,
	pmId: null,
	pmName: null,
	memberCount: 2,
	lastSeq: 9,
	lastSentAt: 9,
};

const snapshotFor = (room: "core" | "coordination"): TeamHubSnapshot => ({
	teamId: "acme",
	teamName: "Acme",
	dbAvailable: true,
	pms: [{ id: "acme:core", name: "core", engineerCount: 1 }],
	engineers: [
		{
			id: "acme:core:alice",
			name: "alice",
			pmId: "acme:core",
			pmName: "core",
			execution: "vibe",
			worktrees: [
				{ id: "home", kind: "home", name: "home", branch: "team/acme/core/alice/integration", path: "/t/home" },
			],
		},
	],
	rooms: [sharedRoom, coreRoom],
	tasks: [
		{
			id: "acme:task:T-1",
			taskKey: "T-1",
			title: "Ship the queue",
			status: "pending" as const,
			assignedPmId: "acme:core",
			assigneeAgentId: "acme:core:alice",
			ownerAgentId: null,
			leaseExpiresAt: null,
			reqIds: ["REQ-1"],
		},
	],
	selectedRoom: {
		room: room === "core" ? coreRoom : sharedRoom,
		members: [{ agentId: "acme:core", role: "pm", label: "core" }],
		events: [
			{
				seq: room === "core" ? 1 : 8,
				sentAt: 1_700_000_000,
				senderAgentId: "acme:core",
				senderLabel: "core",
				kind: "message",
				body: room === "core" ? "core room event" : "shared standup event",
				replyTo: null,
			},
		],
	},
});

describe("Team Hub overlay", () => {
	it("renders rooms, roster, and the selected room's real events", async () => {
		const hub = new TeamHubOverlayComponent({
			source: {
				load: async options => snapshotFor(options?.room === "coordination" ? "coordination" : "core"),
				post: async () => ({ seq: 10 }),
			},
			ui: { terminal: { rows: 24 }, requestRender() {} } as never,
			onDone() {},
			requestRender() {},
		});
		await hub.ready;
		const rendered = hub.render(96).join("\n");
		expect(rendered).toContain("Team Hub · Acme");
		expect(rendered).toContain("#core");
		expect(rendered).toContain("PM core");
		expect(rendered).toContain("core room event");
		expect(rendered).toContain("vibe · 1 wt");
		hub.dispose();
	});

	it("g selects the shared room and Tab/h/l move pane focus", async () => {
		const hub = new TeamHubOverlayComponent({
			source: {
				load: async options => snapshotFor(options?.room === "coordination" ? "coordination" : "core"),
				post: async () => ({ seq: 10 }),
			},
			ui: { terminal: { rows: 24 }, requestRender() {} } as never,
			onDone() {},
			requestRender() {},
		});
		await hub.ready;
		hub.handleInput("g");
		await hub.ready;
		const rendered = hub.render(96).join("\n");
		expect(rendered).toContain("shared standup event");
		expect(rendered).toContain("shared · 2 members");
		hub.handleInput("\t");
		hub.handleInput("h");
		hub.handleInput("l");
		hub.dispose();
	});

	it("Esc closes only after filter and pane state unwind", async () => {
		let closed = 0;
		const hub = new TeamHubOverlayComponent({
			source: {
				load: async () => snapshotFor("core"),
				post: async () => ({ seq: 10 }),
			},
			ui: { terminal: { rows: 24 }, requestRender() {} } as never,
			onDone: () => {
				closed++;
			},
			requestRender() {},
		});
		await hub.ready;
		hub.handleInput("l");
		hub.handleInput("/");
		hub.handleInput("x");
		hub.handleInput("\x1b");
		expect(closed).toBe(0);
		hub.handleInput("\x1b");
		hub.handleInput("\x1b");
		expect(closed).toBe(1);
		hub.dispose();
	});

	it("shows tasks and runs claim/member/kind actions through the source", async () => {
		const actions: string[] = [];
		const hub = new TeamHubOverlayComponent({
			source: {
				load: async options => snapshotFor(options?.room === "coordination" ? "coordination" : "core"),
				post: async () => ({ seq: 10 }),
				taskAction: async input => {
					actions.push(`task:${input.action}:${input.task}`);
					return { message: "task ok" };
				},
				addRoomMember: async input => {
					actions.push(`member:${input.member}`);
					return { message: "member ok" };
				},
				setRoomKind: async input => {
					actions.push(`kind:${input.kind}`);
					return { message: "kind ok" };
				},
			},
			ui: { terminal: { rows: 24 }, requestRender() {} } as never,
			onDone() {},
			requestRender() {},
		});
		await hub.ready;
		// rooms -> task entry (coordination, core, TASKS label, T-1)
		hub.handleInput("j");
		hub.handleInput("j");
		hub.handleInput("j");
		expect(hub.render(96).join("\n")).toContain("REQ-1");
		hub.handleInput("c");
		await hub.ready;
		expect(actions).toContain("task:claim:T-1");

		hub.handleInput("g");
		await hub.ready;
		hub.handleInput("m");
		hub.handleInput("bob");
		hub.handleInput("\r");
		await hub.ready;
		expect(actions).toContain("member:bob");

		hub.handleInput("K");
		await hub.ready;
		expect(actions.some(action => action.startsWith("kind:"))).toBe(true);
		hub.dispose();
	});

	it("an empty team is honest about missing database rows", async () => {
		const hub = new TeamHubOverlayComponent({
			source: {
				load: async () => ({
					teamId: "gone",
					teamName: "Gone",
					dbAvailable: false,
					warning: 'Team "gone" has a marker but no row in the global team database.',
					pms: [],
					engineers: [],
					rooms: [],
					selectedRoom: null,
				}),
				post: async () => ({ seq: 1 }),
			},
			ui: { terminal: { rows: 24 }, requestRender() {} } as never,
			onDone() {},
			requestRender() {},
		});
		await hub.ready;
		const rendered = hub.render(96).join("\n");
		expect(rendered).toContain("no row in the global");
		expect(rendered).toContain("No rooms in this team yet.");
		expect(rendered).not.toContain("PM core");
		hub.dispose();
	});
});
