/**
 * Pairing QR + token lifecycle over REST:
 * - the payload round-trips through parse (URL + token, token in the fragment);
 * - the SVG is a real drawn symbol;
 * - the base URL picks publicUrl / LAN over a loopback request origin;
 * - rotate revokes the old token, revoke clears the active one.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { YAML } from "bun";
import {
	buildPairingPayload,
	firstLanAddress,
	parsePairingPayload,
	renderPairingQrSvg,
	resolvePairingBaseUrl,
} from "../../src/server/pairing";
import { hashRemoteToken } from "../../src/utils/remote-token";
import { resetRemoteAccessForTests } from "../../src/server/web-gateway/remote-access";
import { webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];
let agentDir = "";

async function setup(yaml: string): Promise<void> {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-pairing-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	await writeFile(join(agentDir, "web.yml"), yaml, "utf8");
	refreshDirsFromEnv();
}

async function readConfigFile(): Promise<{
	remote?: { token?: string; revokedTokens?: string[]; tokenUpdatedAt?: string };
}> {
	return YAML.parse(await readFile(join(agentDir, "web.yml"), "utf8")) as never;
}

/** Loopback request through the gateway (the settings panel / local shell). */
function call(path: string, init: RequestInit = {}): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1:30141${path}`, init), "127.0.0.1");
}

beforeEach(() => {
	resetRemoteAccessForTests();
});

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
});

describe("pairing payload round-trip", () => {
	test("build → parse returns the same origin and token", () => {
		const payload = buildPairingPayload({ url: "https://zeta.example:30141/", token: "abc+/= 123" });
		expect(payload).toBe("https://zeta.example:30141/#zeta-token=abc%2B%2F%3D%20123");
		expect(parsePairingPayload(payload)).toEqual({ url: "https://zeta.example:30141", token: "abc+/= 123" });
	});

	test("a base path survives while query/fragment are dropped", () => {
		const payload = buildPairingPayload({ url: "https://proxy.example/zeta/?x=1#old", token: "tok" });
		expect(payload).toBe("https://proxy.example/zeta/#zeta-token=tok");
		expect(parsePairingPayload(payload)?.url).toBe("https://proxy.example/zeta");
	});

	test("an empty token and a non-http URL are rejected, junk payloads parse to null", () => {
		expect(() => buildPairingPayload({ url: "https://h", token: "  " })).toThrow();
		expect(() => buildPairingPayload({ url: "zeta://pair", token: "tok" })).toThrow();
		expect(parsePairingPayload("not a url")).toBeNull();
		expect(parsePairingPayload("https://h/#other=1")).toBeNull();
	});

	test("the rendered SVG is a drawn symbol, not the payload", () => {
		const svg = renderPairingQrSvg("https://zeta.example:30141/#zeta-token=tok");
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg).toContain('viewBox="0 0 ');
		expect(svg).toContain("<path fill=");
		expect(svg).not.toContain("zeta-token");
	});
});

describe("pairing base URL resolution", () => {
	test("explicit URL > publicUrl > non-loopback request origin > LAN > request origin", () => {
		const config = { remote: { publicUrl: "https://zeta.example" } } as never;
		expect(
			resolvePairingBaseUrl({ requestUrl: "http://127.0.0.1:30141/", config, explicitUrl: "https://explicit" }),
		).toBe("https://explicit");
		expect(resolvePairingBaseUrl({ requestUrl: "http://127.0.0.1:30141/", config })).toBe("https://zeta.example");
		expect(
			resolvePairingBaseUrl({
				requestUrl: "http://192.168.1.20:30141/",
				config: {} as never,
				lanAddress: "192.168.1.20",
			}),
		).toBe("http://192.168.1.20:30141");
		expect(
			resolvePairingBaseUrl({ requestUrl: "http://127.0.0.1:30141/", config: {} as never, lanAddress: "10.0.0.9" }),
		).toBe("http://10.0.0.9:30141");
		expect(
			resolvePairingBaseUrl({ requestUrl: "http://127.0.0.1:30141/", config: {} as never, lanAddress: null }),
		).toBe("http://127.0.0.1:30141");
	});

	test("firstLanAddress skips internal and IPv6 entries", () => {
		const interfaces = {
			lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
			eth: [{ address: "fe80::1", family: "IPv6", internal: false }],
			wifi: [{ address: "192.168.1.30", family: "IPv4", internal: false }],
		} as never;
		expect(firstLanAddress(interfaces)).toBe("192.168.1.30");
		expect(firstLanAddress({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] } as never)).toBeNull();
	});
});

describe("REST endpoints", () => {
	test("GET /api/remote/pairing returns url, token, payload and QR svg", async () => {
		await setup("remote:\n  token: paired-token\n");
		const res = await call("/api/remote/pairing?url=https%3A%2F%2Fphone.example%3A30141");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as { url: string; token: string; payload: string; svg: string };
		expect(body.url).toBe("https://phone.example:30141");
		expect(body.token).toBe("paired-token");
		expect(parsePairingPayload(body.payload)).toEqual({ url: "https://phone.example:30141", token: "paired-token" });
		expect(body.svg).toContain("<svg");
	});

	test("pairing without a token is 409", async () => {
		await setup("remote: {}\n");
		const res = await call("/api/remote/pairing");
		expect(res.status).toBe(409);
	});

	test("POST rotate mints, persists, and revokes the previous token", async () => {
		await setup("remote:\n  token: old-token\n");
		const res = await call("/api/remote/token/rotate", { method: "POST" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; tokenUpdatedAt: string };
		expect(body.token.length).toBeGreaterThan(20);
		expect(body.tokenUpdatedAt).toBeTruthy();

		const saved = await readConfigFile();
		expect(saved.remote?.token).toBe(body.token);
		expect(saved.remote?.revokedTokens).toContain(hashRemoteToken("old-token"));
	});

	test("POST revoke {all:true} clears the active token and pairing afterwards is 409", async () => {
		await setup("remote:\n  token: doomed-token\n");
		const res = await call("/api/remote/token/revoke", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ all: true }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { activeTokenRevoked: boolean };
		expect(body.activeTokenRevoked).toBe(true);

		const saved = await readConfigFile();
		expect(saved.remote?.token).toBeUndefined();
		expect(saved.remote?.revokedTokens).toContain(hashRemoteToken("doomed-token"));
		expect((await call("/api/remote/pairing")).status).toBe(409);
	});

	test("POST revoke without a token or all is 400", async () => {
		await setup("remote:\n  token: tok\n");
		const res = await call("/api/remote/token/revoke", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(400);
	});
});
