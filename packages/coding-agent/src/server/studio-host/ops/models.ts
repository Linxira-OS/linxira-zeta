/**
 * Studio operations — provider configuration, model roles, fallback chains, login.
 *
 * Operation → gateway route:
 * - `models.provider.upsert` / `models.provider.delete` → `GET /api/models-config`
 *   (read the merged document) then `PUT /api/models-config` (rewrite the panel
 *   layer). The provider node is built by the contract's own writer
 *   (`draftProviderYamlNode` / `providerModelYamlNode`), so the YAML written is
 *   the YAML the editor's preview card promised.
 * - `models.provider.test` → `POST /api/models-config/test` for a saved provider
 *   that has a model to call; otherwise `POST /api/models-config/discover` as a
 *   reachability probe (the test route requires a model id).
 * - `models.provider.probe` → `POST /api/models-config/discover`.
 * - `models.login.logout` → `POST /api/auth/logout/:provider`.
 * - `models.roles.set` / `models.roles.write` → `GET /api/settings` (current
 *   `modelRoles` map) then `PUT /api/settings` `{path:"modelRoles"}`.
 * - `models.fallback.set` → `PUT /api/settings` for `retry.fallbackChains` and
 *   `retry.fallbackRevertPolicy`.
 * - `models.provider.setEnabled` → `GET /api/settings/values` (current
 *   `disabledProviders`) + `PUT /api/settings` with the whole array.
 * - `models.hidden.set` → `PUT /api/settings` (`hiddenModels`); pickers hide
 *   those selectors while the catalog and role resolution keep them.
 * - `models.providerOrder.set` / `models.cycleOrder.set` → `PUT /api/settings`
 *   for `modelProviderOrder` / `cycleOrder` (the input carries the whole list).
 * - `models.yml.write` → `GET /api/models-config` (current secrets + staleness
 *   hash), parse the editor YAML, then `PUT /api/models-config`. The staleness
 *   token is a SHA-256 over the canonical merged provider document, which this
 *   host computes itself; the gateway exposes no hash of its own.
 *
 * Deliberately omitted — no Zeta source can answer them without inventing state:
 * - `models.get` — every field is now coverable from `/api/models`,
 *   `/api/models-config`, `/api/auth/providers|all-providers`,
 *   `/api/settings`, `/api/settings/values`, the contract's
 *   `BUILTIN_MODEL_ROLES` and the search-provider id/label table EXCEPT the
 *   web-search section: `WebSearchProviderRecord` requires `credentialFree` and
 *   `hasCredential`, and Zeta exposes no per-engine credential metadata
 *   (`SearchProvider.isAvailable` needs the live AuthStorage, which a handler
 *   may not open). Both are mandatory in the contract, so the section cannot be
 *   "id/label only" and guessing them would misreport every engine. `presets`
 *   would be `[]` (this host ships none) and is not the blocker.
 * - `models.catalog.refresh` — `/api/models-config/catalog` is a models.dev
 *   *search* route with an internal TTL cache; it reports no catalog
 *   version/commit and cannot force a refresh.
 * - `models.discovery.refresh` — nothing rewrites `models.db`; `/discover` is a
 *   one-shot probe.
 * - `models.login.start` — `/api/auth/login/:provider` is an SSE stream that
 *   hands the browser an auth URL and waits for a code POSTed back with a
 *   token. The Studio contract has an operation for neither half, so the Host
 *   cannot drive the flow and must not report a login it did not complete.
 * - `models.roles.create` / `models.roles.delete` / `models.roleStorage.set`
 *   → `GET/PUT /api/settings` for `modelTags`, `modelRoles`, `modelRoleStorage`.
 * - `models.webSearch.*`, `models.adaptation.resolve` — C-class in the host
 *   spec (no Zeta backend).
 */
import { createHash } from "node:crypto";
import { YAML } from "bun";
import { getProjectDir, isRecord } from "@linxiraos/pi-utils";
import type {
	AvailableModelRecord,
	CommandInput,
	ConfigWriteResult,
	ModelCatalogEntry,
	ModelConfigReadModel,
	ModelDiscoveryModel,
	ModelDiscoveryResult,
	ModelProviderRecord,
	ModelProviderTestResult,
	ModelProviderUpsertInput,
	ModelRoleCreateInput,
	ModelRoleRecord,
	QueryInput,
	ProviderYamlDraft,
	WebSearchConfigReadModel,
} from "../contract/index.js";
import {
	draftProviderYamlNode,
	isModelEnvConfigName,
	parseModelKind,
	providerModelYamlNode,
} from "../contract/index.js";
import {
	type GatewayReply,
	StudioOpError,
	callGateway,
	gatewayJson,
	invalid,
	optionalString,
	requiredString,
	segment,
	unavailable,
} from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { MODEL_ROLE_IDS, MODEL_ROLES } from "../../../config/model-roles.js";
import { findAgentRoleReferences, findRoleAssignmentReferences } from "../../../config/role-references.js";
import { discoverAgents } from "../../../task/discovery.js";
import type { AgentDefinition } from "../../../task/types.js";
import { resolveWorkspaceCwd } from "./git.js";

const MODELS_CONFIG_ROUTE = "/api/models-config";
const MODELS_CONFIG_TEST_ROUTE = "/api/models-config/test";
const MODELS_CONFIG_DISCOVER_ROUTE = "/api/models-config/discover";
const MODELS_ROUTE = "/api/models";
const SETTINGS_ROUTE = "/api/settings";
const SETTINGS_VALUES_ROUTE = "/api/settings/values";

/** Cap on gateway prose echoed into a result `detail`; answers can be long. */
const MAX_DETAIL = 300;

const STALE_DOCUMENT = "the model configuration changed since it was read; reload the model page before saving";

// ---------------------------------------------------------------------------
// Untrusted-JSON readers
// ---------------------------------------------------------------------------

