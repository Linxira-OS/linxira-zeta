import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@linxiraos/pi-ai";
import { ModelRegistry } from "../../src/config/model-registry";
import { mergeOmpProviderMirrors, stripOmpOriginProviders } from "../../src/server/web-gateway/models";
import { probeOmpCompat } from "../../src/config/omp-compat";

const OMP_YML = `providers:
  ac:
    baseUrl: https://api.aaccx.pw/v1
    api: openai-completions
    apiKey: sk-upstream-ac
    models:
      - id: glm-5.3-flash
        name: glm-5.3-flash
        reasoning: true
        input: [text, image]
        contextWindow: 500000
        maxTokens: 128000
        thinking:
          mode: effort
          efforts: [low, medium, high, max]
      - id: glm-5.3-flash
        name: duplicate-should-drop
        reasoning: true
        input: [text]
        contextWindow: 1
  stepfun:
    baseUrl: https://api.stepfun.com/v1
    api: openai-completions
    apiKey: sk-upstream-stepfun
    models:
      - id: step-5-preview
        name: step-5-preview
        reasoning: true
        input: [text]
        contextWindow: 128000
      - id: step-5-preview
        name: duplicate-should-drop
        reasoning: true
        input: [text]
        contextWindow: 1
  gateway-bound:
    baseUrl: https://gateway.internal/v1
    api: openai-completions
    apiKey: sk-internal
    transport: pi-native
    models:
      - id: internal-model
        name: internal
        input: [text]
        contextWindow: 1000
`;

const LOCAL_YML = `providers:
  ac:
    baseUrl: https://local-ac.example/v1
    api: openai-completions
    apiKey: sk-local-ac
    models:
      - id: local-model
        name: Local Model
        input: [text]
        contextWindow: 1000
`;

function writeOmpFixture(dir: string, yml: string | undefined): void {
	fs.mkdirSync(dir, { recursive: true });
	if (yml !== undefined) fs.writeFileSync(path.join(dir, "models.yml"), yml);
}

function createUpstreamDb(dir: string, options?: { schemaVersion?: number; withTable?: boolean }): void {
	const db = new Database(path.join(dir, "agent.db"));
	db.exec("CREATE TABLE IF NOT EXISTS auth_schema_version (version INTEGER)");
	db.exec(`INSERT INTO auth_schema_version VALUES (${options?.schemaVersion ?? 8})`);
	if (options?.withTable !== false) {
		db.exec(`CREATE TABLE auth_credentials (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			provider TEXT NOT NULL,
			credential_type TEXT NOT NULL,
			data TEXT NOT NULL,
			disabled_cause TEXT DEFAULT NULL
		)`);
		const insert = db.prepare(
			"INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES (?, ?, ?, ?)",
		);
		insert.run("nvidia", "api_key", JSON.stringify({ key: "sk-db-nvidia" }), null);
		insert.run("opencode-zen", "oauth", JSON.stringify({ access: "gho_oauth" }), null);
		insert.run("zhipu", "api_key", JSON.stringify({ key: "sk-db-zhipu" }), "deleted by user");
		insert.run("broken", "api_key", "not-json", null);
	}
	db.close();
}

