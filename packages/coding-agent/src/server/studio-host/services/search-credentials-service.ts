import { getOAuthCredentialProvider } from "@linxiraos/pi-ai/oauth";
import { authPolicyFor } from "@linxiraos/pi-catalog/compat/auth";
import type { AgentSession } from "../../../session/agent-session";
import { toLogoutAccounts } from "../../../slash-commands/helpers/logout";
import { StudioOpError as SessionControlError } from "../errors.js";
import type { SearchCredentialStatus, SearchCredentialsOperation } from "../protocol/contracts/search-credentials.js";

/** The credential identities used by the built-in search engines/groundings. */
const SEARCH_AUTH_PROVIDERS: Readonly<Record<string, true>> = {
	parallel: true,
	perplexity: true,
	google: true,
	"google-gemini-cli": true,
	"google-antigravity": true,
	anthropic: true,
	openai: true,
	"openai-codex": true,
	xai: true,
	"xai-oauth": true,
	zai: true,
	exa: true,
	keenable: true,
	tinyfish: true,
	jina: true,
	kagi: true,
	tavily: true,
	firecrawl: true,
	brave: true,
	deepseek: true,
	"kimi-code": true,
	synthetic: true,
	"ollama-cloud": true,
};
const OAUTH_ONLY: Readonly<Record<string, true>> = {
	"google-gemini-cli": true,
	"google-antigravity": true,
	"openai-codex": true,
	"xai-oauth": true,
};
const MAX_PROVIDERS = 64;
const MAX_API_KEY_LENGTH = 16_384;

/**
 * Native search/OAuth credential metadata and mutations. Credentials stay in
 * the session's AuthStorage; no Host-side store or credential copy exists.
 */
export class StudioSearchCredentialsService {
	constructor(readonly session: AgentSession) {}

	async execute(
		operation: Extract<SearchCredentialsOperation, { kind: "search.credentials.list" }>,
		assertCurrent?: () => void,
	): Promise<{ providers: SearchCredentialStatus[] }>;
	async execute(
		operation: Extract<SearchCredentialsOperation, { kind: "search.credentials.set" }>,
		assertCurrent?: () => void,
	): Promise<SearchCredentialStatus>;
	async execute(
		operation: Extract<SearchCredentialsOperation, { kind: "search.credentials.remove" }>,
		assertCurrent?: () => void,
	): Promise<SearchCredentialStatus>;
	async execute(
		operation: SearchCredentialsOperation,
		assertCurrent?: () => void,
	): Promise<SearchCredentialStatus | { providers: SearchCredentialStatus[] }> {
		if (operation.sessionId !== this.session.sessionId)
			throw new SessionControlError("UNAVAILABLE", "The credential target session changed");
		const providers = operation.kind === "search.credentials.list" ? operation.providers : [operation.provider];
		if (!Array.isArray(providers) || providers.length > MAX_PROVIDERS)
			throw new SessionControlError("INVALID_ARGUMENT", "Unknown search credential provider");
		for (const provider of providers)
			if (typeof provider !== "string" || SEARCH_AUTH_PROVIDERS[provider] !== true)
				throw new SessionControlError("INVALID_ARGUMENT", "Unknown search credential provider");
		const auth = this.session.modelRegistry.authStorage;
		await auth.credentials.revalidate();
		assertCurrent?.();
		if (operation.kind === "search.credentials.list")
			return { providers: [...new Set(providers)].map(provider => this.status(provider)) };
		if (operation.kind === "search.credentials.set") {
			if (OAUTH_ONLY[operation.provider] === true)
				throw new SessionControlError("INVALID_ARGUMENT", "This provider requires its native login flow");
			const key = operation.apiKey?.trim();
			if (!key) throw new SessionControlError("INVALID_ARGUMENT", "API key is required");
			if (key.length > MAX_API_KEY_LENGTH) throw new SessionControlError("INVALID_ARGUMENT", "API key is too long");
			// Same upsert and provenance as CLI storeLoginApiKey; preserve other accounts.
			// Discard upsert's internal snapshot: it contains credential bytes.
			assertCurrent?.();
			await auth.credentials.upsert(operation.provider, { type: "api_key", key, source: "login" });
			assertCurrent?.();
			await this.session.modelRegistry.refreshProvider(operation.provider, "online");
		} else {
			if (!Number.isSafeInteger(operation.credentialId))
				throw new SessionControlError("INVALID_ARGUMENT", "Select a stored credential to remove");
			const provider = getOAuthCredentialProvider(operation.provider);
			// Native /logout reloads before deleting so another process's row is found.
			// Keep that reload, but recheck this request's live authority after it and
			// immediately before the native delete; logoutCredential has no seam for it.
			await auth.credentials.reload();
			assertCurrent?.();
			if (!(await auth.credentials.removeById(provider, operation.credentialId)))
				throw new SessionControlError(
					"UNAVAILABLE",
					"The selected credential is no longer stored; refresh the list",
				);
			assertCurrent?.();
			await this.session.modelRegistry.refreshProvider(provider, "online");
			assertCurrent?.();
			await this.session.refreshScopedModels();
		}
		assertCurrent?.();
		return this.status(operation.provider);
	}

	private status(provider: string): SearchCredentialStatus {
		const auth = this.session.modelRegistry.authStorage;
		const source = auth.keys.source(provider);
		const login = authPolicyFor(provider)?.login;
		return {
			provider,
			configured: source !== undefined,
			source: source?.kind ?? null,
			...(source?.kind === "env" && source.envVar ? { envVar: source.envVar } : {}),
			apiKeyLogin: login?.kind === "api-key",
			...(login?.kind === "api-key" && login.authUrl ? { keyUrl: login.authUrl } : {}),
			credentials: toLogoutAccounts(provider, auth.credentials.list(provider)).map(row => ({
				id: row.credentialId,
				label: row.label,
				type: row.type,
			})),
		};
	}
}