/** A non-empty string field, or `undefined`. */
function stringField(record: unknown, field: string): string | undefined {
	if (!isRecord(record)) return undefined;
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** A finite number field, or `undefined`. */
function numberField(record: unknown, field: string): number | undefined {
	if (!isRecord(record)) return undefined;
	const value = record[field];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A string field that may be blank (absent and blank both read as `""`). */
function optionalText(record: Readonly<Record<string, unknown>>, field: string): string {
	const value = record[field];
	if (value === undefined) return "";
	if (typeof value !== "string") throw invalid(`${field} must be a string`);
	return value;
}

/** An optional number field; a present non-number is an invalid argument. */
function optionalNumber(record: Readonly<Record<string, unknown>>, field: string): number | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${field} must be a number`);
	return value;
}

/** An optional boolean field; a present non-boolean is an invalid argument. */
function optionalBoolean(record: Readonly<Record<string, unknown>>, field: string): boolean | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw invalid(`${field} must be a boolean`);
	return value;
}

/** Clip gateway prose for a user-facing `detail`. */
function clip(text: string): string {
	return text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL)}…`;
}

/** The gateway's own error sentence, when it sent one. */
function gatewayErrorText(body: unknown): string {
	const error = stringField(body, "error");
	return error ?? "the gateway rejected the request";
}

/**
 * Turn a failed gateway call into the right Studio failure: a 4xx is the
 * caller's problem (`invalid`), anything else is the host's (`unavailable`).
 */
function gatewayFailure(reply: GatewayReply): Error {
	const text = `${reply.status}: ${gatewayErrorText(reply.body)}`;
	return reply.status >= 500 ? unavailable(text) : invalid(text);
}

/** Deterministic JSON (sorted object keys) so the document hash is stable. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Staleness token for the merged provider document; the panel round-trips it. */
function hashProviders(providers: Readonly<Record<string, unknown>>): string {
	return createHash("sha256").update(canonicalJson(providers)).digest("hex");
}

/** Reject a write whose caller read a different document than the one on disk. */
function requireExpectedHash(expected: string | undefined, providers: Readonly<Record<string, unknown>>): void {
	if (expected === undefined) return;
	const actual = hashProviders(providers);
	if (expected !== actual) throw new StudioOpError("STATE_VERSION_CONFLICT", STALE_DOCUMENT);
}

// ---------------------------------------------------------------------------
// `GET|PUT /api/models-config` — the two-layer models document
// ---------------------------------------------------------------------------

/** The merged models document as the gateway reports it (secrets included). */
interface ProviderDocument {
	/** Provider id → models.yml `providers.<id>` node, annotated with `origin`. */
	readonly providers: Readonly<Record<string, unknown>>;
}

/** What the gateway's write confirmation actually reported. */
interface ProviderWriteAck {
	/** Provider ids the gateway refused because the hand-written file owns them. */
	readonly ignored: readonly string[];
	readonly message?: string;
}

/** The provider node from the merged document, when it is an object. */
function providerNode(document: ProviderDocument, id: string): Readonly<Record<string, unknown>> | undefined {
	const value = document.providers[id];
	return isRecord(value) ? value : undefined;
}

/**
 * Read the merged document. `providers` carries `origin` markers: `user` for the
 * hand-written `models.yml` and `web` for the panel layer. The document also
 * carries every plaintext `apiKey`; it is
 * only ever round-tripped back to the gateway, never returned to a client.
 */
async function readProviderDocument(): Promise<ProviderDocument> {
	const body = await gatewayJson<unknown>(MODELS_CONFIG_ROUTE);
	if (!isRecord(body)) throw unavailable("GET /api/models-config returned a non-object document");
	const providers = body.providers;
	if (providers !== undefined && !isRecord(providers)) {
		throw unavailable("GET /api/models-config returned malformed providers");
	}
	return { providers: providers ?? {} };
}

/**
 * Rewrite the panel layer with `providers`. The gateway drops `origin` markers,
 * ignores ids the hand-written layer owns (and reports them in `ignored`), and
 * skips the legacy upstream mirrors, so a full-document write never touches
 * upstream state.
 */
async function writeProviderDocument(providers: Readonly<Record<string, unknown>>): Promise<ProviderWriteAck> {
	const body = await gatewayJson<unknown>(MODELS_CONFIG_ROUTE, { method: "PUT", body: { providers } });
	if (!isRecord(body) || body.success !== true) {
		throw unavailable("PUT /api/models-config did not confirm the write");
	}
	const ignored = Array.isArray(body.ignored)
		? body.ignored.filter((name): name is string => typeof name === "string")
		: [];
	const message = stringField(body, "message");
	return { ignored, ...(message !== undefined ? { message } : {}) };
}

/** The auth mode a stored node represents, so the writer can read a redacted key. */
function storedAuthOf(node: Readonly<Record<string, unknown>>): string | undefined {
	const auth = stringField(node, "auth");
	if (auth === "none" || auth === "oauth") return auth;
	const key = stringField(node, "apiKey");
	if (key === undefined) return undefined;
	if (key.startsWith("!")) return "command";
	return isModelEnvConfigName(key) ? "env" : "api-key";
}

/** The stored row for one model id, copied so the writer never mutates the document. */
function storedModelRow(rows: readonly unknown[], id: string): Record<string, unknown> | undefined {
	for (const row of rows) {
		if (isRecord(row) && stringField(row, "id") === id) return { ...row };
	}
	return undefined;
}

/** The editor's header map as the writer's `Name: value` lines. */
function headerText(headers: unknown): string {
	if (headers === undefined || headers === null) return "";
	if (!isRecord(headers)) throw invalid("headers must be an object");
	const lines: string[] = [];
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value !== "string") throw invalid(`headers.${name} must be a string`);
		lines.push(`${name}: ${value}`);
	}
	return lines.join("\n");
}

/** The write-only auth payload, narrowed for the contract's YAML writer. */
interface AuthDraft {
	readonly type: string;
	readonly apiKey: string;
	readonly envName: string;
	readonly command: string;
	readonly clearSecret: boolean;
}

const AUTH_TYPES: Readonly<Record<string, true>> = {
	oauth: true,
	"api-key": true,
	env: true,
	command: true,
	none: true,
};

function readAuthDraft(value: unknown): AuthDraft {
	if (!isRecord(value)) throw invalid("auth must be an object");
	const type = optionalText(value, "type");
	if (type === "") throw invalid("auth.type must be a non-empty string");
	if (AUTH_TYPES[type] !== true) throw invalid(`auth.type "${type}" is not a supported auth mode`);
	return {
		type,
		apiKey: optionalText(value, "apiKey"),
		envName: optionalText(value, "envName"),
		command: optionalText(value, "command"),
		clearSecret: value.clearSecret === true,
	};
}

interface DiscoveryDraft {
	readonly type: string;
	readonly timeoutMs?: number;
	readonly advertisedReasoning?: boolean;
}

function readDiscoveryDraft(value: unknown): DiscoveryDraft | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw invalid("discovery must be an object or null");
	const timeoutMs = optionalNumber(value, "timeoutMs");
	const advertisedReasoning = optionalBoolean(value, "advertisedReasoning");
	return {
		type: optionalText(value, "type"),
		...(timeoutMs !== undefined ? { timeoutMs } : {}),
		...(advertisedReasoning !== undefined ? { advertisedReasoning } : {}),
	};
}

interface RemoteCompactionDraft {
	readonly enabled?: boolean;
	readonly endpoint: string;
	readonly model: string;
}

function readRemoteCompactionDraft(value: unknown): RemoteCompactionDraft | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw invalid("remoteCompaction must be an object or null");
	const enabled = optionalBoolean(value, "enabled");
	return {
		...(enabled === undefined ? {} : { enabled }),
		endpoint: optionalText(value, "endpoint"),
		model: optionalText(value, "model"),
	};
}

