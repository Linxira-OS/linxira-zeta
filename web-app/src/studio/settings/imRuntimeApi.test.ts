import { describe, expect, test } from "bun:test";
import {
	SECRET_MASK,
	bindingKey,
	bindingWire,
	buildCredentialDraft,
	emptyProfile,
	fetchChannelInstances,
	fetchChannelStatus,
	fetchImAgents,
	fetchImBindings,
	isValidInstanceId,
	isValidProfileId,
	secretDraftFor,
	splitLines,
	suggestInstanceId,
	targetState,
	type ImBinding,
	type ImFetch,
} from "./imRuntimeApi";

interface Call {
	url: string;
	init: RequestInit | undefined;
	body: unknown;
}

function fakeFetch(answer: (url: string) => Response): { fetcher: ImFetch; calls: Call[] } {
	const calls: Call[] = [];
	const fetcher: ImFetch = (url, init) => {
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ url, init, body });
		return Promise.resolve(answer(url));
	};
	return { fetcher, calls };
}

describe("contract reads", () => {
	test("status reads instances[] and keeps the UI extension fields", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				instances: [
					{
						id: "wechat-work",
						platform: "wechat",
						label: "Work",
						running: true,
						configured: false,
						agentProfileId: "pm-work",
						targetDisplay: "alpha · zeta",
						targetAvailable: false,
						targetReason: "target-unavailable",
					},
				],
				runtime: { hosting: true },
			}),
		);
		const { instances } = await fetchChannelStatus(fetcher);
		const row = instances[0]!;
		expect(row.id).toBe("wechat-work");
		expect(row.platform).toBe("wechat");
		expect(row.running).toBe(true);
		expect(row.configured).toBe(false);
		expect(row.agentProfileId).toBe("pm-work");
		expect(row.targetAvailable).toBe(false);
		expect(row.targetReason).toBe("target-unavailable");
	});

	test("instances parse masked credentials without leaking unknown shapes", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				instances: [
					{
						id: "feishu-1",
						platform: "feishu",
						label: "Docs",
						enabled: true,
						agentProfile: "pm-docs",
						allow: { peers: ["oc_1"], users: ["ou_1"] },
						credentials: { appId: "cli_1", appSecret: SECRET_MASK },
						extra: "dropped",
					},
				],
			}),
		);
		const rows = await fetchChannelInstances(fetcher);
		expect(rows.length).toBe(1);
		expect(rows[0]).toEqual({
			id: "feishu-1",
			platform: "feishu",
			label: "Docs",
			enabled: true,
			agentProfile: "pm-docs",
			allow: { peers: ["oc_1"], users: ["ou_1"] },
			credentials: { appId: "cli_1", appSecret: SECRET_MASK },
		});
	});

	test("profiles and targets keep empty allowlists literal", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				profiles: [
					{
						id: "pm-docs",
						label: "Docs PM",
						persona: { mode: "inline", text: "help" },
						location: { kind: "workspace", workspace: "main" },
						tools: { builtin: [], extensions: [], mcpServers: [], customTools: [], skills: [], commands: [] },
					},
				],
				targets: [{ key: "workspace:alpha", display: "alpha", kind: "workspace", available: true }],
			}),
		);
		const envelope = await fetchImAgents(fetcher);
		expect(envelope.profiles[0]?.tools.customTools).toEqual([]);
		expect(envelope.profiles[0]?.tools.builtin).toEqual([]);
		expect(envelope.targets).toEqual([{ key: "workspace:alpha", display: "alpha", kind: "workspace", available: true }]);
	});

	test("bindings read target display and needsReview", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				bindings: [
					{
						id: "b_0123456789abcdef",
						instanceId: "wechat-work",
						platform: "wechat",
						chatId: "wx-1",
						agentProfileId: "pm-docs",
						sessionId: "s1",
						target: { kind: "workspace", key: "w", display: "alpha", available: false, reason: "target-unavailable" },
						role: "observe",
						createdAt: "2026-11-11T00:00:00.000Z",
						needsReview: true,
					},
				],
			}),
		);
		const rows = await fetchImBindings(fetcher);
		const row = rows[0]!;
		expect(row.targetDisplay).toBe("alpha");
		expect(row.targetAvailable).toBe(false);
		expect(row.targetReason).toBe("target-unavailable");
		expect(row.role).toBe("observe");
		expect(row.needsReview).toBe(true);
	});
});

