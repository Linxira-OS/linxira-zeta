import { describe, expect, test } from "bun:test";
import { CHANNEL_PEER_REFUSED_TEXT, isAllowlistEmpty, isPeerAllowedFor } from "../src/auth";

describe("instance allowlist", () => {
	test("an instance with no peers is empty and denies", () => {
		const allow = { perInstance: { discord: { peers: [] } } };
		expect(isAllowlistEmpty("discord", allow)).toBe(true);
		expect(isPeerAllowedFor("discord", { peer: "c1" }, allow)).toBe(false);
		expect(isAllowlistEmpty("telegram", allow)).toBe(true);
	});

	test("rules do not leak between instances of the same platform", () => {
		const allow = {
			perInstance: {
				"discord-work": { peers: ["c1"] },
				"discord-home": { peers: ["c2"] },
			},
		};
		expect(isPeerAllowedFor("discord-work", { peer: "c1" }, allow)).toBe(true);
		expect(isPeerAllowedFor("discord-home", { peer: "c1" }, allow)).toBe(false);
		expect(isPeerAllowedFor("discord-home", { peer: "c2" }, allow)).toBe(true);
	});

	test("matches the peer and extra allow keys", () => {
		const allow = { perInstance: { "discord-work": { peers: ["guild:g1"] } } };
		expect(isPeerAllowedFor("discord-work", { peer: "c9", allowKeys: ["c9", "guild:g1"] }, allow)).toBe(true);
		expect(isPeerAllowedFor("discord-work", { peer: "c9", allowKeys: ["c9", "guild:g2"] }, allow)).toBe(false);
	});

	test("a user list narrows an allowed conversation to those senders", () => {
		const allow = { perInstance: { "discord-work": { peers: ["c1"], users: ["u1"] } } };
		expect(isPeerAllowedFor("discord-work", { peer: "c1", senderId: "u1" }, allow)).toBe(true);
		expect(isPeerAllowedFor("discord-work", { peer: "c1", senderId: "u2" }, allow)).toBe(false);
		expect(isPeerAllowedFor("discord-work", { peer: "c1" }, allow)).toBe(false);
	});

	test("QQ group and user peers are distinct", () => {
		const allow = { perInstance: { "qq-main": { peers: ["group:42"] } } };
		expect(isPeerAllowedFor("qq-main", { peer: "group:42" }, allow)).toBe(true);
		expect(isPeerAllowedFor("qq-main", { peer: "user:42" }, allow)).toBe(false);
	});

	test("an unknown instance or missing policy denies", () => {
		expect(isPeerAllowedFor("missing", { peer: "c1" }, { perInstance: {} })).toBe(false);
		expect(isPeerAllowedFor("missing", { peer: "c1" }, undefined)).toBe(false);
	});

	test("the refusal text is channel-neutral and bilingual", () => {
		expect(CHANNEL_PEER_REFUSED_TEXT).toContain("未授权");
		expect(CHANNEL_PEER_REFUSED_TEXT).toContain("Not authorized");
	});
});