/** The provider's `models.yml` node, derived from one editor payload. */
function providerYamlNode(
	input: ModelProviderUpsertInput,
	previous: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	const id = requiredString(input, "id").trim();
	const name = requiredString(input, "name").trim();
	const api = requiredString(input, "api").trim();
	if (id === "") throw invalid("id must be a non-empty string");

	const auth = readAuthDraft(input.auth);
	const discovery = readDiscoveryDraft(input.discovery);
	const remoteCompaction = readRemoteCompactionDraft(input.remoteCompaction);
	if (input.models !== undefined) {
		for (const model of input.models) {
			if (typeof model.id !== "string" || model.id.trim() === "") {
				throw invalid("models[].id must be a non-empty string");
			}
		}
	}

	const base: Record<string, unknown> = { ...(previous ?? {}) };
	if (auth.clearSecret) delete base.apiKey;

	const draft: ProviderYamlDraft = {
		id,
		name,
		website: optionalString(input, "website") ?? "",
		note: optionalString(input, "note") ?? "",
		api,
		endpointUrl: optionalString(input, "endpointUrl") ?? "",
		local: input.local === true,
		authType: auth.type,
		apiKey: auth.apiKey,
		envName: auth.envName,
		command: auth.command,
		discoveryType: discovery?.type ?? "",
		...(discovery?.advertisedReasoning === undefined ? {} : { advertisedReasoning: discovery.advertisedReasoning }),
		...(discovery?.timeoutMs === undefined ? {} : { discoveryTimeoutMs: discovery.timeoutMs }),
		headersText: headerText(input.headers),
		disableStrictTools: input.disableStrictTools === true,
		transport: input.transport === "pi-native" ? "pi-native" : "",
		remoteCompactionEnabled: remoteCompaction?.enabled === true,
		remoteCompactionEndpoint: remoteCompaction?.endpoint ?? "",
		remoteCompactionModel: remoteCompaction?.model ?? "",
		// Rows are attached below: the draft type only accepts catalog rows, and
		// an editor draft carries plain model inputs.
		models: [],
		modelOverrides: input.modelOverrides ?? {},
	};

	const node = draftProviderYamlNode(draft, base, storedAuthOf(base));

	const previousModels = Array.isArray(previous?.models) ? previous.models : [];
	if (input.models === undefined) {
		if (previousModels.length > 0) node.models = previousModels;
	} else if (input.models.length === 0) {
		delete node.models;
	} else {
		node.models = input.models.map(model => providerModelYamlNode(model, storedModelRow(previousModels, model.id)));
	}
	if (input.modelOverrides === undefined && previous?.modelOverrides !== undefined) {
		node.modelOverrides = previous.modelOverrides;
	}
	return node;
}

/**
 * `models.provider.upsert` handler → `GET /api/models-config` + `PUT /api/models-config`.
 *
 * The provider node comes from the contract's writer, so the saved key set is
 * exactly the node the editor's preview card showed; Zeta's own models schema
 * interprets the fields it defines and ignores the desktop-only ones.
 * Fields the form omits keep the stored value (`models` and
 * `modelOverrides`), a blank string clears its key, and a stored secret the
 * form does not carry is preserved (the client never receives it, so blanking
 * must not delete it). `enabled` is not part of this document: provider
 * enablement lives in the `disabledProviders` setting, written by
 * `models.provider.setEnabled`.
 */
async function upsertProvider(input: CommandInput<"models.provider.upsert">): Promise<ConfigWriteResult> {
	const id = requiredString(input, "id").trim();
	if (id === "") throw invalid("id must be a non-empty string");
	const document = await readProviderDocument();
	requireExpectedHash(input.expectedHash, document.providers);
	const node = providerYamlNode(input, providerNode(document, id));
	const ack = await writeProviderDocument({ ...document.providers, [id]: node });
	const contentHash = hashProviders((await readProviderDocument()).providers);
	if (ack.ignored.includes(id)) {
		return {
			applied: false,
			runtimeEffect: "new-session",
			message: ack.message ?? `Provider ${id} is defined in the hand-written models.yml; edit that file instead.`,
			contentHash,
		};
	}
	return { applied: true, runtimeEffect: "immediate", contentHash };
}

/**
 * `models.provider.delete` handler → `GET /api/models-config` + `PUT /api/models-config`.
 *
 * Only the panel layer is writable: a provider owned by the hand-written
 * `models.yml` is reported as a no-op instead of pretending it was removed.
 */
async function deleteProvider(input: CommandInput<"models.provider.delete">): Promise<ConfigWriteResult> {
	const id = requiredString(input, "id").trim();
	if (id === "") throw invalid("id must be a non-empty string");
	const document = await readProviderDocument();
	requireExpectedHash(input.expectedHash, document.providers);

	const node = providerNode(document, id);
	if (node === undefined) throw invalid(`Provider ${id} is not configured`);
	const origin = stringField(node, "origin");
	if (origin === "user") {
		return {
			applied: false,
			runtimeEffect: "new-session",
			message: `Provider ${id} is defined in the hand-written models.yml; edit that file instead.`,
			contentHash: hashProviders(document.providers),
		};
	}

	const providers: Record<string, unknown> = { ...document.providers };
	delete providers[id];
	await writeProviderDocument(providers);
	return {
		applied: true,
		runtimeEffect: "immediate",
		contentHash: hashProviders((await readProviderDocument()).providers),
	};
}

/**
 * Parse the editor's YAML into the provider map the gateway writes.
 *
 * `models.yml` holds only a `providers` mapping; anything else would be dropped
 * by the provider-document write, so it is rejected instead of silently lost.
 */
