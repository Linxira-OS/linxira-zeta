/**
 * Studio operations — environment facts and the tool-approval mode.
 *
 * Owned operations and their Zeta source:
 * - `environment.get` → host facts: the authority/version/runtime blocks come
 *   from the same builder `/api/v1/bootstrap` answers with (`serveIdentity()`
 *   underneath), platform/arch from the running process. `GET /api/settings`
 *   carries no environment field today (spec: "partial today"), so this read
 *   makes no gateway call rather than inventing one; it returns no path and no
 *   pid.
 * - `permissions.mode.set` → `GET /api/settings` (which modes the schema
 *   advertises for `tools.approvalMode`) then `PUT /api/settings`
 *   `{ path, value }`.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`,
 * `gatewayJson`, `gatewayOk`, `invalid`, `unavailable`). A name this file does
 * not export is simply not advertised in the capability manifest, so leaving
 * an operation out hides its surface in the Renderer — never answer with made
 * up data.
 */
import { isRecord, stringProperty } from "@linxiraos/pi-utils";
import type {
	ArchId,
	ClientBootstrap,
	CommandInput,
	CommandResult,
	EnvironmentReadModel,
	OperatorStateSnapshot,
	PlatformId,
	RuntimeInstallState,
	StudioRuntimeSettingsGetResult,
	StudioRuntimeSettingsSetResult,
} from "../contract/index.js";
import { gatewayJson, invalid, requiredString, unavailable } from "../gateway.js";
import type { ApprovalMode } from "../protocol/index.js";
import type { StudioFamily } from "../registry.js";

/** The setting behind the Renderer's approval-mode picker (Zeta's own YOLO default). */
const APPROVAL_MODE_PATH = "tools.approvalMode";
const SETTINGS_ROUTE = "/api/settings";

/** `runtime.settings.get` → the gateway settings panel, projected to key/value. */
async function readRuntimeSettings(input: {
	readonly keys?: readonly string[];
}): Promise<StudioRuntimeSettingsGetResult> {
	const panel = indexSettingsPanel(await gatewayJson<unknown>(SETTINGS_ROUTE));
	const wanted = input.keys === undefined ? undefined : new Set(input.keys);
	const values: Record<string, unknown> = {};
	for (const [key, entry] of panel) {
		if (wanted === undefined || wanted.has(key)) values[key] = entry["value"];
	}
	return { values: values as StudioRuntimeSettingsGetResult["values"] };
}

/** `approvals.forget` → the existing per-agent approval cache. */
async function forgetApprovals(): Promise<{ snapshot: OperatorStateSnapshot; result: { cleared: true } }> {
	// Lazy: approval-cache and the session family pull the tool/session graph,
	// which must not run while the host family registry is still assembling.
	const { clearApprovalGrants } = await import("../../../tools/approval-cache.js");
	clearApprovalGrants();
	const { sessionOps } = await import("./session.js");
	const readSnapshot = sessionOps.queries?.["session.state"] as
		| ((input: unknown, context: unknown) => Promise<OperatorStateSnapshot>)
		| undefined;
	if (readSnapshot === undefined) throw unavailable("session.state is not available");
	return { snapshot: await readSnapshot({}, {}), result: { cleared: true } };
}

/** `runtime.settings.set` → the same isolated settings writer the CLI uses. */
async function writeRuntimeSetting(
	input: CommandInput<"runtime.settings.set">,
): Promise<StudioRuntimeSettingsSetResult> {
	const key = requiredString(input, "key");
	const written = await gatewayJson<unknown>(SETTINGS_ROUTE, {
		method: "PUT",
		body: { path: key, value: input.value },
	});
	const effective = isRecord(written) ? written["value"] : undefined;
	return {
		key: key as StudioRuntimeSettingsSetResult["key"],
		value: input.value,
		persisted: true,
		...(effective === undefined
			? {}
			: { effectiveValue: effective as StudioRuntimeSettingsSetResult["effectiveValue"] }),
	};
}

/** Contract approval modes → membership lookup for untrusted gateway strings. */
const APPROVAL_MODES: Record<string, ApprovalMode> = {
	"always-ask": "always-ask",
	"always-ask-cached": "always-ask-cached",
	write: "write",
	yolo: "yolo",
};

function isApprovalMode(value: string): value is ApprovalMode {
	return Object.prototype.hasOwnProperty.call(APPROVAL_MODES, value);
}

/** The settings panel payload, indexed by setting path. */
type SettingsPanel = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

/**
 * Index the `GET /api/settings` panel payload (`{ settings: [{ path, value,
 * … }] }`) by setting path, so a handler reads one row instead of scanning the
 * whole panel list.
 */
function indexSettingsPanel(payload: unknown): SettingsPanel {
	if (!isRecord(payload)) throw unavailable("GET /api/settings did not answer with a settings object");
	const rawEntries = payload["settings"];
	if (!Array.isArray(rawEntries)) throw unavailable("GET /api/settings did not answer with a settings list");
	const entries: readonly unknown[] = rawEntries;
	const index = new Map<string, Readonly<Record<string, unknown>>>();
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		const path = stringProperty(entry, "path");
		if (path !== undefined) index.set(path, entry);
	}
	return index;
}

/**
 * The values the panel advertises for one row. `web-gateway/settings.ts`
 * carries them as `values` for option-less enums and as `options[].value` when
 * the schema attaches labels — `tools.approvalMode` is the labelled form.
 */
