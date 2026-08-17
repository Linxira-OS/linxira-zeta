/**
 * Web Gateway — model listing and config handlers.
 *
 * Semantic port of `web-ui/app/api/models*` / `app/api/models-config*`: the
 * OMP web-ui read its own `models.json` + `models.db` caches and a synthesized
 * `omp-web-models.json` (with a global fetch interceptor for AntiGravity); the
 * gateway reads the runtime-native `ModelRegistry` and writes the runtime
 * models config file (`ModelsConfigFile`, `~/.zeta/agent/models.yml`), so
 * edits made in the browser take effect for the CLI immediately.
 *
 * DTO contract mirrors the web-ui route handlers byte-compatibly: `ModelsData`
 * for the listing, the models-config JSON object for GET/PUT, and the
 * `{ ok, latencyMs, status, responseText }` / `{ ok: false, error, stage }`
 * shapes for the connection test.
 */

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { type AssistantMessage, completeSimple } from "@linxiraos/pi-ai";
import { getSupportedEfforts } from "@linxiraos/pi-catalog/model-thinking";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { ModelRegistry } from "../../config/model-registry";
import { ModelsConfigFile } from "../../config/models-config";
import { Settings } from "../../config/settings";
import { getSharedAuthStorage, getSharedModelRegistry, refreshSharedModelRegistry } from "./auth";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

// ---------------------------------------------------------------------------
// DTO types (web-ui contract; see web-ui/lib/models-cache.ts)
// ---------------------------------------------------------------------------

export interface ModelsData {
	models: Record<string, string>;
	modelList: { id: string; name: string; provider: string; contextWindow?: number }[];
	defaultModel: { provider: string; modelId: string } | null;
	thinkingLevels: Record<string, string[]>;
	thinkingLevelMaps: Record<string, Record<string, string | null>>;
	modelError?: string;
}

const EMPTY_MODELS: ModelsData = {
	models: {},
	modelList: [],
	defaultModel: null,
	thinkingLevels: {},
	thinkingLevelMaps: {},
};

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function stripThinkingSuffix(modelRef: string): string {
	const trimmed = modelRef.trim();
	const colonIndex = trimmed.lastIndexOf(":");
	if (colonIndex === -1) return trimmed;
	const suffix = trimmed.substring(colonIndex + 1);
	return THINKING_SUFFIXES.has(suffix) ? trimmed.substring(0, colonIndex) : trimmed;
}

function filterByExactEnabledModels<T extends { id: string; provider: string }>(
	available: readonly T[],
	enabledModels: string[] | undefined,
): readonly T[] {
	if (!enabledModels || enabledModels.length === 0) return available;

	const refs = new Set(enabledModels.map(stripThinkingSuffix).filter(Boolean));
	const visible = available.filter(m => refs.has(`${m.provider}/${m.id}`) || refs.has(m.id));
	return visible.length > 0 ? visible : available;
}

function parseDefaultModel(roles: Record<string, string> | undefined): { provider: string; modelId: string } | null {
	const defaultRef = roles?.default;
	if (typeof defaultRef !== "string" || !defaultRef.trim()) return null;
	const cleanRef = stripThinkingSuffix(defaultRef.trim());
	const slashIndex = cleanRef.indexOf("/");
	if (slashIndex > 0) {
		return { provider: cleanRef.slice(0, slashIndex), modelId: cleanRef.slice(slashIndex + 1) };
	}
	return null;
}