function parseModelsYaml(text: string): Record<string, Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = text.trim() === "" ? undefined : YAML.parse(text);
	} catch (error) {
		throw invalid(`models.yml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (parsed === undefined || parsed === null) return {};
	if (!isRecord(parsed)) throw invalid("models.yml must be a mapping with a providers key");
	for (const key of Object.keys(parsed)) {
		if (key !== "providers") throw invalid(`models.yml does not accept the top-level key "${key}"`);
	}
	const providers = parsed.providers;
	if (providers === undefined) return {};
	if (!isRecord(providers)) throw invalid("models.yml providers must be a mapping");
	const out: Record<string, Record<string, unknown>> = {};
	for (const [id, node] of Object.entries(providers)) {
		if (!isRecord(node)) throw invalid(`models.yml providers.${id} must be a mapping`);
		out[id] = { ...node };
	}
	return out;
}

/** A `"********"` placeholder keeps the secret the stored document already has. */
function restoreRedactedApiKey(
	node: Record<string, unknown>,
	previous: Readonly<Record<string, unknown>> | undefined,
): void {
	const value = node.apiKey;
	if (typeof value !== "string" || !/^\*{6,}$/.test(value)) return;
	const stored = previous === undefined ? undefined : stringField(previous, "apiKey");
	if (stored === undefined) delete node.apiKey;
	else node.apiKey = stored;
}

/**
 * `models.yml.write` handler → `GET /api/models-config` + `PUT /api/models-config`.
 *
 * The gateway writes provider objects, not YAML text: the editor text is parsed
 * here and written as the panel layer. `expectedHash` is checked against a
 * SHA-256 of the canonical merged provider document computed by this host, and
 * the write answers the new hash so the caller can keep saving. Redacted
 * `apiKey` placeholders inherit the stored secret. Providers owned by the
 * hand-written file are reported (the gateway ignores them) rather than
 * pretending the whole document was replaced.
 */
async function writeModelsYaml(input: CommandInput<"models.yml.write">): Promise<ConfigWriteResult> {
	const text = optionalString(input, "text");
	if (text === undefined) throw invalid("text must be a string");
	const document = await readProviderDocument();
	requireExpectedHash(input.expectedHash, document.providers);

	const providers = parseModelsYaml(text);
	for (const [id, node] of Object.entries(providers)) {
		restoreRedactedApiKey(node, providerNode(document, id));
	}
	const overlay = input.overlay;
	if (overlay !== undefined) {
		const overlayId = requiredString(overlay, "id").trim();
		if (overlayId === "") throw invalid("overlay.id must be a non-empty string");
		providers[overlayId] = providerYamlNode(overlay, providers[overlayId] ?? providerNode(document, overlayId));
	}

	const ack = await writeProviderDocument(providers);
	const contentHash = hashProviders((await readProviderDocument()).providers);
	if (ack.ignored.length > 0) {
		return {
			applied: false,
			runtimeEffect: "new-session",
			message: ack.message ?? `Ignored ${ack.ignored.join(", ")}: defined in the hand-written models.yml.`,
			contentHash,
		};
	}
	return { applied: true, runtimeEffect: "immediate", contentHash };
}

// ---------------------------------------------------------------------------
// Provider connectivity — `POST /api/models-config/test` and `/discover`
// ---------------------------------------------------------------------------

/**
 * `POST /api/models-config/test` for one saved provider.
 *
 * The gateway route requires a concrete model; a precondition failure
 * (configuration / credentials, signalled by `stage`) becomes an `invalid`
 * error instead of a "test failed" result, because no request was ever made.
 */
async function completeProviderTest(
	providerName: string,
	provider: Record<string, unknown>,
	model: Record<string, unknown>,
): Promise<ModelProviderTestResult> {
	const startedAt = Date.now();
	const reply = await callGateway(MODELS_CONFIG_TEST_ROUTE, {
		method: "POST",
		body: { providerName, provider, model },
	});
	const elapsed = Date.now() - startedAt;
	if (reply.status < 200 || reply.status >= 300) throw gatewayFailure(reply);
	const body = reply.body;
	if (!isRecord(body)) throw unavailable("POST /api/models-config/test returned a non-object answer");

	const detail = stringField(body, "error");
	if (body.ok !== true) {
		if (body.stage !== undefined || detail === undefined) {
			throw invalid(detail ?? "the provider test was rejected");
		}
		return { ok: false, latencyMs: numberField(body, "latencyMs") ?? elapsed, detail: clip(detail) };
	}
	const latencyMs = numberField(body, "latencyMs");
	if (latencyMs === undefined) throw unavailable("POST /api/models-config/test returned no latency");
	const httpStatus = numberField(body, "status");
	const answer = stringField(body, "responseText");
	const text =
		httpStatus === undefined
			? (answer ?? "Connected")
			: `HTTP ${httpStatus}${answer === undefined ? "" : ` · ${answer}`}`;
	return { ok: true, latencyMs, detail: clip(text), ...(httpStatus === undefined ? {} : { httpStatus }) };
}

/**
 * Reachability test through `POST /api/models-config/discover`, used when no
 * model id is available to call (a draft provider, or one configured purely by
 * discovery). An upstream rejection is the probe's answer, not a host failure.
 */
async function reachabilityTest(
	providerName: string,
	provider: Record<string, unknown>,
): Promise<ModelProviderTestResult> {
	const startedAt = Date.now();
	const reply = await callGateway(MODELS_CONFIG_DISCOVER_ROUTE, {
		method: "POST",
		body: { providerName, provider },
	});
	const latencyMs = Date.now() - startedAt;
	if (reply.status >= 200 && reply.status < 300) {
		const body = reply.body;
		const found = isRecord(body) && Array.isArray(body.models) ? body.models.length : 0;
		return {
			ok: true,
			latencyMs,
			detail: found === 0 ? "Reachable; the endpoint advertised no models" : `Reachable; ${found} models advertised`,
		};
	}
	if (reply.status !== 502 && reply.status !== 504) throw gatewayFailure(reply);
	const httpStatus = numberField(reply.body, "status");
	return {
		ok: false,
		latencyMs,
		detail: clip(gatewayErrorText(reply.body)),
		...(httpStatus === undefined ? {} : { httpStatus }),
	};
}

/** One model the provider advertises, for the test route's required model id. */
function advertisedModel(row: unknown): Record<string, unknown> | undefined {
	if (!isRecord(row)) return undefined;
	const id = stringField(row, "id");
	return id === undefined ? undefined : { ...row };
}

/**
 * A model id from `GET /api/models` when the provider's own node declares none
 * (providers populated purely by discovery). A failed listing is not fatal here:
 * the caller falls back to the reachability probe.
 */
async function listedModel(providerId: string): Promise<Record<string, unknown> | undefined> {
	const reply = await callGateway(MODELS_ROUTE);
	if (reply.status < 200 || reply.status >= 300 || !isRecord(reply.body)) return undefined;
	const list = reply.body.modelList;
	if (!Array.isArray(list)) return undefined;
	for (const entry of list) {
		if (stringField(entry, "provider") !== providerId) continue;
		const id = stringField(entry, "id");
		if (id !== undefined) return { id };
	}
	return undefined;
}

/**
 * `models.provider.test` handler → `POST /api/models-config/test`, or
 * `POST /api/models-config/discover` when no model is available to call.
 */
async function testProvider(input: CommandInput<"models.provider.test">): Promise<ModelProviderTestResult> {
	const providerId = optionalString(input, "providerId")?.trim();
	const api = optionalString(input, "api")?.trim();
	const endpointUrl = optionalString(input, "endpointUrl")?.trim();
	const apiKey = optionalString(input, "apiKey");
	const requestedId = providerId !== undefined && providerId !== "" ? providerId : undefined;
	if (requestedId === undefined && (endpointUrl === undefined || endpointUrl === "")) {
		throw invalid("providerId or endpointUrl is required");
	}

	if (requestedId !== undefined) {
		const document = await readProviderDocument();
		const stored = providerNode(document, requestedId);
		if (stored !== undefined) {
			const provider: Record<string, unknown> = { ...stored };
			delete provider.origin;
			if (api !== undefined && api !== "") provider.api = api;
			if (endpointUrl !== undefined && endpointUrl !== "") provider.baseUrl = endpointUrl;
			if (apiKey !== undefined && apiKey !== "") provider.apiKey = apiKey;
			let model: Record<string, unknown> | undefined;
			for (const row of Array.isArray(stored.models) ? stored.models : []) {
				model = advertisedModel(row);
				if (model !== undefined) break;
			}
			model ??= await listedModel(requestedId);
			if (model !== undefined) return completeProviderTest(requestedId, provider, model);
			if (endpointUrl === undefined || endpointUrl === "") {
				throw invalid(
					`Provider ${requestedId} has no model to test; pass endpointUrl to probe the endpoint instead`,
				);
			}
			return reachabilityTest(requestedId, provider);
		}
	}

	const provider: Record<string, unknown> = { baseUrl: endpointUrl };
	provider.api = api !== undefined && api !== "" ? api : "openai-completions";
	if (apiKey !== undefined && apiKey !== "") provider.apiKey = apiKey;
	return reachabilityTest(requestedId ?? "draft", provider);
}

/** Discovery types whose model list sits at the api-derived URL the gateway probes. */
const API_DERIVED_DISCOVERY: Readonly<Record<string, true>> = { "openai-models-list": true };

/** One `ModelDiscoveryModel` from a gateway row; nothing the endpoint did not report. */
function discoveryModel(value: unknown): ModelDiscoveryModel[] {
	if (!isRecord(value)) return [];
	const id = stringField(value, "id");
	if (id === undefined) return [];
	return [{ id, name: stringField(value, "name") ?? id }];
}

/**
 * `models.provider.probe` handler → `POST /api/models-config/discover`.
 *
 * The gateway probe derives the model-list URL and auth header from the wire
 * API; it has no per-discovery-type URLs, so a discovery type that does not use
 * that URL (ollama, llama.cpp, litellm, proxy, …) is refused rather than
 * silently probed against a different endpoint. `timeoutMs` and
 * `advertisedReasoning` are accepted by the contract but not honored by the
 * gateway (fixed 20 s, no reasoning metadata in the answer).
 */
async function probeProvider(input: CommandInput<"models.provider.probe">): Promise<ModelDiscoveryResult> {
	const providerId = requiredString(input, "providerId").trim();
	if (providerId === "") throw invalid("providerId must be a non-empty string");
	const discoveryType = optionalString(input, "discoveryType")?.trim();
	if (discoveryType !== undefined && discoveryType !== "" && API_DERIVED_DISCOVERY[discoveryType] !== true) {
		throw invalid(
			`discovery type "${discoveryType}" is not served by the Zeta gateway; omit discoveryType (or use openai-models-list) to probe the provider's model-list URL`,
		);
	}
	const endpointUrl = optionalString(input, "endpointUrl")?.trim();
	const api = optionalString(input, "api")?.trim();
	const apiKey = optionalString(input, "apiKey");

	const document = await readProviderDocument();
	const stored = providerNode(document, providerId);
	const provider: Record<string, unknown> = { ...(stored ?? {}) };
	delete provider.origin;
	if (endpointUrl !== undefined && endpointUrl !== "") provider.baseUrl = endpointUrl;
	if (api !== undefined && api !== "") provider.api = api;
	if (apiKey !== undefined && apiKey !== "") provider.apiKey = apiKey;
	if (input.headers !== undefined) provider.headers = input.headers;
	if (stringField(provider, "baseUrl") === undefined) {
		throw invalid(`Provider ${providerId} has no endpoint URL; pass endpointUrl`);
	}

	const startedAt = Date.now();
	const reply = await callGateway(MODELS_CONFIG_DISCOVER_ROUTE, {
		method: "POST",
		body: { providerName: providerId, provider },
	});
	const latencyMs = Date.now() - startedAt;
	if (reply.status === 400) throw gatewayFailure(reply);
	if (reply.status >= 200 && reply.status < 300) {
		const body = reply.body;
		if (!isRecord(body) || !Array.isArray(body.models)) {
			throw unavailable("POST /api/models-config/discover did not return a model list");
		}
		const models = body.models.flatMap(discoveryModel);
		const endpoint = stringField(body, "endpoint");
		return {
			ok: true,
			found: models.length,
			usable: models.length,
			models,
			latencyMs,
			detail: clip(
				endpoint === undefined ? `${models.length} models advertised` : `${models.length} models from ${endpoint}`,
			),
		};
	}
	if (reply.status !== 502 && reply.status !== 504) throw gatewayFailure(reply);
	const httpStatus = numberField(reply.body, "status");
	return {
		ok: false,
		found: 0,
		usable: 0,
		models: [],
		latencyMs,
		detail: clip(gatewayErrorText(reply.body)),
		...(httpStatus === undefined ? {} : { httpStatus }),
	};
}