function advertisedValues(entry: Readonly<Record<string, unknown>>): readonly string[] {
	const values: string[] = [];
	const rawValues: unknown = entry["values"];
	if (Array.isArray(rawValues)) {
		const listed: readonly unknown[] = rawValues;
		for (const value of listed) {
			if (typeof value === "string") values.push(value);
		}
	}
	const rawOptions: unknown = entry["options"];
	if (Array.isArray(rawOptions)) {
		const options: readonly unknown[] = rawOptions;
		for (const option of options) {
			if (!isRecord(option)) continue;
			const value = stringProperty(option, "value");
			if (value !== undefined) values.push(value);
		}
	}
	return values;
}

/** Platform family of this process; anything the contract cannot name is a host fact we must not bend. */
function platformId(): PlatformId {
	const platform = process.platform;
	if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
	throw unavailable(`Zeta runs on ${platform}, which the Studio contract cannot represent`);
}

/** CPU architecture of this process; same rule as {@link platformId}. */
function archId(): ArchId {
	const arch = process.arch;
	if (arch === "x64" || arch === "arm64") return arch;
	throw unavailable(`Zeta runs on ${arch}, which the Studio contract cannot represent`);
}

/**
 * Zeta is its own `compatible-system` runtime: there is no managed runtime
 * artifact, and every `runtime.*` operation (install, ensure, pause, resume) is
 * outside this host's capability set. "not-installed" is the installer's word
 * for "no managed artifact present", so the signature stays `unknown` — the
 * environment page never claims a signed install Zeta did not verify.
 */
const NO_MANAGED_RUNTIME: RuntimeInstallState = { status: "not-installed", signature: "unknown" };

let mountPayload: Promise<ClientBootstrap> | undefined;

/**
 * Authority and runtime blocks, taken from the builder `GET /api/v1/bootstrap`
 * serves so the environment page and the mount payload cannot drift. Memoised:
 * both blocks are fixed for the life of the process, while the builder hashes
 * the operation set on the way. Imported lazily because `registry.ts` merges the
 * families that include this file.
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

/**
 * `environment.get` → host facts only: process platform/arch, plus the
 * authority and runtime blocks `/api/v1/bootstrap` reports. The settings panel
 * payload carries none of these fields, so this read makes no gateway call and
 * never exposes a path or pid.
 */
async function readEnvironment(): Promise<EnvironmentReadModel> {
	const mount = await hostMountPayload();
	return {
		platform: platformId(),
		arch: archId(),
		authority: mount.authority,
		runtime: mount.runtime,
		installer: NO_MANAGED_RUNTIME,
	};
}

/**
 * `permissions.mode.set` → `GET /api/settings` for the modes the schema
 * advertises for `tools.approvalMode`, then `PUT /api/settings`
 * `{ path, value }` to persist the requested mode unchanged (no confirmation
 * layer: Zeta's own default is YOLO). An input outside the advertised values is
 * `invalid`; a rejected write is `unavailable` carrying the gateway's sentence.
 */
async function setApprovalMode(
	input: CommandInput<"permissions.mode.set">,
): Promise<CommandResult<"permissions.mode.set">> {
	const requested = requiredString(input, "mode");
	if (!isApprovalMode(requested)) {
		throw invalid(`mode must be one of ${Object.keys(APPROVAL_MODES).join(", ")}`);
	}
	const panel = indexSettingsPanel(await gatewayJson<unknown>("/api/settings"));
	const entry = panel.get(APPROVAL_MODE_PATH);
	if (entry === undefined) {
		throw unavailable(`GET /api/settings does not list ${APPROVAL_MODE_PATH}`);
	}
	const advertised = advertisedValues(entry);
	if (advertised.length === 0) {
		throw unavailable(`GET /api/settings lists no values for ${APPROVAL_MODE_PATH}`);
	}
	if (!advertised.includes(requested)) {
		throw invalid(`${APPROVAL_MODE_PATH} accepts ${advertised.join(", ")}, not ${requested}`);
	}
	const written = await gatewayJson<unknown>("/api/settings", {
		method: "PUT",
		body: { path: APPROVAL_MODE_PATH, value: requested },
	});
	const effective = isRecord(written) ? stringProperty(written, "value") : undefined;
	if (effective === undefined || !isApprovalMode(effective)) {
		throw unavailable(`PUT /api/settings answered without an effective ${APPROVAL_MODE_PATH} value`);
	}
	// A project or env layer can shadow the global write (the gateway echoes the
	// layer in `overriddenBy`); reporting the requested mode would be a lie.
	if (effective !== requested) {
		const override = isRecord(written) ? stringProperty(written, "overriddenBy") : undefined;
		const suffix = override === undefined ? "" : ` (overridden by ${override})`;
		throw unavailable(`${APPROVAL_MODE_PATH} is ${effective} after writing ${requested}${suffix}`);
	}
	// Zeta holds one approval mode in the process-global settings store and every
	// live session reads it on its next approval decision: there is no
	// per-session fan-out, so no session was applied individually and none failed.
	return { mode: effective, syncStatus: "complete", appliedSessions: 0, failedSessions: 0 };
}

/** Studio family for the environment page and the approval-mode picker. */
export const settingsOps: StudioFamily = {
	id: "settings",
	queries: {
		"environment.get": readEnvironment,
	},
	commands: {
		"permissions.mode.set": setApprovalMode,
		"runtime.settings.get": readRuntimeSettings,
		"runtime.settings.set": writeRuntimeSetting,
		"approvals.forget": forgetApprovals,
	},
};