async function loadModels(cwd: string): Promise<ModelsData> {
	const nameMap = new Map<string, string>();
	const thinkingLevels: Record<string, string[]> = {};
	const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

	const registry = await getSharedModelRegistry();
	const settings = await Settings.init({ cwd });

	const available = registry.getAvailable();
	const enabledModels = settings.get("enabledModels");
	const roles = settings.get("modelRoles") ?? {};

	// 1. Build role-model entries from the configured modelRoles.
	const roleModelEntries: { id: string; name: string; provider: string; contextWindow?: number }[] = [];
	for (const [role, ref] of Object.entries(roles)) {
		if (typeof ref !== "string" || !ref.trim()) continue;
		const cleanRef = ref.trim();
		let provider = "";
		let modelId = cleanRef;
		const slashIdx = cleanRef.indexOf("/");
		if (slashIdx > 0) {
			provider = cleanRef.slice(0, slashIdx);
			modelId = cleanRef.slice(slashIdx + 1);
		}
		const pureModelId = stripThinkingSuffix(modelId);
		// Unqualified refs resolve against the available models like the runtime
		// model resolver does; skip the role when nothing matches.
		if (!provider) {
			const match = available.find(model => model.id === pureModelId);
			if (!match) continue;
			provider = match.provider;
		}
		const mObj = available.find(
			model => model.provider === provider && (model.id === pureModelId || pureModelId.includes(model.id)),
		);
		roleModelEntries.push({
			id: pureModelId,
			name: `${pureModelId} (${role})`,
			provider,
			contextWindow: mObj?.contextWindow ?? undefined,
		});
	}

	// 2. Filter available models to enabled ones; getAvailable() already
	//    restricts to providers with auth configured.
	const visible = filterByExactEnabledModels(available, enabledModels);

	// 3. Merge role entries first (deduplicated), then the available models.
	const combinedList: { id: string; name: string; provider: string; contextWindow?: number }[] = [];
	for (const entry of roleModelEntries) {
		if (!combinedList.some(x => x.provider === entry.provider && x.id === entry.id)) {
			combinedList.push({ ...entry });
		}
	}
	for (const model of visible) {
		if (!combinedList.some(x => x.provider === model.provider && x.id === model.id)) {
			combinedList.push({
				id: model.id,
				name: model.name || model.id,
				provider: model.provider,
				contextWindow: model.contextWindow ?? undefined,
			});
		}
	}

	for (const entry of combinedList) {
		const key = `${entry.provider}:${entry.id}`;
		nameMap.set(key, entry.name);
		const model = visible.find(m => m.provider === entry.provider && m.id === entry.id);
		if (model) {
			thinkingLevels[key] = [...getSupportedEfforts(model)];
		}
	}

	const defaultModel =
		parseDefaultModel(roles) ??
		(combinedList.length > 0
			? {
					provider: combinedList[0].provider,
					modelId: combinedList[0].id,
				}
			: null);

	const modelError = registry.getError()?.message;
	return {
		models: Object.fromEntries(nameMap),
		modelList: combinedList,
		defaultModel,
		thinkingLevels,
		thinkingLevelMaps,
		...(modelError ? { modelError } : {}),
	};
}

export async function handleModels(req: Request): Promise<Response> {
	const requestedCwd = new URL(req.url).searchParams.get("cwd") ?? process.cwd();
	const cwd = path.resolve(requestedCwd);

	try {
		const stats = statSync(cwd);
		if (!stats.isDirectory()) {
			return json({ error: `Not a directory: ${cwd}` }, 400);
		}
	} catch {
		return json({ error: `Directory does not exist: ${cwd}` }, 400);
	}

	try {
		return json(await loadModels(cwd));
	} catch {
		return json(EMPTY_MODELS);
	}
}

// ---------------------------------------------------------------------------
// GET/PUT /api/models-config — read/write the runtime models config file
// ---------------------------------------------------------------------------

export async function handleModelsConfigGet(): Promise<Response> {
	const result = ModelsConfigFile.tryLoad();
	if (result.status !== "ok") return json({ providers: {} });
	return json(result.value);
}