describe("probeOmpCompat", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-omp-compat-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Windows: sqlite/SHM handles can outlive the test briefly.
		}
	});

	test("returns undefined when the upstream agent dir does not exist", () => {
		expect(probeOmpCompat(path.join(tmpDir, "missing"))).toBeUndefined();
	});

	test("maps models.yml providers 1:1 and filters credential rows", () => {
		const dir = path.join(tmpDir, "agent");
		writeOmpFixture(dir, OMP_YML);
		createUpstreamDb(dir);

		const snapshot = probeOmpCompat(dir);
		expect(snapshot).toBeDefined();
		const providers = snapshot!.config.providers ?? {};
		expect(Object.keys(providers).sort()).toEqual(["ac", "gateway-bound", "stepfun"]);
		expect(providers.ac?.baseUrl).toBe("https://api.aaccx.pw/v1");
		expect(providers.ac?.api).toBe("openai-completions");
		expect(providers.ac?.apiKey).toBe("sk-upstream-ac");
		const model = providers.ac?.models?.[0];
		expect(model?.id).toBe("glm-5.3-flash");
		expect(model?.thinking?.mode).toBe("effort");
		expect(model?.thinking?.efforts).toEqual(["low", "medium", "high", "max"]);
		expect(model?.contextWindow).toBe(500000);

		// Only live api_key credentials map; oauth, soft-deleted, and undecodable rows do not.
		expect(snapshot!.credentialKeys).toEqual({ nvidia: "sk-db-nvidia" });
	});

	test("unparsable yml disables the config half but keeps credentials", () => {
		const dir = path.join(tmpDir, "agent");
		writeOmpFixture(dir, "providers: [not, an, object");
		createUpstreamDb(dir);
		const snapshot = probeOmpCompat(dir);
		expect(snapshot).toBeDefined();
		expect(snapshot!.config.providers).toEqual({});
		expect(snapshot!.credentialKeys).toEqual({ nvidia: "sk-db-nvidia" });
	});

	test("missing credentials table or old schema version disables credential mapping", () => {
		const dir = path.join(tmpDir, "agent");
		writeOmpFixture(dir, OMP_YML);
		createUpstreamDb(dir, { withTable: false });
		expect(probeOmpCompat(dir)?.credentialKeys).toEqual({});

		const oldDir = path.join(tmpDir, "agent-old");
		writeOmpFixture(oldDir, OMP_YML);
		createUpstreamDb(oldDir, { schemaVersion: 7 });
		expect(probeOmpCompat(oldDir)?.credentialKeys).toEqual({});
	});

	test("never writes to the upstream directory", () => {
		const dir = path.join(tmpDir, "agent");
		writeOmpFixture(dir, OMP_YML);
		createUpstreamDb(dir);
		probeOmpCompat(dir);
		const entries = fs.readdirSync(dir).sort();
		expect(entries).toEqual(["agent.db", "models.yml"]);
	});
});

