/**
 * ModelRegistry OMP overlay — upstream agent.db credential injection tier.
 *
 * The overlay injects upstream OMP agent.db API keys so bundled providers
 * (deepseek, zai, …) stay usable when Zeta itself has no credential. The
 * injection must be a *fallback*, never a shadow:
 *
 * - nothing local → upstream key serves requests (mirror tier, provider
 *   marked omp-origin);
 * - a key the user stores locally later wins immediately, with no reload —
 *   and the next static load drops the OMP provenance marker entirely;
 * - deleting the local key restores the upstream fallback (compat intent).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@linxiraos/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { AuthStorage } from "../src/session/auth-storage";

const PROVIDER = "deepseek";

/** Create an upstream OMP agent dir with a schema-8 agent.db of api_key rows. */
function seedOmpAgentDb(agentDir: string, keys: Record<string, string>): void {
	fs.mkdirSync(agentDir, { recursive: true });
	const db = new Database(path.join(agentDir, "agent.db"));
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

describe("ModelRegistry OMP overlay credential tier", () => {
	let tempDir: string;
	let ompAgentDir: string;
	let authStorage: AuthStorage;
	let originalDeepseekEnv: string | undefined;

	function newRegistry(): ModelRegistry {
		return new ModelRegistry(authStorage, path.join(tempDir, "models.json"), { ompAgentDir });
	}

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `zeta-test-omp-overlay-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		ompAgentDir = path.join(tempDir, "omp-agent");
		seedOmpAgentDb(ompAgentDir, { [PROVIDER]: "omp-upstream-key" });
		// An ambient DEEPSEEK_API_KEY would itself suppress the overlay guard;
		// this suite is about the registry tier, not env precedence.
		originalDeepseekEnv = Bun.env.DEEPSEEK_API_KEY;
		delete Bun.env.DEEPSEEK_API_KEY;
		authStorage = await AuthStorage.create(":memory:");
	});

	afterEach(async () => {
		if (originalDeepseekEnv === undefined) delete Bun.env.DEEPSEEK_API_KEY;
		authStorage.close();
		// Registry sqlite cache handles can outlive the test on Windows; never
		// fail the suite over temp-dir cleanup.
		await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
	});

	test("upstream key installs at the mirror tier and keeps the provider available", async () => {
		const registry = newRegistry();
		expect(registry.getOmpOriginProviders().has(PROVIDER)).toBe(true);
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("omp-upstream-key");
		expect(authStorage.keys.source(PROVIDER)).toEqual({ kind: "config", concrete: true });
		expect(registry.getAvailableForProviders(new Set([PROVIDER])).length).toBeGreaterThan(0);
	});

	test("key stored after the overlay never loses to the upstream key", async () => {
		const registry = newRegistry();
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("omp-upstream-key");
		// The user saves their own key through the web api-key endpoint.
		await authStorage.credentials.set(PROVIDER, { type: "api_key", key: "user-new-key" });
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("user-new-key");
		// The stored credential is what request auth resolves to, not the mirror.
		expect(registry.getOmpOriginProviders().has(PROVIDER)).toBe(true); // marker moves only on next static load
	});

	test("next static load with a local credential drops the OMP provenance", async () => {
		await authStorage.credentials.set(PROVIDER, { type: "api_key", key: "user-new-key" });
		const registry = newRegistry();
		expect(registry.getOmpOriginProviders().has(PROVIDER)).toBe(false);
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("user-new-key");
	});

	test("deleting the local credential restores the upstream fallback", async () => {
		await authStorage.credentials.set(PROVIDER, { type: "api_key", key: "user-new-key" });
		newRegistry(); // static load sees the local credential → no mirror installed
		await authStorage.credentials.remove(PROVIDER);
		const registry = newRegistry(); // next static load: nothing local → mirror returns
		expect(registry.getOmpOriginProviders().has(PROVIDER)).toBe(true);
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("omp-upstream-key");
	});

	test("stored oauth credentials suppress the upstream mirror", async () => {
		await authStorage.credentials.set(PROVIDER, [
			{
				type: "oauth",
				access: "oauth-access",
				refresh: "oauth-refresh",
				expires: Date.now() + 60 * 60_000,
			},
		]);
		const registry = newRegistry();
		expect(registry.getOmpOriginProviders().has(PROVIDER)).toBe(false);
		await expect(authStorage.keys.get(PROVIDER)).resolves.toBe("oauth-access");
	});
});