export async function handleModelsConfigPut(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as Record<string, unknown>;
		await Bun.write(ModelsConfigFile.path(), JSON.stringify(body, null, 2));
		ModelsConfigFile.invalidate();
		await refreshSharedModelRegistry();
		return json({ success: true });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// PUT /api/models/default — persist `modelRoles.default` so the web-ui can
// set the default (provider) model for new sessions. The selector's model
// changes otherwise only affect the running session; `loadModels` derives
// `defaultModel` from `roles.default`, which previously had no write path.
// ---------------------------------------------------------------------------

export async function handleModelsDefaultPut(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { provider?: unknown; modelId?: unknown };
		const provider = typeof body.provider === "string" ? body.provider.trim() : "";
		const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
		if (!provider || !modelId) {
			return json({ error: "provider and modelId are required" }, 400);
		}
		const cwd = req.headers.get("x-zeta-cwd") ?? process.cwd();
		const agentDir = getAgentDir();
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		const roles = settings.get("modelRoles") ?? {};
		settings.set("modelRoles", { ...roles, default: `${provider}/${modelId}` });
		await settings.flush();
		return json({ success: true, default: `${provider}/${modelId}` });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// POST /api/models-config/test — probe a configured provider/model
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedProvider(
	provider: Record<string, unknown>,
	model: Record<string, unknown>,
): Record<string, unknown> {
	if (
		provider.baseUrl === undefined &&
		provider.api === "openai-completions" &&
		model.api === "google-generative-ai"
	) {
		return { ...provider, baseUrl: "https://daily-cloudcode-pa.googleapis.com" };
	}
	return provider;
}

function validateProvider(provider: Record<string, unknown>): string | null {
	if (typeof provider.api !== "string" || !provider.api.trim()) {
		return "Provider API type is required";
	}
	if (provider.baseUrl !== undefined && typeof provider.baseUrl !== "string") {
		return "Provider base URL must be a string";
	}
	if (typeof provider.baseUrl === "string" && provider.baseUrl.trim()) {
		try {
			const url = new URL(provider.baseUrl);
			if (url.protocol !== "https:" && url.protocol !== "http:") {
				return "Provider base URL must use HTTP or HTTPS";
			}
		} catch {
			return "Provider base URL is invalid";
		}
	}
	return null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter(block => block.type === "text")
		.map(block => block.text)
		.join("");
}

export async function handleModelsConfigTest(req: Request): Promise<Response> {
	let tempDir: string | undefined;

	try {
		const body = (await req.json()) as { providerName?: unknown; provider?: unknown; model?: unknown };
		const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
		if (!providerName) return json({ ok: false, error: "providerName is required" }, 400);
		if (!isRecord(body.provider)) return json({ ok: false, error: "provider is required" }, 400);
		if (!isRecord(body.model)) return json({ ok: false, error: "model is required" }, 400);

		const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
		if (!modelId) {
			return json({ ok: false, error: "Model ID is required", stage: "configuration" }, 400);
		}

		const effectiveProvider = normalizedProvider(body.provider, body.model);
		const providerError = validateProvider(effectiveProvider);
		if (providerError) {
			return json({ ok: false, error: providerError, stage: "configuration" }, 400);
		}

		// Isolate the test config: build a throwaway registry over a temp file.
		tempDir = mkdtempSync(path.join(tmpdir(), "zeta-web-model-test-"));
		const modelsPath = path.join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify(
				{
					providers: {
						[providerName]: {
							...effectiveProvider,
							models: [{ ...body.model, id: modelId }],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const authStorage = await getSharedAuthStorage();
		const registry = new ModelRegistry(authStorage, modelsPath, { ignoreLocalModelConfig: true });
		const configError = registry.getError();
		if (configError) return json({ ok: false, error: configError.message });

		const model = registry.find(providerName, modelId);
		if (!model) return json({ ok: false, error: `Model not found: ${providerName}/${modelId}` });

		const apiKey = await authStorage.getApiKey(providerName, undefined, { modelId, baseUrl: model.baseUrl });
		if (!apiKey) {
			return json({ ok: false, error: `No API key found for "${providerName}"`, stage: "credentials" }, 400);
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
		let status: number | undefined;
		const startedAt = Date.now();

		try {
			const message = await completeSimple(
				model,
				{
					messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }],
				},
				{
					apiKey,
					headers: model.headers,
					maxTokens: 16,
					cacheRetention: "none",
					signal: controller.signal,
					onResponse: response => {
						status = response.status;
					},
				},
			);

			const latencyMs = Date.now() - startedAt;
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				return json({
					ok: false,
					error:
						message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
					latencyMs,
					status,
				});
			}

			return json({
				ok: true,
				latencyMs,
				status,
				responseText: getAssistantText(message).slice(0, 300),
			});
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		return json({ ok: false, error: errorMessage(error) }, 500);
	} finally {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	}
}
