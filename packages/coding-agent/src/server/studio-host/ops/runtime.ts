/**
 * Studio operations — the Runtime connection probe and the diagnostics page.
 *
 * Owned operations: `runtime.ensure`, `diagnostics.get`.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`, `gatewayJson`,
 * `invalid`) plus the host's own bootstrap builder. A name this file does not
 * export is not advertised in the capability manifest, so leaving an operation
 * out hides its surface in the Renderer — never answer with made up data.
 *
 * Operation → Zeta source:
 * - `runtime.ensure` → `GET /api/server/identity` (the gateway's own "is this
 *   port a Zeta serve" probe) and the authority/runtime blocks
 *   `buildBootstrap()` assembles. Zeta's Runtime is the serve process itself:
 *   there is no child to stop or launch, so a successful probe *is* the
 *   `connected` answer and needs no second round-trip. `force` is refused
 *   rather than half-done: `/api/server/restart` would kill the process that
 *   still owes the command receipt.
 * - `diagnostics.get` → the scan diagnostics `GET /api/skills` and
 *   `GET /api/plugins` already report, plus an identity-probe failure when the
 *   gateway cannot answer for itself. Entries are path-free by construction:
 *   a sentence carrying an absolute path is dropped instead of leaked.
 */
import { createHash } from "node:crypto";
import { getProjectDir, isRecord } from "@linxiraos/pi-utils";
import { SERVE_IDENTITY_APP } from "../../web-gateway/identity.js";
import type {
	ClientBootstrap,
	DiagnosticEntry,
	DiagnosticLevel,
	DiagnosticReadModel,
	DiagnosticScope,
	RuntimeConnection,
} from "../contract/index.js";
import { callGateway, invalid, segment } from "../gateway.js";
import type { StudioFamily } from "../registry.js";

const SKILLS_ROUTE = "/api/skills";
const PLUGINS_ROUTE = "/api/plugins";

/**
 * A diagnostic sentence that must not carry an absolute path (Windows drive or
 * UNC, POSIX root). Path-carrying notes are dropped rather than leaked.
 */