// ---------------------------------------------------------------------------
// Credentials — `POST /api/auth/logout/:provider`
// ---------------------------------------------------------------------------

/**
 * `models.login.logout` handler → `POST /api/auth/logout/:provider`.
 *
 * The gateway soft-deletes every stored credential for the provider and
 * answers `{ok:true}`; a non-2xx answer is surfaced as `unavailable`.
 */
async function logoutProvider(input: CommandInput<"models.login.logout">): Promise<ConfigWriteResult> {
	const providerId = requiredString(input, "providerId").trim();
	if (providerId === "") throw invalid("providerId must be a non-empty string");
	await gatewayJson<unknown>(`/api/auth/logout/${segment(providerId)}`, { method: "POST" });
	return {
		applied: true,
		runtimeEffect: "immediate",
		message: `Sign-out requested for ${providerId}.`,
	};
}

// ---------------------------------------------------------------------------
// Settings-backed model state — `GET|PUT /api/settings`
// ---------------------------------------------------------------------------

/** The settings panel payload, as raw entries. */
async function readSettingEntries(): Promise<ReadonlyArray<Readonly<Record<string, unknown>>>> {
	const body = await gatewayJson<unknown>(SETTINGS_ROUTE);
	if (!isRecord(body) || !Array.isArray(body.settings)) {
		throw unavailable("GET /api/settings did not return a settings list");
	}
	return body.settings.filter(isRecord);
}

/** One setting's effective value; a missing row means the Host cannot read it. */
function settingValue(entries: ReadonlyArray<Readonly<Record<string, unknown>>>, path: string): unknown {
	const entry = entries.find(item => item.path === path);
	if (entry === undefined) throw unavailable(`GET /api/settings does not expose ${path}`);
	return entry.value;
}

/** `PUT /api/settings` one path; the gateway confirms with `{ok:true}`. */
async function putSetting(path: string, value: unknown): Promise<void> {
	const body = await gatewayJson<unknown>(SETTINGS_ROUTE, { method: "PUT", body: { path, value } });
	if (!isRecord(body) || body.ok !== true) {
		throw unavailable(`PUT /api/settings did not apply ${path}`);
	}
}

/**
 * Current values of registered settings (with or without `ui` metadata), keyed
 * by path. `GET /api/settings` is a UI document and omits hidden rows, so a
 * handler that composes state must ask here instead.
 */
async function readSettingValues(paths: readonly string[], cwd?: string): Promise<Readonly<Record<string, unknown>>> {
	const query = paths.map(path => `path=${encodeURIComponent(path)}`).join("&");
	const body = await gatewayJson<unknown>(SETTINGS_VALUES_ROUTE, cwd === undefined ? { query } : { query, cwd });
	if (!isRecord(body) || !isRecord(body.values)) {
		throw unavailable("GET /api/settings/values returned no value map");
	}
	return body.values;
}

/** An array-valued setting; `null` means the gateway does not know the path. */
function stringArraySetting(value: unknown, path: string): string[] {
	if (value === null || value === undefined) {
		throw unavailable(`GET /api/settings/values does not expose ${path}`);
	}
	if (!Array.isArray(value)) throw unavailable(`GET /api/settings/values returned a non-array ${path}`);
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			throw unavailable(`GET /api/settings/values returned a non-string entry in ${path}`);
		}
		out.push(entry);
	}
	return out;
}

/** Validate a whole-list precedence write; a repeated id would make it ambiguous. */
function precedenceOrder(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
	const out: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim() === "") {
			throw invalid(`${field} must contain non-empty strings`);
		}
		const id = entry.trim();
		if (seen.has(id)) throw invalid(`${field} contains "${id}" twice`);
		seen.add(id);
		out.push(id);
	}
	return out;
}

/** A `record<string,string>` setting value, narrowed from untrusted JSON. */
function stringMapSetting(value: unknown, path: string): Record<string, string> {
	if (!isRecord(value)) throw unavailable(`GET /api/settings returned malformed ${path}`);
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") throw unavailable(`GET /api/settings returned a non-string ${path}.${key}`);
		out[key] = entry;
	}
	return out;
}

/**
 * `models.roles.set` handler → `GET /api/settings` + `PUT /api/settings`
 * (`modelRoles`). The whole map is written because that is the only shape the
 * settings route accepts; the read-modify-write keeps every other assignment.
 */
async function setRole(input: CommandInput<"models.roles.set">): Promise<ConfigWriteResult> {
	const roleId = requiredString(input, "roleId").trim();
	if (roleId === "") throw invalid("roleId must be a non-empty string");
	const selector = optionalString(input, "selector");
	if (selector === undefined) throw invalid("selector must be a string");
	const roles = stringMapSetting(settingValue(await readSettingEntries(), "modelRoles"), "modelRoles");
	const next = selector.trim();
	if (next === "") delete roles[roleId];
	else roles[roleId] = next;
	await putSetting("modelRoles", roles);
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: next === "" ? `Cleared the ${roleId} role.` : `Role ${roleId} set to ${next}.`,
	};
}

/**
 * `models.roles.write` handler → `PUT /api/settings` (`modelRoles`).
 *
 * Replaces the whole assignment map; a blank selector removes the role, as the
 * read model documents.
 */
