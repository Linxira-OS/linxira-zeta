/**
 * Web Gateway — auth handlers.
 *
 * Semantic port of `web-ui/app/api/auth/*`: the OMP web-ui drove OAuth and
 * API-key auth through `ModelRuntime` plus raw `agent.db` `auth_credentials`
 * row access (`web-ui/lib/omp-auth.ts`); the gateway drives the same DTOs
 * from the runtime-native `AuthStorage` (`discoverAuthStorage`) and
 * `ModelRegistry`, so the browser UI and the CLI share one credential store.
 *
 * DTO contract mirrors the web-ui route handlers byte-compatibly: provider
 * status endpoints never return raw keys, the login SSE stream speaks
 * `auth` / `prompt_request` / `progress` / `success` / `error` / `cancelled`
 * events, and manual-code responses POST back with a short-lived token.
 */

import type { AuthStorage, OAuthAuthInfo, OAuthPrompt } from "@linxiraos/pi-ai";
import { getProviderDefinition } from "@linxiraos/pi-ai/registry";
import { getOAuthProviders } from "@linxiraos/pi-ai/registry/oauth";
import { ModelRegistry } from "../../config/model-registry";
import { discoverAuthStorage } from "../../sdk";

// ---------------------------------------------------------------------------
// DTO types (web-ui contract)
// ---------------------------------------------------------------------------

export interface ApiKeyProviderInfo {
	id: string;
	displayName: string;
	configured: boolean;
	source?: string;
	modelCount: number;
}

export interface OAuthProviderStatus {
	id: string;
	name: string;
	usesCallbackServer: boolean;
	loggedIn: boolean;
}

export interface ApiKeyStatus {
	provider: string;
	displayName: string;
	configured: boolean;
	source?: string;
	models: number;
}

// ---------------------------------------------------------------------------
// Shared auth storage + model registry
// ---------------------------------------------------------------------------

let sharedAuthStoragePromise: Promise<AuthStorage> | undefined;

export function getSharedAuthStorage(): Promise<AuthStorage> {
	sharedAuthStoragePromise ??= discoverAuthStorage();
	return sharedAuthStoragePromise;
}

let sharedRegistry: ModelRegistry | undefined;

export async function getSharedModelRegistry(): Promise<ModelRegistry> {
	const authStorage = await getSharedAuthStorage();
	sharedRegistry ??= new ModelRegistry(authStorage);
	return sharedRegistry;
}

/**
 * Reload the shared registry after the models config file changed on disk
 * (e.g. `models-config` PUT), so listing/count handlers pick up the new
 * providers without restarting the gateway.
 */
export async function refreshSharedModelRegistry(): Promise<void> {
	const registry = await getSharedModelRegistry();
	await registry.refresh("offline");
}

/**
 * Providers whose auth is subscription/OAuth-only (no usable static API key).
 * Kept in sync with the web-ui `OAUTH_PROVIDER_IDS` set plus the Zeta
 * subscription-login providers; these are surfaced through the OAuth panel
 * (`/api/auth/providers`) instead of the API-key panel.
 */
const OAUTH_ONLY_PROVIDER_IDS = new Set([
	"anthropic",
	"github-copilot",
	"openai-codex",
	"openai-codex-device",
	"google-antigravity",
	"google-gemini-cli",
]);

