import { describe, expect, test } from "bun:test";
import {
	SECRET_MASK,
	attachImConversation,
	bindingWire,
	buildCredentialDraft,
	fetchImConversations,
	isValidInstanceId,
	isValidProfileId,
	roleRepliesAutomatically,
	secretDraftFor,
	targetState,
	type ImBinding,
	type ImFetch,
} from "./imRuntimeApi";

describe("credential write projection", () => {
	test("keep omits the key, clear sends null, set sends the value", () => {
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
});

describe("binding write projection and availability", () => {
	const binding: ImBinding = {
		id: "b_0123456789abcdef",
		instanceId: "wechat-work",
		platform: "wechat",
		chatId: "wx-1",
		agentProfileId: "pm-docs",
		sessionId: "s1",
		role: "mention",
		target: { kind: "workspace", key: "w", display: "alpha", available: true },
		targetDisplay: "alpha",
		targetAvailable: true,
		createdAt: "2026-11-11T00:00:00.000Z",
	};

	test("UI-only display facts are not written back", () => {
		const wire = bindingWire(binding);
		expect(Object.hasOwn(wire, "targetDisplay")).toBe(false);
		expect(Object.hasOwn(wire, "targetAvailable")).toBe(false);
		expect(wire["target"]).toEqual(binding.target);
	});

	test("unknown, unavailable and needs-review targets are never silently valid", () => {
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

	test("mention never replies automatically; answer does", () => {
		expect(roleRepliesAutomatically("answer")).toBe(true);
		expect(roleRepliesAutomatically("mention")).toBe(false);
		expect(roleRepliesAutomatically("observe")).toBe(false);
	});
});

describe("id validation", () => {
	test("contract charset rejects unsafe and empty ids", () => {
		expect(isValidInstanceId("wechat-work")).toBe(true);
		expect(isValidInstanceId("WeChat")).toBe(false);
		expect(isValidInstanceId("-leading")).toBe(false);
		expect(isValidInstanceId("a")).toBe(false);
		expect(isValidInstanceId("has space")).toBe(false);
		expect(isValidProfileId("pm_1")).toBe(true);
		expect(isValidProfileId("")).toBe(false);
	});
});

describe("conversation chooser wire", () => {
	test("reads human names/sharing facts and attaches by native id without exposing ids as labels", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const conversation = {
			id: "native-1",
			name: "Release review",
			kind: "native",
			attached: false,
			shared: false,
			entrances: 0,
			nativeSessionId: "native-1",
			workspaceDisplay: "alpha",
			targetKey: "workspace:alpha",
			targetDisplay: "alpha",
			targetAvailable: true,
			available: true,
		};
		const fetcher: ImFetch = async (url, init) => {
			calls.push({ url, ...(init === undefined ? {} : { init }) });
			if (url.endsWith("/conversations/attach")) {
				return Response.json({ conversation: { ...conversation, id: "native-1", attached: true, entrances: 1 } });
			}
			return Response.json({ conversations: [conversation] });
		};
		const rows = await fetchImConversations(fetcher);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: "native-1", name: "Release review", attached: false, available: true });
		const attached = await attachImConversation(fetcher, "native-1");
		expect(attached).toMatchObject({ id: "native-1", attached: true, entrances: 1 });
		const attachCall = calls.find(call => call.url.endsWith("/conversations/attach"));
		expect(attachCall?.init?.method).toBe("POST");
		expect(attachCall?.init?.body).toBe(JSON.stringify({ sessionId: "native-1" }));
	});
});