describe("credential drafts", () => {
	test("keep omits the key, clear sends null, set sends the typed value", () => {
		const original = { appId: "cli_1", appSecret: SECRET_MASK };
		const kept = buildCredentialDraft("feishu", original, {
			appId: "cli_1",
			appSecret: secretDraftFor(false, ""),
		});
		expect(Object.hasOwn(kept, "appSecret")).toBe(false);
		expect(kept["appId"]).toBe("cli_1");

		const cleared = buildCredentialDraft("feishu", original, {
			appId: "cli_1",
			appSecret: secretDraftFor(true, ""),
		});
		expect(cleared["appSecret"]).toBeNull();

		const set = buildCredentialDraft("telegram", { botToken: SECRET_MASK }, {
			botToken: secretDraftFor(false, "new-token"),
		});
		expect(set["botToken"]).toBe("new-token");
	});

	test("array credential fields split on lines and commas", () => {
		const bag = buildCredentialDraft("discord", { botToken: SECRET_MASK, allowedChannels: [] }, {
			botToken: secretDraftFor(false, ""),
			allowedChannels: "guild:1\nchan-2, chan-3",
			allowedUsers: "",
		});
		expect(bag["allowedChannels"]).toEqual(["guild:1", "chan-2", "chan-3"]);
		expect(bag["allowedUsers"]).toEqual([]);
	});

	test("unknown credential keys survive the write", () => {
		const bag = buildCredentialDraft("wechat", { botToken: SECRET_MASK, futureField: "keep-me" }, {
			botToken: secretDraftFor(false, ""),
		});
		expect(bag["futureField"]).toBe("keep-me");
		expect(Object.hasOwn(bag, "botToken")).toBe(false);
	});

	test("splitLines trims and drops blanks", () => {
		expect(splitLines(" a \n\n b,c ")).toEqual(["a", "b", "c"]);
	});
});

describe("mutation projection", () => {
	const binding: ImBinding = {
		id: "b_0123456789abcdef",
		instanceId: "wechat-work",
		platform: "wechat",
		chatId: "wx-1",
		agentProfileId: "pm-docs",
		sessionId: "s1",
		role: "answer",
		target: { kind: "workspace", key: "w", display: "alpha", available: true },
		targetDisplay: "alpha",
		targetAvailable: true,
		createdAt: "2026-11-11T00:00:00.000Z",
		needsReview: true,
	};

	test("UI-only display facts are not written back", () => {
		const wire = bindingWire(binding);
		expect(Object.hasOwn(wire, "targetDisplay")).toBe(false);
		expect(Object.hasOwn(wire, "targetAvailable")).toBe(false);
		expect(wire["needsReview"]).toBe(true);
		expect(wire["target"]).toEqual(binding.target);
	});

	test("target state treats unknown targets as unavailable", () => {
		expect(targetState({ targetAvailable: false, targetReason: "target-unavailable" })).toEqual({
			available: false,
			reason: "target-unavailable",
		});
		expect(targetState({ needsReview: true, targetReason: null })).toEqual({
			available: false,
			reason: "needsReview",
		});
		expect(targetState({ targetAvailable: true })).toEqual({ available: true, reason: null });
	});

	test("binding identity uses the contract key", () => {
		expect(bindingKey({ instanceId: "a", chatId: "c", threadId: "t", userId: "u" })).not.toBe(
			bindingKey({ instanceId: "a", chatId: "c", threadId: "t" }),
		);
	});
});

describe("profile defaults and ids", () => {
	test("a new profile has no ambient tools and no capability claims", () => {
		const profile = emptyProfile("pm-docs");
		expect(profile.tools.builtin).toEqual([]);
		expect(profile.tools.customTools).toEqual([]);
		expect(profile.tools.skills).toEqual([]);
		expect(profile.tools.approvalMode).toBe("yolo");
		expect(Object.hasOwn(profile.tools, "capabilities")).toBe(false);
		expect(profile.memory?.backend).toBe("off");
	});

	test("ids follow the frozen charset and suggestions avoid collisions", () => {
		expect(isValidInstanceId("wechat-work")).toBe(true);
		expect(isValidInstanceId("WeChat")).toBe(false);
		expect(isValidInstanceId("a")).toBe(false);
		expect(isValidProfileId("pm_1")).toBe(true);
		expect(suggestInstanceId("wechat", [])).toBe("wechat");
		expect(
			suggestInstanceId("wechat", [
				{ id: "wechat", platform: "wechat", label: "w", enabled: true, agentProfile: "p", allow: { peers: [] }, credentials: {} },
			]),
		).toBe("wechat-2");
	});
});
