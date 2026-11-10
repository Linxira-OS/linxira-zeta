import { describe, expect, test } from "bun:test";
import { CHANNEL_PEER_REFUSED_TEXT, isAllowlistEmpty, isPeerAllowed, isPeerAllowedFor } from "../src/auth";

describe("legacy allowlist", () => {
	test("an empty list keeps the historic open behavior", () => {
		expect(isPeerAllowed("anyone", [])).toBe(true);
		expect(isPeerAllowed("anyone", undefined)).toBe(true);
		expect(isPeerAllowed("listed", ["listed"])).toBe(true);
		expect(isPeerAllowed("other", ["listed"])).toBe(false);
	});
});

describe("channel-aware allowlist", () => {
	test("deny-by-default platforms refuse every peer when their list is empty", () => {
		const allow = { perChannel: { discord: { peers: [], denyWhenEmpty: true } } };
		expect(isPeerAllowedFor("discord", { peer: "c1" }, allow)).toBe(false);
		expect(isAllowlistEmpty("discord", allow)).toBe(true);
		// Other platforms keep the legacy semantics.
		expect(isPeerAllowedFor("telegram", { peer: "1001" }, allow)).toBe(true);
	});

	test("matches the channel id and a guild allow key", () => {
		const allow = {
			perChannel: { discord: { peers: ["guild:g1"], denyWhenEmpty: true } },
		};
		expect(isPeerAllowedFor("discord", { peer: "c9", allowKeys: ["c9", "guild:g1"] }, allow)).toBe(true);
		expect(isPeerAllowedFor("discord", { peer: "c9", allowKeys: ["c9", "guild:g2"] }, allow)).toBe(false);
	});

	test("a user list narrows an allowed conversation to those senders", () => {
		const allow = {
			perChannel: { discord: { peers: ["c1"], users: ["u1"], denyWhenEmpty: true } },
		};
		expect(isPeerAllowedFor("discord", { peer: "c1", senderId: "u1" }, allow)).toBe(true);
		expect(isPeerAllowedFor("discord", { peer: "c1", senderId: "u2" }, allow)).toBe(false);
		expect(isPeerAllowedFor("discord", { peer: "c1" }, allow)).toBe(false);
	});

	test("QQ group and user peers are distinct", () => {
		const allow = {
			perChannel: { qq: { peers: ["group:42"], denyWhenEmpty: true } },
		};
		expect(isPeerAllowedFor("qq", { peer: "group:42" }, allow)).toBe(true);
		expect(isPeerAllowedFor("qq", { peer: "user:42" }, allow)).toBe(false);
	});

	test("the refusal text stays channel-neutral and bilingual", () => {
		expect(CHANNEL_PEER_REFUSED_TEXT).toContain("未授权");
		expect(CHANNEL_PEER_REFUSED_TEXT).toContain("Not authorized");
	});
});
