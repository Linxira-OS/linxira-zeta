import { describe, expect, test } from "bun:test";
import {
	formatChannelsAdmin,
	mergeAdminStatus,
	parseAdminBindings,
	parseAdminInstances,
	parseAdminTargets,
	type ChannelsAdminSnapshot,
} from "../../src/channels/admin-view";

describe("instance parsing", () => {
	test("reads channels.instances and ignores invalid rows", () => {
		const rows = parseAdminInstances({
			channels: {
				instances: [
					{ id: "wechat-work", platform: "wechat", label: "Work", enabled: true, agentProfile: "pm-work" },
					{ id: "", platform: "wechat" },
					{ id: "bad", platform: "slack" },
					{ platform: "telegram" },
				],
			},
		});
		expect(rows).toEqual([
			{
				id: "wechat-work",
				platform: "wechat",
				label: "Work",
				enabled: true,
				running: false,
				agentProfile: "pm-work",
			},
		]);
	});

	test("returns null when the file has no instances array", () => {
		expect(parseAdminInstances({ channels: { wechat: { enabled: true } } })).toBeNull();
		expect(parseAdminInstances(null)).toBeNull();
		expect(parseAdminInstances({})).toBeNull();
	});

	test("live runtime membership is merged by instance id", () => {
		const rows = mergeAdminStatus(
			[
				{ id: "a", platform: "wechat", label: "A", enabled: true, running: false },
				{ id: "b", platform: "telegram", label: "B", enabled: true, running: true },
			],
			[
				{ id: "a", running: true },
				{ id: "c", running: true },
			],
		);
		expect(rows.map(row => [row.id, row.running])).toEqual([
			["a", true],
			["b", false],
		]);
	});
});

describe("binding and target parsing", () => {
	test("v2 bindings keep target display, review and role", () => {
		const rows = parseAdminBindings({
			remote: {
				imBindings: [
					{
						id: "b_1",
						instanceId: "wechat-work",
						chatId: "wx-1",
						agentProfileId: "pm-work",
						sessionId: "s1",
						role: "observe",
						target: { kind: "workspace", display: "alpha", available: false, reason: "target-unavailable" },
						needsReview: true,
					},
				],
			},
		});
		expect(rows?.[0]).toMatchObject({
			instanceId: "wechat-work",
			role: "observe",
			targetDisplay: "alpha",
			targetAvailable: false,
			targetReason: "target-unavailable",
			needsReview: true,
		});
	});

	test("targets keep unavailable reasons and fall back to the key for display", () => {
		const rows = parseAdminTargets({
			targets: [
				{ key: "w", display: "alpha", kind: "workspace", available: true },
				{ key: "bad", kind: "team-pm", available: false, reason: "target-unavailable" },
				{ display: "beta", kind: "engineer", available: false, reason: "no-worktree" },
				{ kind: "workspace" },
			],
		});
		expect(rows).toEqual([
			{ key: "w", display: "alpha", kind: "workspace", available: true },
			{ key: "bad", display: "bad", kind: "team-pm", available: false, reason: "target-unavailable" },
			{ display: "beta", kind: "engineer", available: false, reason: "no-worktree" },
		]);
	});
});

describe("admin page rendering", () => {
	const snapshot: ChannelsAdminSnapshot = {
		configPath: "/home/me/.zeta/agent/web.yml",
		host: "hosted by pid 42 (serve, started 2026-11-11)",
		instances: [
			{
				id: "wechat-work",
				platform: "wechat",
				label: "Work",
				enabled: true,
				running: true,
				configured: false,
				state: "qr-pending",
				agentProfile: "pm-work",
				targetDisplay: "alpha · zeta",
			},
		],
		bindings: [
			{
				instanceId: "wechat-work",
				chatId: "wx-1",
				sessionId: "s1",
				role: "answer",
				targetDisplay: "alpha · zeta",
				needsReview: true,
			},
			{
				instanceId: "feishu-docs",
				chatId: "oc_1",
				sessionId: "s2",
				role: "observe",
				targetAvailable: false,
				targetReason: "target-unavailable",
			},
		],
		targets: [{ display: "alpha · zeta", kind: "binding", available: false, reason: "target-unavailable" }],
	};

	test("shows instances, bindings, review state and reasons", () => {
		const page = formatChannelsAdmin(snapshot);
		expect(page).toContain("wechat-work");
		expect(page).toContain("qr-pending");
		expect(page).toContain("alpha · zeta");
		expect(page).toContain("needs-review");
		expect(page).toContain("target-unavailable");
		expect(page).toContain("Secrets are write-only");
	});

	test("never contains a secret field", () => {
		const page = formatChannelsAdmin(snapshot);
		expect(page.includes("botToken")).toBe(false);
		expect(page.includes("appSecret")).toBe(false);
		expect(page.includes("••••")).toBe(false);
	});

	test("zh renders the same facts", () => {
		const page = formatChannelsAdmin(snapshot, true);
		expect(page).toContain("IM 运行时");
		expect(page).toContain("待复核");
		expect(page).toContain("秘密只写不读");
	});
});
