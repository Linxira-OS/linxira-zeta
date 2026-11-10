import { describe, expect, test } from "bun:test";
import {
	fetchDesktopHostInfo,
	fetchPairedDevices,
	fetchPairingQr,
	fetchRemoteAccess,
	revokeAllPairedDevices,
	revokePairedDevice,
	revokeRemoteToken,
	rotateRemoteToken,
	type SecurityFetch,
} from "./securityApi";

interface Call {
	url: string;
	init: RequestInit | undefined;
	body: unknown;
}

function fakeFetch(answer: (url: string, init: RequestInit | undefined) => Response): {
	fetcher: SecurityFetch;
	calls: Call[];
} {
	const calls: Call[] = [];
	const fetcher: SecurityFetch = (url, init) => {
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ url, init, body });
		return Promise.resolve(answer(url, init));
	};
	return { fetcher, calls };
}

describe("device inventory", () => {
	test("parses the public projection and ignores token-shaped fields", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({
				devices: [
					{
						id: "dev_1",
						label: "Phone",
						platform: "android",
						scopes: ["read", "write"],
						createdAt: "2026-01-01T00:00:00.000Z",
						lastSeenAt: null,
						revokedAt: null,
						tokenHash: "must-not-leak",
					},
				],
				currentDeviceId: "dev_1",
				legacyTokenActive: true,
			}),
		);
		const inventory = await fetchPairedDevices(fetcher);
		expect(inventory.currentDeviceId).toBe("dev_1");
		expect(inventory.legacyTokenActive).toBe(true);
		expect(inventory.devices[0]).toEqual({
			id: "dev_1",
			label: "Phone",
			platform: "android",
			scopes: ["read", "write"],
			createdAt: "2026-01-01T00:00:00.000Z",
			lastSeenAt: null,
			revokedAt: null,
		});
	});

	test("a malformed list is an error, never an empty device list", async () => {
		const { fetcher } = fakeFetch(() => Response.json({ devices: "nope" }));
		let message = "";
		try {
			await fetchPairedDevices(fetcher);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("malformed");
	});

	test("pairing drops the plaintext token", async () => {
		const { fetcher } = fakeFetch(() =>
			Response.json({ url: "http://host:43141", token: "secret", payload: "p", svg: "<svg/>" }),
		);
		expect(await fetchPairingQr(fetcher)).toEqual({ url: "http://host:43141", svg: "<svg/>" });
	});
});

describe("device mutations", () => {
	test("revoke targets one encoded id", async () => {
		const { fetcher, calls } = fakeFetch(() => Response.json({ ok: true, revoked: true }));
		await revokePairedDevice(fetcher, "dev/1");
		expect(calls[0]?.url).toBe("/api/remote/devices/dev%2F1");
		expect(calls[0]?.init?.method).toBe("DELETE");
	});

	test("revoke-all sends keepCurrent and returns the count", async () => {
		const { fetcher, calls } = fakeFetch(() => Response.json({ ok: true, revoked: 3 }));
		expect(await revokeAllPairedDevices(fetcher, true)).toBe(3);
		expect(calls[0]?.body).toEqual({ keepCurrent: true });
	});
});

describe("remote access", () => {
	test("a masked token means the token is active; a bare config means it is not", async () => {
		const active = fakeFetch(() =>
			Response.json({
				remote: { token: "••••", publicUrl: "https://zeta.example.com", allowPlainHttp: false, tls: { enabled: true } },
			}),
		);
		expect(await fetchRemoteAccess(active.fetcher)).toEqual({
			tokenActive: true,
			publicUrl: "https://zeta.example.com",
			allowPlainHttp: false,
			tlsEnabled: true,
		});

		const empty = fakeFetch(() => Response.json({ remote: {} }));
		expect(await fetchRemoteAccess(empty.fetcher)).toEqual({
			tokenActive: false,
			publicUrl: null,
			allowPlainHttp: false,
			tlsEnabled: false,
		});
	});

	test("rotate never returns the new plaintext token to the renderer", async () => {
		const { fetcher, calls } = fakeFetch(() =>
			Response.json({ ok: true, token: "zrt_new", tokenUpdatedAt: "2026-11-10T00:00:00.000Z" }),
		);
		await rotateRemoteToken(fetcher);
		expect(calls[0]?.url).toBe("/api/remote/token/rotate");
		expect(calls[0]?.init?.method).toBe("POST");
	});

	test("revoke reports whether the active token went away", async () => {
		const { fetcher, calls } = fakeFetch(() => Response.json({ ok: true, activeTokenRevoked: true }));
		expect(await revokeRemoteToken(fetcher)).toBe(true);
		expect(calls[0]?.body).toEqual({ all: true });
	});

	test("desktop info is a boolean probe", async () => {
		expect(await fetchDesktopHostInfo(fakeFetch(() => Response.json({ desktop: true })).fetcher)).toBe(true);
		expect(await fetchDesktopHostInfo(fakeFetch(() => Response.json({ desktop: false })).fetcher)).toBe(false);
	});
});
