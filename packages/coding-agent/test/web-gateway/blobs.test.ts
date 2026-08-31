import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBlobsDir, refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { BlobStore } from "../../src/session/blob-store";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR", "OMP_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

async function setup(token?: string): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-blobs-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	process.env.OMP_CODING_AGENT_DIR = agentDir;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	if (token) await writeFile(join(agentDir, "web.yml"), `remote:\n  token: ${token}\n`, "utf8");
	refreshDirsFromEnv();
}

function request(hash: string, method = "GET", headers: Record<string, string> = {}): Request {
	return new Request(`http://127.0.0.1/api/blobs/${hash}`, { method, headers });
}

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("gateway blob reads", () => {
	test("returns canonical session blob bytes for loopback callers", async () => {
		await setup();
		const stored = await new BlobStore(getBlobsDir()).put(Buffer.from("gateway blob bytes"));

		const response = await webGatewayFetch(request(stored.hash), "127.0.0.1");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.text()).toBe("gateway blob bytes");
	});

	test("supports bodyless HEAD reads and rejects unsupported methods", async () => {
		await setup();
		const stored = await new BlobStore(getBlobsDir()).put(Buffer.from("hello"));

		const head = await webGatewayFetch(request(stored.hash, "HEAD"), "127.0.0.1");
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("5");
		expect(await head.text()).toBe("");
		expect((await webGatewayFetch(request(stored.hash, "POST"), "127.0.0.1")).status).toBe(405);
	});

	test("rejects malformed, missing, and traversal-shaped identifiers without reading outside the blob store", async () => {
		await setup();
		for (const hash of ["../secret", "A".repeat(64), "a".repeat(63), "a".repeat(65), "a".repeat(64)]) {
			const response = await webGatewayFetch(request(hash), "127.0.0.1");
			expect(response.status).toBe(404);
		}
	});

	test("requires the remote token for non-loopback blob reads", async () => {
		await setup("blob-token");
		const stored = await new BlobStore(getBlobsDir()).put(Buffer.from("remote bytes"));

		expect((await webGatewayFetch(request(stored.hash), "192.168.1.5")).status).toBe(403);
		const authorized = await webGatewayFetch(
			request(stored.hash, "GET", { "x-zeta-token": "blob-token" }),
			"192.168.1.5",
		);
		expect(authorized.status).toBe(200);
		expect(await authorized.text()).toBe("remote bytes");
	});
});
