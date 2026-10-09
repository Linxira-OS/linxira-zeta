/**
 * Web Gateway POST /api/settings/reload — cross-process credential sync.
 *
 * The gateway caches one AuthStorage (in-memory credential pool) and one
 * ModelRegistry per process. Writes made by another process — `zetacode`
 * login/logout in a terminal, another desktop window — land in agent.db but
 * were invisible to every gateway auth handler until restart. The reload
 * endpoint must re-read the pool from disk (soft-deleted rows excluded, so a
 * CLI logout reads as logged-out) and force a static registry reload.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { SqliteAuthCredentialStore } from "@linxiraos/zeta/session/auth-storage";
import { handleApiKeyGet, resetSharedAuthStateForTests } from "../src/server/web-gateway/auth";
import { handleSettingsReload } from "../src/server/web-gateway/settings";

const PROVIDER = "deepseek";

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir: string;

/** Open the shared agent.db the way a separate CLI process would. */
async function withCliStore(fn: (store: SqliteAuthCredentialStore) => Promise<void>): Promise<void> {
	const store = await SqliteAuthCredentialStore.open(join(agentDir, "agent.db"));
	try {
		await fn(store);
	} finally {
		store.close();
	}
}

async function configuredFlag(): Promise<boolean> {
	const response = await handleApiKeyGet(PROVIDER);
	const status = (await response.json()) as { configured?: boolean };
	return status.configured === true;
}

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-settings-reload-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	resetSharedAuthStateForTests();
});

afterAll(async () => {
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
});

describe("POST /api/settings/reload credential sync", () => {
	test("external login/logout become visible only after reload", async () => {
		// Gateway pool loads empty.
		expect(await configuredFlag()).toBe(false);

		// A CLI process stores a key into the same agent.db.
		await withCliStore(async store => {
			await store.upsertAuthCredential(PROVIDER, { type: "api_key", key: "cli-key" });
		});
		// Stale in-memory pool: still not configured.
		expect(await configuredFlag()).toBe(false);

		const response = await handleSettingsReload(
			new Request("http://gateway/api/settings/reload", { method: "POST" }),
		);
		expect(response.status).toBe(200);
		expect(await configuredFlag()).toBe(true);

		// A CLI logout soft-deletes the row; the pool must adopt the tombstone.
		await withCliStore(async store => {
			await store.deleteAuthCredentials(PROVIDER, "deleted by user");
		});
		expect(await configuredFlag()).toBe(true); // stale until reload
		await handleSettingsReload(new Request("http://gateway/api/settings/reload", { method: "POST" }));
		expect(await configuredFlag()).toBe(false);
	});
});
