/**
 * Two-layer model configuration: the hand-written `models.yml` (or `.yaml`)
 * stays user-owned, the panel writes only `models.web.yml`, and the effective
 * config prefers the user layer per provider.
 *
 * Also covers the `.yaml` read fallback shared by the remaining YAML config
 * loaders.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { getCapability } from "@linxiraos/zeta/capability";
import { settingsCapability } from "@linxiraos/zeta/capability/settings";
import type { LoadContext } from "@linxiraos/zeta/capability/types";
import {
	MODELS_WEB_FILENAME,
	loadModelsLayers,
	mergeModelsConfigs,
	modelsConfigOrigins,
	modelsWebConfigPath,
	writeModelsWebConfig,
} from "@linxiraos/zeta/config/models-config-layers";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import type { ModelsConfig } from "@linxiraos/zeta/config/models-config-schema";
import { probeOmpCompat } from "@linxiraos/zeta/config/omp-compat";
import { WebConfig } from "@linxiraos/zeta/config/web-config";
import "@linxiraos/zeta/discovery";
import { listOmpExtensionRoots } from "@linxiraos/zeta/discovery/zeta-extension-roots";
import { resetSharedAuthStateForTests } from "@linxiraos/zeta/server/web-gateway/auth";
import {
	handleModelsConfigGet,
	handleModelsConfigPut,
	handleModelsImport,
} from "@linxiraos/zeta/server/web-gateway/models";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { loadSecrets } from "@linxiraos/zeta/secrets";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";

const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
const dirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function putJson(url: string, body: unknown): Request {
	return new Request(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

const USER_CONFIG = `providers:
  shared:
    baseUrl: https://user.example/v1
    apiKey: user-key
    api: openai-completions
    models:
      - id: user-model
  hand-written:
    baseUrl: https://hand.example/v1
    apiKey: hand-key
    api: openai-completions
    models:
      - id: hand-model
`;

const WEB_CONFIG = `providers:
  shared:
    baseUrl: https://web.example/v1
    apiKey: web-key
    api: openai-completions
    models:
      - id: web-shadowed-model
  panel-only:
    baseUrl: https://panel.example/v1
    apiKey: panel-key
    api: openai-completions
    models:
      - id: panel-model
`;

beforeAll(() => {
	const agentDir = tempDir("zeta-models-layers-agent-");
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
	resetSharedAuthStateForTests();
});

afterAll(() => {
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	resetSharedAuthStateForTests();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("model config layers", () => {
	it("merges user over web per provider and reports origins", () => {
		const user = YAML.parse(USER_CONFIG) as ModelsConfig;
		const web = YAML.parse(WEB_CONFIG) as ModelsConfig;
		const merged = mergeModelsConfigs(user, web);
		expect(Object.keys(merged?.providers ?? {}).sort()).toEqual(["hand-written", "panel-only", "shared"]);
		expect(merged?.providers?.shared?.baseUrl).toBe("https://user.example/v1");
		expect(merged?.providers?.["panel-only"]?.baseUrl).toBe("https://panel.example/v1");
		expect(modelsConfigOrigins(user, web)).toEqual({
			shared: "user",
			"hand-written": "user",
			"panel-only": "web",
		});
	});

	it("keeps web providers when the user layer does not define them, and vice versa", () => {
		const merged = mergeModelsConfigs(
			{ providers: { onlyUser: { baseUrl: "https://u.test" } } },
			{ providers: { onlyWeb: { baseUrl: "https://w.test" } } },
		);
		expect(Object.keys(merged?.providers ?? {}).sort()).toEqual(["onlyUser", "onlyWeb"]);
	});

	it("ignores an invalid panel layer and keeps the user layer", () => {
		const dir = tempDir("zeta-models-invalid-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, USER_CONFIG);
		writeFileSync(modelsWebConfigPath(userPath), "providers:\n  broken:\n    baseUrl: 42\n");
		const layers = loadModelsLayers(userPath);
		expect(layers.userError).toBeUndefined();
		expect(layers.web).toBeUndefined();
		expect(layers.webError).toBeDefined();
		expect(mergeModelsConfigs(layers.user, layers.web)?.providers?.shared?.baseUrl).toBe("https://user.example/v1");
	});

	it("writes only the panel layer", () => {
		const dir = tempDir("zeta-models-write-");
		const webPath = modelsWebConfigPath(path.join(dir, "models.yml"));
		expect(webPath.endsWith(MODELS_WEB_FILENAME)).toBe(true);
		writeModelsWebConfig(webPath, { acme: { baseUrl: "https://acme.test/v1" } });
		expect(YAML.parse(readFileSync(webPath, "utf8"))).toEqual({
			providers: { acme: { baseUrl: "https://acme.test/v1" } },
		});
	});
});

describe("models-config gateway", () => {
	function seed(): { dir: string; userPath: string; webPath: string; userBytes: string } {
		const dir = tempDir("zeta-models-gateway-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, USER_CONFIG);
		const webPath = modelsWebConfigPath(userPath);
		writeFileSync(webPath, WEB_CONFIG);
		return { dir, userPath, webPath, userBytes: readFileSync(userPath, "utf8") };
	}

	it("GET returns the merged view with per-provider origins", async () => {
		const { userPath } = seed();
		const response = await handleModelsConfigGet(userPath);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			providers: Record<string, { origin?: string; baseUrl?: string }>;
		};
		expect(body.providers.shared?.origin).toBe("user");
		expect(body.providers.shared?.baseUrl).toBe("https://user.example/v1");
		expect(body.providers["panel-only"]?.origin).toBe("web");
		expect(body.providers["hand-written"]?.origin).toBe("user");
	});

	it("PUT writes the panel layer only and leaves the user file byte-identical", async () => {
		const { userPath, webPath, userBytes } = seed();
		const response = await handleModelsConfigPut(
			putJson("https://gateway.test/api/models-config", {
				providers: {
					"panel-only": { baseUrl: "https://panel2.example/v1", api: "openai-completions" },
					"new-panel": { baseUrl: "https://new.example/v1" },
				},
			}),
			userPath,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(readFileSync(userPath, "utf8")).toBe(userBytes);
		const written = YAML.parse(readFileSync(webPath, "utf8")) as {
			providers: Record<string, { baseUrl?: string }>;
		};
		expect(Object.keys(written.providers).sort()).toEqual(["new-panel", "panel-only"]);
		expect(written.providers["panel-only"]?.baseUrl).toBe("https://panel2.example/v1");
	});

	it("PUT refuses a provider whose origin is user and names it", async () => {
		const { userPath, webPath, userBytes } = seed();
		const response = await handleModelsConfigPut(
			putJson("https://gateway.test/api/models-config", {
				providers: {
					shared: { origin: "user", baseUrl: "https://stale.example/v1" },
					"panel-only": { origin: "web", baseUrl: "https://panel.example/v1" },
				},
			}),
			userPath,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { success: boolean; ignored?: string[]; message?: string };
		expect(body.success).toBe(true);
		expect(body.ignored).toEqual(["shared"]);
		expect(body.message).toContain("shared");
		expect(readFileSync(userPath, "utf8")).toBe(userBytes);
		const written = YAML.parse(readFileSync(webPath, "utf8")) as { providers: Record<string, unknown> };
		expect(Object.keys(written.providers)).toEqual(["panel-only"]);
	});

	it("PUT refuses a user provider even when the origin marker is missing", async () => {
		const { userPath, webPath } = seed();
		const response = await handleModelsConfigPut(
			putJson("https://gateway.test/api/models-config", {
				providers: { "hand-written": { baseUrl: "https://stale.example/v1" } },
			}),
			userPath,
		);
		const body = (await response.json()) as { ignored?: string[] };
		expect(body.ignored).toEqual(["hand-written"]);
		const written = YAML.parse(readFileSync(webPath, "utf8")) as { providers: Record<string, unknown> };
		expect(written.providers).toEqual({});
	});

	it("import writes the panel layer, never the user file", async () => {
		const dir = tempDir("zeta-models-import-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, USER_CONFIG);
		const userBytes = readFileSync(userPath, "utf8");
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(async () =>
				new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				})) as unknown as typeof fetch,
		);
		const response = await handleModelsImport(
			new Request("https://gateway.test/api/models/import?base=https://api.acme.test/v1"),
			userPath,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ imported: 2, provider: "api.acme.test" });
		expect(readFileSync(userPath, "utf8")).toBe(userBytes);
		const written = YAML.parse(readFileSync(modelsWebConfigPath(userPath), "utf8")) as {
			providers: Record<string, { models: Array<{ id: string }> }>;
		};
		expect(written.providers["api.acme.test"]?.models.map(model => model.id)).toEqual(["m1", "m2"]);
	});

	it("import refuses a provider defined in the user layer", async () => {
		const dir = tempDir("zeta-models-import-user-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, "providers:\n  api.acme.test:\n    baseUrl: https://api.acme.test/v1\n    apiKey: k\n");
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(async () =>
				new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				})) as unknown as typeof fetch,
		);
		const response = await handleModelsImport(
			new Request("https://gateway.test/api/models/import?base=https://api.acme.test/v1"),
			userPath,
		);
		expect(response.status).toBe(409);
	});
});

describe("model registry merge", () => {
	it("loads providers from both layers with user precedence", async () => {
		const dir = tempDir("zeta-models-registry-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, USER_CONFIG);
		writeFileSync(modelsWebConfigPath(userPath), WEB_CONFIG);

		const authStorage = await AuthStorage.create(":memory:");
		try {
			const registry = new ModelRegistry(authStorage, userPath);
			const available = registry.getAvailable();
			expect(available.some(model => model.provider === "shared" && model.id === "user-model")).toBe(true);
			expect(available.some(model => model.provider === "shared" && model.id === "web-shadowed-model")).toBe(false);
			expect(available.some(model => model.provider === "panel-only" && model.id === "panel-model")).toBe(true);
		} finally {
			authStorage.close();
		}
	});

	it("starts with an invalid panel layer, using the user layer only", async () => {
		const dir = tempDir("zeta-models-registry-invalid-");
		const userPath = path.join(dir, "models.yml");
		writeFileSync(userPath, USER_CONFIG);
		writeFileSync(modelsWebConfigPath(userPath), "providers:\n  broken:\n    baseUrl: 42\n");

		const authStorage = await AuthStorage.create(":memory:");
		try {
			const registry = new ModelRegistry(authStorage, userPath);
			const available = registry.getAvailable();
			expect(available.some(model => model.provider === "shared" && model.id === "user-model")).toBe(true);
			expect(available.some(model => model.provider === "broken")).toBe(false);
		} finally {
			authStorage.close();
		}
	});
});

describe("YAML sibling read fallback", () => {
	it("loads the user models layer from models.yaml when models.yml is absent", () => {
		const dir = tempDir("zeta-models-yaml-");
		writeFileSync(path.join(dir, "models.yaml"), USER_CONFIG);
		const layers = loadModelsLayers(path.join(dir, "models.yml"));
		expect(layers.userError).toBeUndefined();
		expect(layers.user?.providers?.shared?.baseUrl).toBe("https://user.example/v1");
	});

	it("reads web.yaml when web.yml is absent", async () => {
		const dir = tempDir("zeta-web-yaml-");
		writeFileSync(path.join(dir, "web.yaml"), "tray:\n  autostart: true\n");
		const config = await WebConfig.load(path.join(dir, "web.yml"));
		expect(config.getData().tray.autostart).toBe(true);
	});

	it("reads secrets.yaml when secrets.yml is absent", async () => {
		const dir = tempDir("zeta-secrets-yaml-");
		const agentDir = path.join(dir, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path.join(agentDir, "secrets.yaml"), '- type: plain\n  content: "supersecret123"\n');
		const entries = await loadSecrets(path.join(dir, "cwd"), agentDir);
		expect(entries.map(entry => entry.content)).toEqual(["supersecret123"]);
	});

	it("reads a project config.yaml in the builtin settings discovery", async () => {
		const root = tempDir("zeta-builtin-yaml-");
		const project = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		mkdirSync(path.join(project, ".zeta"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path.join(project, ".zeta", "config.yaml"), "modelRoles:\n  default: acme/large\n");

		const capability = getCapability(settingsCapability.id);
		const provider = capability?.providers.find(entry => entry.id === "native");
		if (!provider) throw new Error("native settings provider missing");
		const ctx: LoadContext = { cwd: project, home: path.join(root, "home"), repoRoot: null, agentDir };
		const result = (await (provider.load as (c: LoadContext) => Promise<{ items: Array<{ path: string }> }>)(
			ctx,
		)) as { items: Array<{ path: string; data: Record<string, unknown> }> };
		expect(result.items.map(item => [path.basename(item.path), item.data])).toEqual([
			["config.yaml", { modelRoles: { default: "acme/large" } }],
		]);
	});

	it("reads a project config.yaml for configured extension roots", async () => {
		const root = tempDir("zeta-extension-roots-yaml-");
		const project = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const extDir = path.join(project, "ext");
		mkdirSync(path.join(project, ".zeta"), { recursive: true });
		mkdirSync(extDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path.join(project, ".zeta", "config.yaml"), "extensions:\n  - ./ext\n");
		const ctx: LoadContext = { cwd: project, home: path.join(root, "home"), repoRoot: null, agentDir };
		const roots = await listOmpExtensionRoots(ctx);
		expect(roots.map(rootEntry => rootEntry.name)).toContain("ext");
	});

	it("probes the upstream OMP models.yaml sibling", () => {
		const dir = tempDir("zeta-omp-yaml-");
		writeFileSync(
			path.join(dir, "models.yaml"),
			"providers:\n  upstream:\n    baseUrl: https://upstream.example/v1\n    apiKey: k\n",
		);
		const snapshot = probeOmpCompat(dir);
		expect(Object.keys(snapshot?.config.providers ?? {})).toEqual(["upstream"]);
	});
});