function displayNameFor(providerId: string): string {
	return (
		getOAuthProviders().find(provider => provider.id === providerId)?.name ??
		getProviderDefinition(providerId)?.name ??
		providerId
	);
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// GET /api/auth/all-providers — API-key-configurable providers with model counts
// ---------------------------------------------------------------------------

export async function handleAllProviders(): Promise<Response> {
	const registry = await getSharedModelRegistry();
	const authStorage = await getSharedAuthStorage();

	const modelCounts = new Map<string, number>();
	for (const model of registry.getAll()) {
		modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
	}

	const providers: ApiKeyProviderInfo[] = [];
	for (const [providerId, modelCount] of modelCounts) {
		if (OAUTH_ONLY_PROVIDER_IDS.has(providerId)) continue;
		const configured = authStorage.hasAuth(providerId);
		providers.push({
			id: providerId,
			displayName: displayNameFor(providerId),
			configured,
			source: configured ? "omp_agent_db" : undefined,
			modelCount,
		});
	}
	return json({ providers });
}

// ---------------------------------------------------------------------------
// GET /api/auth/providers — OAuth provider login status list
// ---------------------------------------------------------------------------

export async function handleOAuthProviders(): Promise<Response> {
	const authStorage = await getSharedAuthStorage();

	const loggedInProviders = new Set<string>();
	for (const entry of authStorage.listStoredCredentials()) {
		if (entry.credential.type === "oauth") {
			loggedInProviders.add(entry.provider);
		}
	}

	// Same curated naming the web-ui applied on top of the OMP provider list.
	const DISPLAY_NAMES: Record<string, string> = {
		"openai-codex": "ChatGPT Plus/Pro",
		"github-copilot": "GitHub Copilot",
		"google-antigravity": "Google AntiGravity-login",
	};
	const EXCLUDED = new Set(["anthropic"]);

	const result: OAuthProviderStatus[] = getOAuthProviders()
		.filter(provider => !EXCLUDED.has(provider.id))
		.map(provider => ({
			id: provider.id,
			name: DISPLAY_NAMES[provider.id] ?? provider.name,
			usesCallbackServer: false,
			loggedIn:
				loggedInProviders.has(provider.storeCredentialsAs ?? provider.id) || loggedInProviders.has(provider.id),
		}));
	return json({ providers: result });
}

// ---------------------------------------------------------------------------
// GET/POST/DELETE /api/auth/api-key/[provider] — static API key management
// ---------------------------------------------------------------------------

export async function handleApiKeyGet(providerId: string): Promise<Response> {
	const registry = await getSharedModelRegistry();
	const authStorage = await getSharedAuthStorage();
	const configured = authStorage.hasAuth(providerId);
	const models = registry.getAll().filter(model => model.provider === providerId).length;
	const status: ApiKeyStatus = {
		provider: providerId,
		displayName: displayNameFor(providerId),
		configured,
		source: configured ? "omp_agent_db" : undefined,
		models,
	};
	return json(status);
}

export async function handleApiKeyPost(providerId: string, req: Request): Promise<Response> {
	let apiKey: unknown;
	try {
		apiKey = ((await req.json()) as { apiKey?: unknown }).apiKey;
	} catch {
		apiKey = undefined;
	}
	if (typeof apiKey !== "string" || !apiKey.trim()) {
		return json({ error: "apiKey is required" }, 400);
	}
	try {
		const authStorage = await getSharedAuthStorage();
		await authStorage.set(providerId, { type: "api_key", key: apiKey.trim() });
		return json({ success: true });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

export async function handleApiKeyDelete(providerId: string): Promise<Response> {
	try {
		const authStorage = await getSharedAuthStorage();
		await authStorage.remove(providerId);
		return json({ success: true });
	} catch (error) {
		return json({ error: errorMessage(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout/[provider] — remove all stored credentials
// ---------------------------------------------------------------------------

export async function handleLogout(providerId: string): Promise<Response> {
	try {
		const authStorage = await getSharedAuthStorage();
		await authStorage.remove(providerId);
	} catch {
		// web-ui contract: logout failures are not fatal
	}
	return json({ ok: true });
}

// ---------------------------------------------------------------------------
// GET/POST /api/auth/login/[provider] — interactive OAuth / device-code flow
// ---------------------------------------------------------------------------

interface LoginCallback {
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

// In-memory registry: loginToken -> resolve/reject for the manual-code promise.
// Module-level is fine: the gateway runs one process per (dev/standalone/ZetaServer).
const loginCallbacks = new Map<string, LoginCallback>();

export async function handleLoginPost(providerId: string, req: Request): Promise<Response> {
	let token: unknown;
	let code: unknown;
	try {
		const body = (await req.json()) as { token?: unknown; code?: unknown };
		token = body.token;
		code = body.code;
	} catch {
		token = undefined;
		code = undefined;
	}
	if (typeof token !== "string" || typeof code !== "string" || !token || !code) {
		return json({ error: "token and code required" }, 400);
	}

	const callbacks = loginCallbacks.get(token);
	if (!callbacks) {
		return json({ error: "No pending login for token" }, 404);
	}
	// Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
	if (!token.startsWith(`${providerId}-`)) {
		return json({ error: "Token does not match provider" }, 400);
	}

	loginCallbacks.delete(token);
	callbacks.resolve(code);
	return json({ ok: true, provider: providerId });
}

export async function handleLoginGet(providerId: string, req: Request): Promise<Response> {
	const encoder = new TextEncoder();
	const send = (controller: ReadableStreamDefaultController, data: unknown) => {
		controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
	};

	// AbortController propagates client disconnect into AuthStorage.login().
	const abort = new AbortController();
	req.signal.addEventListener("abort", () => abort.abort());

	const stream = new ReadableStream({
		async start(controller) {
			const activeTokens = new Set<string>();
			let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

			const createClientInputRequest = () => {
				const token = `${providerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				activeTokens.add(token);
				const promise = new Promise<string>((resolve, reject) => {
					loginCallbacks.set(token, {
						resolve: value => {
							activeTokens.delete(token);
							loginCallbacks.delete(token);
							resolve(value);
						},
						reject: error => {
							activeTokens.delete(token);
							loginCallbacks.delete(token);
							reject(error);
						},
					});
				});
				return { token, promise };
			};

			const getManualInputRequest = () => {
				if (!pendingManualRequest) {
					pendingManualRequest = createClientInputRequest();
					pendingManualRequest.promise
						.finally(() => {
							pendingManualRequest = undefined;
						})
						.catch(() => {});
				}
				return pendingManualRequest;
			};

			// Cleanup: reject pending tokens and abort waiting promises.
			const cleanup = () => {
				for (const token of activeTokens) {
					loginCallbacks.get(token)?.reject(new Error("Login cancelled"));
					loginCallbacks.delete(token);
				}
				activeTokens.clear();
			};

			abort.signal.addEventListener("abort", cleanup);

			try {
				const oauthProviders = getOAuthProviders();
				if (!oauthProviders.some(provider => provider.id === providerId)) {
					send(controller, { type: "error", message: `Unknown provider: ${providerId}` });
					controller.close();
					return;
				}

				const authStorage = await getSharedAuthStorage();
				await authStorage.login(providerId, {
					onAuth: (info: OAuthAuthInfo) => {
						const request = getManualInputRequest();
						send(controller, {
							type: "auth",
							url: info.url,
							instructions: info.instructions ?? null,
							token: request.token,
						});
					},
					onProgress: (message: string) => {
						send(controller, { type: "progress", message });
					},
					onPrompt: (prompt: OAuthPrompt) => {
						const request = createClientInputRequest();
						send(controller, {
							type: "prompt_request",
							message: prompt.message,
							placeholder: prompt.placeholder ?? null,
							token: request.token,
						});
						return request.promise;
					},
					signal: abort.signal,
				});

				send(controller, { type: "success" });
			} catch (err) {
				const msg = errorMessage(err);
				if (msg !== "Login cancelled") {
					send(controller, { type: "error", message: msg });
				} else {
					send(controller, { type: "cancelled" });
				}
			} finally {
				cleanup();
				controller.close();
			}
		},
		cancel() {
			abort.abort();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