async function writeRoles(input: CommandInput<"models.roles.write">): Promise<ConfigWriteResult> {
	if (!isRecord(input.roles)) throw invalid("roles must be an object");
	const roles: Record<string, string> = {};
	for (const [rawId, selector] of Object.entries(input.roles)) {
		if (typeof selector !== "string") throw invalid(`roles.${rawId} must be a string`);
		const id = rawId.trim();
		if (id === "") throw invalid("role ids must be non-empty");
		if (selector.trim() !== "") roles[id] = selector.trim();
	}
	await putSetting("modelRoles", roles);
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `${Object.keys(roles).length} role assignments written.`,
	};
}

/**
 * `models.fallback.set` handler → `PUT /api/settings` for
 * `retry.fallbackChains` and, when given, `retry.fallbackRevertPolicy`.
 *
 * The gateway has no single-document write for this pair, so the two settings
 * are written in order. A failed second write reports the partial outcome
 * instead of claiming success.
 */
async function setFallback(input: CommandInput<"models.fallback.set">): Promise<ConfigWriteResult> {
	if (!isRecord(input.chains)) throw invalid("chains must be an object");
	const chains: Record<string, string[]> = {};
	for (const [rawKey, selectors] of Object.entries(input.chains)) {
		if (!Array.isArray(selectors)) throw invalid(`chains.${rawKey} must be an array of selectors`);
		const value: string[] = [];
		for (const selector of selectors) {
			if (typeof selector !== "string" || selector.trim() === "") {
				throw invalid(`chains.${rawKey} must contain non-empty selector strings`);
			}
			value.push(selector.trim());
		}
		const key = rawKey.trim();
		if (key === "") throw invalid("fallback chain keys must be non-empty");
		chains[key] = value;
	}
	await putSetting("retry.fallbackChains", chains);

	const revertPolicy = input.revertPolicy;
	if (revertPolicy !== undefined) {
		if (revertPolicy !== "cooldown-expiry" && revertPolicy !== "never") {
			throw invalid("revertPolicy must be cooldown-expiry or never");
		}
		try {
			await putSetting("retry.fallbackRevertPolicy", revertPolicy);
		} catch (error) {
			throw unavailable(
				`Fallback chains were saved but the revert policy was not: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `${Object.keys(chains).length} fallback chains written.`,
	};
}

/**
 * `models.provider.setEnabled` handler → `GET /api/settings/values` +
 * `PUT /api/settings` (`disabledProviders`).
 *
 * The setting is a deny-list: the current array is read first so enabling or
 * disabling one provider never drops another entry. A no-op toggle does not
 * write the file.
 */
async function setProviderEnabled(input: CommandInput<"models.provider.setEnabled">): Promise<ConfigWriteResult> {
	const id = requiredString(input, "id").trim();
	if (id === "") throw invalid("id must be a non-empty string");
	const enabled = input.enabled;
	if (typeof enabled !== "boolean") throw invalid("enabled must be a boolean");
	const values = await readSettingValues(["disabledProviders"]);
	const disabled = stringArraySetting(values.disabledProviders, "disabledProviders");
	const currentlyDisabled = disabled.includes(id);
	const state = enabled ? "enabled" : "disabled";
	if (enabled !== currentlyDisabled) {
		return {
			applied: true,
			runtimeEffect: "immediate",
			message: `Provider ${id} is already ${state}.`,
		};
	}
	const next = enabled ? disabled.filter(provider => provider !== id) : [...disabled, id];
	await putSetting("disabledProviders", next);
	return { applied: true, runtimeEffect: "immediate", message: `Provider ${id} ${state}.` };
}

/**
 * `models.hidden.set` handler → `PUT /api/settings` (`hiddenModels`).
 *
 * Replaces the whole selector list. Hidden models are filtered from pickers
 * and selectors only: the catalog, `modelRoles`, and `retry.fallbackChains`
 * keep resolving them, so a hidden model stays assignable and remains visible
 * in the model-config page.
 */
async function setHiddenModels(input: CommandInput<"models.hidden.set">): Promise<ConfigWriteResult> {
	if (!Array.isArray(input.selectors)) throw invalid("selectors must be an array");
	const selectors: string[] = [];
	const seen = new Set<string>();
	for (const entry of input.selectors) {
		if (typeof entry !== "string" || entry.trim() === "") {
			throw invalid("selectors must contain non-empty strings");
		}
		const selector = entry.trim();
		if (seen.has(selector)) continue;
		seen.add(selector);
		selectors.push(selector);
	}
	await putSetting("hiddenModels", selectors);
	return {
		applied: true,
		runtimeEffect: "immediate",
		message:
			selectors.length === 0
				? "All models are visible in pickers."
				: `${selectors.length} hidden model selectors written.`,
	};
}

/** `models.roles.create` handler → `PUT /api/settings` (`modelTags`, then `modelRoles`). */
async function createRole(input: CommandInput<"models.roles.create">): Promise<ConfigWriteResult> {
	const id = requiredString(input, "id").trim();
	if (id === "") throw invalid("id must be a non-empty string");
	if (MODEL_ROLE_IDS.some(role => role === id)) throw invalid(`${id} is a built-in role`);
	const name = requiredString(input, "name").trim();
	if (name === "") throw invalid("name must be a non-empty string");
	const values = await readSettingValues(["modelTags", "modelRoles"]);
	const tags = isRecord(values.modelTags) ? { ...values.modelTags } : {};
	const roles = isRecord(values.modelRoles) ? { ...values.modelRoles } : {};
	const existing = isRecord(tags[id]) ? tags[id] : undefined;
	const color = optionalString(input, "color")?.trim();
	tags[id] = {
		...(existing ?? {}),
		name,
		...(color ? { color } : {}),
	};
	await putSetting("modelTags", tags);
	const selector = optionalString(input, "selector")?.trim() ?? "";
	if (selector !== "") {
		try {
			roles[id] = selector;
			await putSetting("modelRoles", roles);
		} catch (error) {
			throw unavailable(
				`Role ${id} was created but its model assignment was not saved: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: selector === "" ? `Custom role ${id} created.` : `Custom role ${id} created with ${selector}.`,
	};
}

/** `models.roles.delete` handler → `PUT /api/settings` (`modelTags` + `modelRoles` + chains). */
async function deleteRole(input: CommandInput<"models.roles.delete">): Promise<ConfigWriteResult> {
	const id = requiredString(input, "roleId").trim();
	if (id === "") throw invalid("roleId must be a non-empty string");
	if (MODEL_ROLE_IDS.some(role => role === id)) throw invalid(`${id} is a built-in role`);
	const values = await readSettingValues([
		"modelTags",
		"modelRoles",
		"retry.fallbackChains",
		"task.agentModelOverrides",
	]);
	const tags = isRecord(values.modelTags) ? { ...values.modelTags } : {};
	const roles = isRecord(values.modelRoles) ? { ...values.modelRoles } : {};
	const chains = isRecord(values["retry.fallbackChains"]) ? { ...values["retry.fallbackChains"] } : {};
	const overrides = isRecord(values["task.agentModelOverrides"]) ? values["task.agentModelOverrides"] : {};

	// Never orphan an agent on a deleted purpose role: the agent would silently
	// fall through to default at runtime. The caller must reassign or inherit.
	let agents: AgentDefinition[] = [];
	try {
		agents = (await discoverAgents(getProjectDir())).agents;
	} catch {
		// Discovery is best-effort; the settings overlay still catches configured
		// overrides when the agent roots cannot be scanned.
		agents = [];
	}
	const agentRefs = findAgentRoleReferences(agents, overrides, id);
	const roleRefs = findRoleAssignmentReferences(roles, id).filter(name => name !== id);
	const references = [...agentRefs.map(name => `agent:${name}`), ...roleRefs.map(name => `role:${name}`)];
	if (references.length > 0) {
		throw invalid(
			`Role @${id} is still referenced by ${references.join(", ")}. Reassign those agents or switch them to inherit before deleting.`,
		);
	}

	delete tags[id];
	delete roles[id];
	delete chains[id];
	await putSetting("modelTags", tags);
	await putSetting("modelRoles", roles);
	await putSetting("retry.fallbackChains", chains);
	return { applied: true, runtimeEffect: "new-session", message: `Custom role ${id} deleted.` };
}

/** `models.roleStorage.set` handler → `PUT /api/settings` (`modelRoleStorage`). */
async function setRoleStorage(input: CommandInput<"models.roleStorage.set">): Promise<ConfigWriteResult> {
	const storage = input.storage;
	if (storage !== "global" && storage !== "project") throw invalid("storage must be global or project");
	await putSetting("modelRoleStorage", storage);
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `Role assignments now save to ${storage}.`,
	};
}

/** `models.providerOrder.set` handler → `PUT /api/settings` (`modelProviderOrder`). */
async function setProviderOrder(input: CommandInput<"models.providerOrder.set">): Promise<ConfigWriteResult> {
	const order = precedenceOrder(input.order, "order");
	await putSetting("modelProviderOrder", order);
	return {
		applied: true,
		runtimeEffect: "new-session",
		message: `${order.length} providers ranked for ambiguous model ids.`,
	};
}

/** `models.cycleOrder.set` handler → `PUT /api/settings` (`cycleOrder`). */
async function setCycleOrder(input: CommandInput<"models.cycleOrder.set">): Promise<ConfigWriteResult> {
	const order = precedenceOrder(input.order, "order");
	await putSetting("cycleOrder", order);
	return { applied: true, runtimeEffect: "new-session", message: `${order.length} rotation roles written.` };
}

// ---------------------------------------------------------------------------
// `models.get` — the model-config page read model
// ---------------------------------------------------------------------------

/** Built-in role metadata indexed by the contract's string role ids. */
const BUILTIN_ROLE_INFO: Readonly<Record<string, { readonly name: string }>> = MODEL_ROLES;

/** Thinking suffixes accepted on a role's primary selector. */
const ROLE_THINKING_SUFFIXES: Record<string, true> = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
	auto: true,
	inherit: true,
};