const ABSOLUTE_PATH_RE = /(?:^|[\s("'`=:,])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`()]*/;

const DIAGNOSTIC_LEVELS: Readonly<Record<string, DiagnosticLevel>> = {
	error: "error",
	warning: "warning",
	info: "info",
};

/** One scan diagnostic as the gateway reported it. */
interface RawDiagnostic {
	readonly type: string;
	readonly message: string;
	readonly source?: string;
}

let mountPayload: Promise<ClientBootstrap> | undefined;

/**
 * Authority block, taken from the same builder `/api/v1/bootstrap` serves so
 * the diagnostics page and the mount payload cannot drift.
 *
 * Imported lazily: `registry.ts` merges the family list that includes this
 * file, so a static import would close the module cycle.
 */
function hostMountPayload(): Promise<ClientBootstrap> {
	mountPayload ??= (async () => {
		const [{ buildBootstrap }, { StudioOperations }] = await Promise.all([
			import("../bootstrap.js"),
			import("../registry.js"),
		]);
		return buildBootstrap(new StudioOperations());
	})();
	return mountPayload;
}

/** A non-empty string field, or `undefined`. */
function stringField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** Keep a diagnostic sentence only when it is path-free. */
function pathFreeMessage(message: string): string | undefined {
	const trimmed = message.trim();
	if (trimmed === "" || ABSOLUTE_PATH_RE.test(trimmed)) return undefined;
	return trimmed;
}

/** Read the `diagnostics` array of a skills/plugins answer. */
function readScanDiagnostics(payload: unknown): RawDiagnostic[] {
	if (!isRecord(payload)) return [];
	const raw = payload["diagnostics"];
	if (!Array.isArray(raw)) return [];
	const out: RawDiagnostic[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const message = stringField(entry, "message");
		if (message === undefined) continue;
		const source = stringField(entry, "source");
		out.push({ type: stringField(entry, "type") ?? "info", message, ...(source === undefined ? {} : { source }) });
	}
	return out;
}

/** Stable, opaque entry id: the same sentence keeps the same identity across reads. */
function entryIdOf(scope: DiagnosticScope, diagnostic: RawDiagnostic): DiagnosticEntry["entryId"] {
	const digest = createHash("sha256")
		.update(`${scope}\u0000${diagnostic.source ?? ""}\u0000${diagnostic.type}\u0000${diagnostic.message}`)
		.digest("hex");
	return `diag-${digest.slice(0, 16)}` as DiagnosticEntry["entryId"];
}

/** Project one scan diagnostic, dropping path-carrying sentences. */
function toEntry(scope: DiagnosticScope, diagnostic: RawDiagnostic): DiagnosticEntry | undefined {
	const message = pathFreeMessage(diagnostic.message);
	if (message === undefined) return undefined;
	const level = DIAGNOSTIC_LEVELS[diagnostic.type] ?? "info";
	return {
		entryId: entryIdOf(scope, diagnostic),
		scope,
		level,
		message,
		...(diagnostic.source === undefined ? {} : { detail: { source: diagnostic.source } }),
		occurredAt: new Date().toISOString(),
	};
}

/** Scan diagnostics of one inventory route; a failed scan becomes one entry. */
async function scanEntries(route: string): Promise<DiagnosticEntry[]> {
	const reply = await callGateway(route, { query: `cwd=${segment(getProjectDir())}` });
	if (reply.status < 200 || reply.status >= 300) {
		const message = `GET ${route} → ${reply.status}`;
		return [
			{
				entryId: entryIdOf("host", { type: "error", message }),
				scope: "host",
				level: "error",
				message,
				occurredAt: new Date().toISOString(),
			},
		];
	}
	const entries: DiagnosticEntry[] = [];
	for (const diagnostic of readScanDiagnostics(reply.body)) {
		const entry = toEntry("host", diagnostic);
		if (entry !== undefined) entries.push(entry);
	}
	return entries;
}

/**
 * `diagnostics.get` → configured-resource scan notes plus the host's own
 * ability to answer for itself.
 *
 * The page only counts `warning`/`error`, so an empty list is a truthful "no
 * problems reported" rather than a placeholder: nothing is synthesized to fill
 * the page.
 */
async function readDiagnostics(): Promise<DiagnosticReadModel> {
	const [mount, identity, skills, plugins] = await Promise.all([
		hostMountPayload(),
		callGateway("/api/server/identity"),
		scanEntries(SKILLS_ROUTE),
		scanEntries(PLUGINS_ROUTE),
	]);
	const entries: DiagnosticEntry[] = [];
	const identified = identity.status === 200 && isRecord(identity.body) && identity.body["app"] === SERVE_IDENTITY_APP;
	if (!identified) {
		const message = `the Zeta gateway did not answer its identity probe (HTTP ${identity.status})`;
		entries.push({
			entryId: entryIdOf("host", { type: "error", message }),
			scope: "host",
			level: "error",
			message,
			occurredAt: new Date().toISOString(),
		});
	}
	entries.push(...skills, ...plugins);
	return {
		generatedAt: new Date().toISOString(),
		authority: mount.authority,
		entries,
		redacted: true,
	};
}

/**
 * `runtime.ensure` → the public connection facts for this serve process.
 *
 * Zeta is its own `compatible-system` runtime, in-process with this host: there
 * is nothing to launch, so the probe result is the answer. `force` would mean
 * stopping the process that is writing the receipt, so it is refused instead of
 * reported as a restart that never happened.
 */
async function ensureRuntime(input: { readonly force?: boolean }): Promise<RuntimeConnection> {
	const force = isRecord(input) ? input["force"] : undefined;
	if (force !== undefined && typeof force !== "boolean") throw invalid("force must be a boolean");
	if (force === true) {
		throw invalid("runtime.ensure cannot restart the in-process Zeta runtime; use the CLI or desktop restart");
	}

	const reply = await callGateway("/api/server/identity");
	const identity = isRecord(reply.body) ? reply.body : undefined;
	if (reply.status !== 200 || identity === undefined || identity["app"] !== SERVE_IDENTITY_APP) {
		return {
			status: "unavailable",
			classification: "unavailable",
			unavailableCode: "not-wired",
			unavailableReason: `the Zeta gateway did not answer its identity probe (HTTP ${reply.status})`,
		};
	}
	const version = stringField(identity, "version");
	const mount = await hostMountPayload();
	return {
		...mount.runtime,
		status: "connected",
		...(version === undefined ? {} : { runtimeVersion: version }),
	};
}

/** Runtime family: the reconnect probe and the diagnostics page read. */
export const runtimeOps: StudioFamily = {
	id: "runtime",
	queries: {
		"diagnostics.get": readDiagnostics,
	},
	commands: {
		"runtime.ensure": ensureRuntime,
	},
};
