import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ActiveTeamHubOverlayComponent, type ActiveTeamHubSnapshot } from "../src/overlays/active-team-hub";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});
const hubs: ActiveTeamHubOverlayComponent[] = [];
afterEach(() => {
	for (const hub of hubs.splice(0)) hub.dispose();
});
const fixture = (): ActiveTeamHubSnapshot => ({
	teamKey: "a",
	label: "Main",
	ownerId: "Main",
	agents: [
		{ id: "Main", label: "Main", kind: "main", status: "idle", createdAt: 1_700_000_000_000, canObserve: true },
		{
			id: "ui-2",
			label: "UI",
			kind: "worker",
			status: "running",
			role: "ui",
			generation: 2,
			lifecycle: "resident",
			cli: "good",
			createdAt: 1_700_000_000_001,
			activity: "Reviewing layout",
			canObserve: true,
		},
	],
	rooms: [
		{
			id: "team-a",
			room: "team",
			name: "Team",
			members: [{ agentId: "Main", label: "Main" }],
			lastSeq: 1,
			events: [
				{
					seq: 1,
					sentAt: "2026-11-14T12:00:00Z",
					senderId: "Main",
					senderName: "Main",
					body: "Room stays visible",
				},
			],
		},
		{
			id: "mains-a",
			room: "mains",
			name: "Mains",
			members: [{ agentId: "Main", label: "Main" }],
			lastSeq: 0,
			events: [],
		},
	],
});

describe("active Team Hub", () => {
	test("keeps room conversation visible while worker details and live activity refresh", async () => {
		let value = fixture();
		const hub = new ActiveTeamHubOverlayComponent({
			source: { load: async () => value, post: async () => ({ seq: 2 }) },
			onDone() {},
			requestRender() {},
		});
		hubs.push(hub);
		await hub.ready;
		hub.handleInput("/");
		hub.handleInput("UI");
		hub.handleInput("\r");
		hub.handleInput("j");
		hub.handleInput("j");
		expect(hub.selectedId).toBe("agent:ui-2");
		const before = hub.render(120).join("\n");
		expect(before).toContain("Reviewing layout");
		expect(before).toContain("Room stays visible");
		expect(before).toContain("generation 2");
		value = {
			...value,
			agents: value.agents.map(agent =>
				agent.id === "ui-2" ? { ...agent, activity: "Writing behavior tests", status: "idle" } : agent,
			),
		};
		await hub.refresh();
		expect(hub.selectedId).toBe("agent:ui-2");
		expect(hub.searchQuery).toBe("UI");
		expect(hub.render(120).join("\n")).toContain("Writing behavior tests");
	});
	test("observer return retains selection/search and never posts or changes modes on focus", async () => {
		const returned = Promise.withResolvers<void>();
		const focused: string[] = [];
		let posts = 0;
		const hub = new ActiveTeamHubOverlayComponent({
			source: {
				load: async () => fixture(),
				post: async () => {
					posts++;
					return { seq: 2 };
				},
			},
			observeAgent: async agent => {
				focused.push(agent.id);
				await returned.promise;
			},
			onDone() {},
			requestRender() {},
		});
		hubs.push(hub);
		await hub.ready;
		hub.handleInput("/");
		hub.handleInput("UI");
		hub.handleInput("\r");
		hub.handleInput("j");
		hub.handleInput("j");
		hub.handleInput("\r");
		expect(focused).toEqual(["ui-2"]);
		expect(posts).toBe(0);
		returned.resolve();
		await returned.promise;
		await hub.refresh();
		expect(hub.selectedId).toBe("agent:ui-2");
		expect(hub.searchQuery).toBe("UI");
	});
	test("posts only through the captured owner source and keeps failed drafts", async () => {
		const sent: string[] = [];
		const hub = new ActiveTeamHubOverlayComponent({
			source: {
				load: async () => fixture(),
				post: async (body, room) => {
					sent.push(`${room}:${body}`);
					throw new Error("offline");
				},
			},
			onDone() {},
			requestRender() {},
		});
		hubs.push(hub);
		await hub.ready;
		hub.handleInput("s");
		hub.handleInput("hello");
		hub.handleInput("\r");
		await Promise.resolve();
		await Promise.resolve();
		expect(sent).toEqual(["team:hello"]);
		expect(hub.render(100).join("\n")).toContain("hello");
	});
});