/** Split a configured role value into its primary selector and thinking suffix. */
function splitRoleValue(value: string): { primary: string; thinking?: string } {
	const trimmed = value.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon <= 0) return { primary: trimmed };
	const suffix = trimmed.slice(colon + 1);
	if (ROLE_THINKING_SUFFIXES[suffix] !== true) return { primary: trimmed };
	return { primary: trimmed.slice(0, colon), thinking: suffix };
}

/** String array from an untrusted setting or gateway field. */
function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** Finite number from an untrusted setting or gateway field. */
function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Untrusted `retry.fallbackChains` mapping with malformed rows dropped. */
function fallbackChainsValue(value: unknown): Record<string, string[]> {
	if (!isRecord(value)) return {};
	const chains: Record<string, string[]> = {};
	for (const [key, chain] of Object.entries(value)) {
		if (!Array.isArray(chain)) continue;
		chains[key] = stringList(chain);
	}
	return chains;
}

/** One `/api/models` row as the gateway's ModelsData emits it. */
interface GatewayModelRow {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly kind?: string;
	readonly reasoning?: boolean;
	readonly image?: boolean;
	readonly tools?: boolean;
	readonly api?: string;
	readonly webSearch?: string;
	readonly thinking?: string[];
}

function readGatewayModels(body: unknown): GatewayModelRow[] {
	if (!isRecord(body) || !Array.isArray(body.modelList)) return [];
	const rows: GatewayModelRow[] = [];
	const seen = new Set<string>();
	for (const entry of body.modelList) {
		if (!isRecord(entry)) continue;
		const provider = stringField(entry, "provider");
		const id = stringField(entry, "id");
		if (!provider || !id) continue;
		const selector = `${provider}/${id}`;
		if (seen.has(selector)) continue;
		seen.add(selector);
		rows.push({
			provider,
			id,
			name: stringField(entry, "name") ?? id,
			...(numberField(entry, "contextWindow") === undefined
				? {}
				: { contextWindow: numberField(entry, "contextWindow") }),
			...(numberField(entry, "maxTokens") === undefined ? {} : { maxTokens: numberField(entry, "maxTokens") }),
			...(stringField(entry, "kind") === undefined ? {} : { kind: stringField(entry, "kind") }),
			...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
			...(typeof entry.image === "boolean" ? { image: entry.image } : {}),
			...(typeof entry.tools === "boolean" ? { tools: entry.tools } : {}),
			...(stringField(entry, "api") === undefined ? {} : { api: stringField(entry, "api") }),
			...(stringField(entry, "webSearch") === undefined ? {} : { webSearch: stringField(entry, "webSearch") }),
			...(Array.isArray(entry.thinking) ? { thinking: stringList(entry.thinking) } : {}),
		});
	}
	return rows;
}

function availableModel(row: GatewayModelRow): AvailableModelRecord {
	const kind = parseModelKind(row.kind);
	return {
		provider: row.provider,
		id: row.id,
		selector: `${row.provider}/${row.id}`,
		name: row.name,
		reasoning: row.reasoning === true,
		...(kind === undefined ? {} : { kind }),
		...(row.image === undefined ? {} : { image: row.image }),
		...(row.tools === undefined ? {} : { tools: row.tools }),
		...(row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow }),
		...(row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens }),
		...(row.api === undefined ? {} : { api: row.api }),
		...(row.webSearch === undefined ? {} : { webSearch: row.webSearch }),
		...(row.thinking === undefined || row.thinking.length === 0 ? {} : { thinking: row.thinking }),
	};
}

function catalogEntry(row: GatewayModelRow): ModelCatalogEntry {
	return {
		...availableModel(row),
		image: row.image === true,
		tools: row.tools !== false,
		status: "available",
		source: "catalog",
	};
}

/** Redact credential values before a provider document reaches the Renderer. */
function redactedProviderNode(node: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const copy: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		if (key === "origin") continue;
		if (key === "apiKey" && typeof value === "string" && value !== "") {
			copy[key] = "********";
			continue;
		}
		copy[key] = value;
	}
	return copy;
}

/** One provider row from the merged models document and its available models. */
function providerRecord(
	id: string,
	node: Readonly<Record<string, unknown>> | undefined,
	models: readonly GatewayModelRow[],
	disabledProviders: readonly string[],
): ModelProviderRecord {
	const apiKey = node ? stringField(node, "apiKey") : undefined;
	const envName = apiKey && isModelEnvConfigName(apiKey) ? apiKey : undefined;
	const disabled = disabledProviders.includes(id);
	const status: ModelProviderRecord["status"] =
		models.length > 0 ? "available" : disabled ? "disabled" : "not-authenticated";
	return {
		id,
		name: (node && stringField(node, "name")) ?? id,
		source: node ? "custom" : "runtime",
		status,
		statusDetail: "",
		api: (node && stringField(node, "api")) ?? "openai-completions",
		...(node && (stringField(node, "baseUrl") ?? stringField(node, "endpoint"))
			? { endpointUrl: stringField(node, "baseUrl") ?? stringField(node, "endpoint") }
			: {}),
		local: node?.local === true,
		enabled: !disabled,
		auth: apiKey
			? { type: envName ? "env" : "api-key", hasSecret: true, ...(envName ? { envName } : {}) }
			: { type: "none", hasSecret: false },
		models: models.map(catalogEntry),
	};
}