describe("ModelRegistry OMP compat overlay", () => {
	let tmpDir: string;
	let ompDir: string;
	let authStorage: AuthStorage;

	function createRegistry(): ModelRegistry {
		return new ModelRegistry(authStorage, path.join(tmpDir, "models.yaml"), { ompAgentDir: ompDir });
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-omp-registry-"));
		ompDir = path.join(tmpDir, "omp", "agent");
	});

	afterEach(async () => {
		await authStorage.close();
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Windows: sqlite/SHM handles can outlive the test briefly.
		}
	});

	test("zero impact when no upstream state exists", async () => {
		authStorage = await AuthStorage.create(":memory:");
		const registry = createRegistry();
		expect(registry.getOmpOriginProviders().size).toBe(0);
		expect(registry.getOmpConfigProviders().size).toBe(0);
		expect(registry.getOmpCompatConfig()).toBeUndefined();
		expect(registry.getAll("all").length).toBeGreaterThan(0);
	});

	test("injects upstream providers, dedups models, skips pi-native and local names", async () => {
		authStorage = await AuthStorage.create(":memory:");
		fs.writeFileSync(path.join(tmpDir, "models.yaml"), LOCAL_YML);
		writeOmpFixture(ompDir, OMP_YML);
		createUpstreamDb(ompDir);
		const registry = createRegistry();

		const models = registry.getAll("all");
		const byId = (provider: string, id: string) => models.filter(m => m.provider === provider && m.id === id);

		// Upstream-only provider injected with its model (duplicate id dropped: first wins).
		expect(byId("stepfun", "step-5-preview")).toHaveLength(1);
		expect(byId("stepfun", "step-5-preview")[0]?.name).toBe("step-5-preview");
		// Local config wins the `ac` name: the upstream ac model is not injected.
		expect(byId("ac", "glm-5.3-flash")).toHaveLength(0);
		expect(byId("stepfun", "step-5-preview")[0]?.provider).toBe("stepfun");
		// pi-native transport skipped.
		expect(byId("gateway-bound", "internal-model")).toHaveLength(0);
		// Local config wins the `ac` name: only the local model survives under ac.
		expect(byId("ac", "local-model")[0]?.provider).toBe("ac");

		// Local wins the `ac` name, so only stepfun is an upstream config mirror.
		expect(registry.getOmpConfigProviders()).toEqual(new Set(["stepfun"]));
		expect(registry.getOmpOriginProviders()).toEqual(new Set(["stepfun", "nvidia"]));
		// Upstream api key reaches the in-memory config-override channel.
		expect(authStorage.keys.source("stepfun")?.kind).toBe("config");
		// Upstream agent.db credential for a provider Zeta has nothing local for.
		expect(authStorage.keys.source("nvidia")?.kind).toBe("config");
		// Broken upstream db row (not-json) must not break composition.
		expect(registry.getError()).toBeUndefined();
	});

	test("upstream credential does not shadow an existing local config key", async () => {
		authStorage = await AuthStorage.create(":memory:");
		fs.writeFileSync(path.join(tmpDir, "models.yaml"), LOCAL_YML);
		writeOmpFixture(ompDir, OMP_YML);
		const db = new Database(path.join(ompDir, "agent.db"));
		db.exec("CREATE TABLE auth_schema_version (version INTEGER)");
		db.exec("INSERT INTO auth_schema_version VALUES (8)");
		db.exec(`CREATE TABLE auth_credentials (provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)`);
		db.prepare("INSERT INTO auth_credentials VALUES (?, ?, ?, ?)").run(
			"ac",
			"api_key",
			JSON.stringify({ key: "sk-db-ac" }),
			null,
		);
		db.close();

		createRegistry();
		// Local models.yml already installed a config key for `ac`; the upstream
		// db row must not overwrite it.
		expect(authStorage.keys.source("ac")?.kind).toBe("config");
	});

	test("reload picks up upstream changes (reread on refresh)", async () => {
		authStorage = await AuthStorage.create(":memory:");
		writeOmpFixture(ompDir, OMP_YML);
		const registry = createRegistry();
		expect(registry.getAll("all").filter(m => m.provider === "stepfun" && m.id === "step-5-preview")).toHaveLength(1);

		const updated = `${OMP_YML}  later:
    baseUrl: https://api.later.example/v1
    api: openai-completions
    models:
      - id: later-model
        name: later
        input: [text]
        contextWindow: 1000
`;
		fs.writeFileSync(path.join(ompDir, "models.yml"), updated);
		// Ensure the mtime fingerprint changes even on coarse-grained filesystems.
		const now = new Date(Date.now() + 2000);
		fs.utimesSync(path.join(ompDir, "models.yml"), now, now);
		await registry.refresh("offline").catch(() => {});
		expect(registry.getAll("all").filter(m => m.provider === "later" && m.id === "later-model")).toHaveLength(1);
	});
});

describe("models-config DTO omp mirror helpers", () => {
	test("mergeOmpProviderMirrors adds origin and strips apiKey; local entries win", () => {
		const merged = mergeOmpProviderMirrors(
			{ providers: { local: { baseUrl: "https://local", origin: undefined } } },
			{ providers: { local: { baseUrl: "https://omp" }, omp: { baseUrl: "https://omp", apiKey: "sk-secret" } } },
		);
		expect(merged.local).toEqual({ baseUrl: "https://local", origin: undefined });
		expect(merged.omp).toEqual({ baseUrl: "https://omp", apiKey: undefined, origin: "omp" });
	});

	test("stripOmpOriginProviders removes only omp mirrors", () => {
		const providers: Record<string, unknown> = {
			omp: { baseUrl: "https://omp", origin: "omp" },
			local: { baseUrl: "https://local" },
		};
		stripOmpOriginProviders(providers);
		expect(Object.keys(providers)).toEqual(["local"]);
	});
});
