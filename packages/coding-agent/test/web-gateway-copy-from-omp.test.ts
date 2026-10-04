/**
 * Web Gateway POST /api/auth/copy-from-omp/[provider] — one-click import of an
 * upstream OMP agent.db API key into Zeta's own credential store.
 *
 * Contracts:
 * - bundled provider + upstream *stored* key → key lands in Zeta's agent.db
 *   (`credentials.set`), the forced registry refresh drops the omp-origin
 *   marker, and the provider reads as natively configured;
 * - upstream models.yml providers (read-only mirrors) are refused, even when
 *   the name collides with a bundled provider id;
 * - unknown providers or providers without an upstream key → 404.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getSharedAuthStorage,
	getSharedModelRegistry,
	handleApiKeyGet,
	handleCopyFromOmp,
	resetSharedAuthStateForTests,
} from "../src/server/web-gateway/auth";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir: string;
let ompDir: string;
let ompYmlDir: string;

async function seedOmpDb(dir: string, keys: Record<string, string>): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	const db = new Database(join(dir, "agent.db"));
	db.exec(`CREATE TABLE auth_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		provider TEXT NOT NULL,
		credential_type TEXT NOT NULL,
		data TEXT NOT NULL,
		identity_key TEXT,
		disabled_cause TEXT,
		created_at INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL DEFAULT 0
	)`);
	db.exec("CREATE TABLE auth_schema_version (version INTEGER NOT NULL)");
	db.run("INSERT INTO auth_schema_version (version) VALUES (8)");
	const insert = db.prepare("INSERT INTO auth_credentials (provider, credential_type, data) VALUES (?, 'api_key', ?)");
	for (const [provider, key] of Object.entries(keys)) {
		insert.run(provider, JSON.stringify({ key }));
	}
	db.close();
}

async function responseJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-copy-omp-agent-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	resetSharedAuthStateForTests();

	// Upstream state A: stored db keys only, no models.yml.
	ompDir = await mkdtemp(join(tmpdir(), "zeta-gw-copy-omp-upstream-"));
	await seedOmpDb(ompDir, { deepseek: "omp-deepseek-key" });

	// Upstream state B: a models.yml provider named like a bundled provider
	// (read-only mirror), plus a db key for it.
	ompYmlDir = await mkdtemp(join(tmpdir(), "zeta-gw-copy-omp-yml-"));
	await seedOmpDb(ompYmlDir, { zai: "omp-zai-key" });
	await fs.writeFile(
		join(ompYmlDir, "models.yml"),
		JSON.stringify({
			providers: {
				zai: {
					baseUrl: "https://relay.example/v1",
					apiKey: "relay-key",
					models: [{ id: "glm-5.3-flash" }],
				},
			},
		}),
		"utf8",
	);
});

afterAll(async () => {
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	for (const dir of [agentDir, ompDir, ompYmlDir]) {
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
	}
});

describe("POST /api/auth/copy-from-omp/[provider]", () => {
	test("copies the upstream key into Zeta's store as a native credential", async () => {
		const { status, body } = await responseJson(await handleCopyFromOmp("deepseek", ompDir));
		expect(status).toBe(200);
		expect(body.success).toBe(true);

		const authStorage = await getSharedAuthStorage();
		expect(authStorage.credentials.has("deepseek")).toBe(true);
		expect(authStorage.credentials.get("deepseek")).toEqual({ type: "api_key", key: "omp-deepseek-key" });

		const detail = await responseJson(await handleApiKeyGet("deepseek"));
		expect(detail.body.configured).toBe(true);

		// The forced registry refresh must drop the omp-origin marker: the
		// provider presents as native (no read-only OMP badge anywhere).
		const registry = await getSharedModelRegistry();
		expect(registry.getOmpOriginProviders().has("deepseek")).toBe(false);
	});

	test("refuses upstream models.yml providers (read-only mirrors)", async () => {
		const { status, body } = await responseJson(await handleCopyFromOmp("zai", ompYmlDir));
		expect(status).toBe(400);
		expect(String(body.error)).toContain("read-only");
		const authStorage = await getSharedAuthStorage();
		expect(authStorage.credentials.has("zai")).toBe(false);
	});

	test("404 for unknown providers and providers without an upstream key", async () => {
		const unknown = await responseJson(await handleCopyFromOmp("not-a-provider", ompDir));
		expect(unknown.status).toBe(404);

		const noKey = await responseJson(await handleCopyFromOmp("stepfun", ompDir));
		expect(noKey.status).toBe(404);
	});
});