/** Build `models.get` from the gateway's model listing, filter limits, and settings. */
async function getModelConfig(input: QueryInput<"models.get">): Promise<ModelConfigReadModel> {
	const cwd = await resolveWorkspaceCwd(input.workspaceId);
	const settings = await readSettingValues(
		[
			"modelRoles",
			"modelTags",
			"cycleOrder",
			"modelProviderOrder",
			"retry.fallbackChains",
			"retry.fallbackRevertPolicy",
			"modelRoleStorage",
			"hiddenModels",
			"disabledProviders",
			"web_search.enabled",
			"providers.webSearchOrder",
			"providers.webSearchExclude",
			"providers.webSearchTimeoutSeconds",
			"providers.webSearchGeminiModel",
			"searxng.endpoint",
			"searxng.basicUsername",
			"searxng.categories",
			"searxng.engines",
			"searxng.language",
			"searxng.safesearch",
			"exa.enabled",
			"exa.searchDelayMs",
		],
		cwd,
	);
	const [modelBody, configBody] = await Promise.all([
		gatewayJson<unknown>(MODELS_ROUTE, cwd === undefined ? {} : { cwd }),
		gatewayJson<unknown>(MODELS_CONFIG_ROUTE, cwd === undefined ? {} : { cwd }),
	]);
	const modelRows = readGatewayModels(modelBody);
	const configuredProviders = isRecord(configBody) && isRecord(configBody.providers) ? configBody.providers : {};
	const disabledProviders = stringList(settings.disabledProviders);

	const providerIds = new Set<string>([...Object.keys(configuredProviders), ...modelRows.map(row => row.provider)]);
	const providers = [...providerIds].sort().map(id => {
		const node = isRecord(configuredProviders[id]) ? configuredProviders[id] : undefined;
		return providerRecord(
			id,
			node,
			modelRows.filter(row => row.provider === id),
			disabledProviders,
		);
	});

	const configuredRoles = isRecord(settings.modelRoles) ? settings.modelRoles : {};
	const configuredTags = isRecord(settings.modelTags) ? settings.modelTags : {};
	const storage = settings.modelRoleStorage === "project" ? "project" : "global";
	const roleIds = new Set<string>([
		...MODEL_ROLE_IDS,
		...Object.keys(configuredRoles),
		...Object.keys(configuredTags),
		...stringList(settings.cycleOrder),
	]);
	const roles: ModelRoleRecord[] = [...roleIds].map(id => {
		const raw = typeof configuredRoles[id] === "string" ? configuredRoles[id] : "";
		const { primary, thinking } = splitRoleValue(raw);
		const tag = isRecord(configuredTags[id]) ? configuredTags[id] : undefined;
		const builtin = MODEL_ROLE_IDS.some(role => role === id);
		return {
			id,
			alias: `@${id}`,
			name: (tag && stringField(tag, "name")) ?? BUILTIN_ROLE_INFO[id]?.name ?? id,
			desc: "",
			builtin,
			primary,
			...(thinking === undefined ? {} : { thinking }),
			scope: storage,
		};
	});

	const webSearchEnabled = settings["web_search.enabled"] === true;
	const searxng: {
		endpoint?: string;
		basicUsername?: string;
		categories?: string;
		engines?: string;
		language?: string;
		safesearch?: number;
	} = {};
	const endpoint = settings["searxng.endpoint"];
	if (typeof endpoint === "string" && endpoint !== "") searxng.endpoint = endpoint;
	const basicUsername = settings["searxng.basicUsername"];
	if (typeof basicUsername === "string" && basicUsername !== "") searxng.basicUsername = basicUsername;
	const categories = settings["searxng.categories"];
	if (typeof categories === "string" && categories !== "") searxng.categories = categories;
	const engines = settings["searxng.engines"];
	if (typeof engines === "string" && engines !== "") searxng.engines = engines;
	const language = settings["searxng.language"];
	if (typeof language === "string" && language !== "") searxng.language = language;
	const safeSearch = numberValue(settings["searxng.safesearch"]);
	if (safeSearch !== undefined) searxng.safesearch = safeSearch;
	const exa: { enabled?: boolean; searchDelayMs?: number } = {};
	const exaEnabled = settings["exa.enabled"];
	if (typeof exaEnabled === "boolean") exa.enabled = exaEnabled;
	const exaDelay = numberValue(settings["exa.searchDelayMs"]);
	if (exaDelay !== undefined) exa.searchDelayMs = exaDelay;
	const webSearch: WebSearchConfigReadModel = {
		enabled: webSearchEnabled,
		order: stringList(settings["providers.webSearchOrder"]),
		exclude: stringList(settings["providers.webSearchExclude"]),
		timeoutSeconds: numberValue(settings["providers.webSearchTimeoutSeconds"]) ?? 60,
		geminiModel:
			typeof settings["providers.webSearchGeminiModel"] === "string"
				? settings["providers.webSearchGeminiModel"]
				: "",
		providers: [],
		advanced: {
			...(Object.keys(searxng).length > 0 ? { searxng } : {}),
			...(Object.keys(exa).length > 0 ? { exa } : {}),
		},
	};

	const providersYaml: Record<string, unknown> = {};
	for (const [id, node] of Object.entries(configuredProviders)) {
		if (isRecord(node)) providersYaml[id] = redactedProviderNode(node);
	}

	return {
		providers,
		presets: [],
		roles,
		cycleOrder: stringList(settings.cycleOrder),
		availableModels: modelRows.map(availableModel),
		hiddenModels: stringList(settings.hiddenModels),
		loginProviders: [],
		generatedModelsYml: YAML.stringify({ providers: providersYaml }),
		generatedConfigYml: YAML.stringify({ modelRoles: configuredRoles }),
		runtimeEffectHint:
			"Model role changes apply to new sessions; visibility and provider switches apply immediately.",
		loginAvailable: false,
		ompAvailable: true,
		modelRoleStorage: storage,
		projectScopeAvailable: true,
		modelProviderOrder: stringList(settings.modelProviderOrder),
		fallbackChains: fallbackChainsValue(settings["retry.fallbackChains"]),
		fallbackRevertPolicy: settings["retry.fallbackRevertPolicy"] === "never" ? "never" : "cooldown-expiry",
		webSearch,
	};
}

/**
 * Models family: provider file and YAML writes, connectivity tests, roles,
 * fallback chains, provider enablement and precedence order, logout.
 */
export const modelsOps: StudioFamily = {
	id: "models",
	queries: {
		"models.get": getModelConfig,
	},
	commands: {
		"models.provider.upsert": upsertProvider,
		"models.provider.delete": deleteProvider,
		"models.provider.setEnabled": setProviderEnabled,
		"models.hidden.set": setHiddenModels,
		"models.provider.test": testProvider,
		"models.provider.probe": probeProvider,
		"models.providerOrder.set": setProviderOrder,
		"models.cycleOrder.set": setCycleOrder,
		"models.login.logout": logoutProvider,
		"models.roles.set": setRole,
		"models.roles.write": writeRoles,
		"models.roles.create": createRole,
		"models.roles.delete": deleteRole,
		"models.roleStorage.set": setRoleStorage,
		"models.fallback.set": setFallback,
		"models.yml.write": writeModelsYaml,
	},
};
