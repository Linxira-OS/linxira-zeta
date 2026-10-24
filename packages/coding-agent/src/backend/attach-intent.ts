/**
 * Startup decision: should this interactive/TUI launch attach to a running
 * `zetacode serve` backend, and to which session?
 *
 * Two modes, deliberately explicit:
 *   bare `zetacode`              pure local TUI (no backend involvement)
 *   --attach [--backend-url U]   attach to a backend; a missing/ambiguous
 *                                backend is a startup error, never a silent
 *                                switch to an in-process session
 *   --attach-session <id>        attach to that exact session
 *   --attach-new                 attach and create a fresh session
 *   --backend                    force backend mode for an interactive launch
 *                                (print mode already means this)
 *
 * Multiple live backends are common once operators run independent port sets.
 * Discovery therefore returns every healthy instance; attach refuses to guess
 * and asks for `--backend-url` unless a session id selects exactly one.
 */

import { VERSION } from "@linxiraos/pi-utils";
import type { Args } from "../cli/args";
import { listServeRegistrations, serveRegistryPath } from "../server/serve-registry";
import { workspaceBranch } from "../session/workspace-branch";
import type { BackendTarget } from "./client";
import { BackendClient, discoverBackends } from "./client";

/** Session-addressing intent before discovery succeeds. */
export interface BackendAttachIntent {
	/** Explicit session id, when the caller named one. */
	sessionId?: string;
	/** Force a new session instead of reusing the newest cwd session. */
	newSession: boolean;
	/** Explicit URL from `--backend-url` (discovery still probes it). */
	url?: string;
	/** True when the user asked for this explicitly (controls warning copy). */
	explicit: boolean;
}

/** Resolved attachment target handed to the TUI/print runners. */
export interface ResolvedBackendTarget extends BackendAttachIntent {
	backend: BackendTarget;
}

/** Typed attach startup failure; the launch path prints the message verbatim. */
export class BackendAttachError extends Error {
	constructor(
		readonly code: "unavailable" | "ambiguous" | "version-mismatch" | "session-not-found",
		message: string,
	) {
		super(message);
		this.name = "BackendAttachError";
	}
}

/**
 * The backend attach request for this launch, or undefined when the launch
 * keeps its in-process session.
 *
 * Only explicit flags select backend mode. A bare `zetacode` stays local even
 * when a serve instance is running — operators must be able to open a pure
 * single-window TUI without it becoming a client of somebody else's backend.
 */
export function backendAttachIntent(
	args: Args,
	_rawArgs: readonly string[],
	options: { interactive: boolean },
): BackendAttachIntent | undefined {
	if (!options.interactive) return undefined;
	const explicit =
		args.attach === true ||
		args.attachSession !== undefined ||
		args.attachNew === true ||
		args.backend === true ||
		args.backendUrl !== undefined;
	if (!explicit) return undefined;
	const address = args.attachSession?.trim();
	return {
		...(address ? { sessionId: address } : {}),
		newSession: args.attachNew === true,
		...(args.backendUrl ? { url: args.backendUrl } : {}),
		explicit: true,
	};
}

/** Probe retry cadence for a serve that is still coming up. */
const ATTACH_PROBE_RETRIES = 3;
const ATTACH_PROBE_RETRY_DELAY_MS = 400;

interface ResolveBackendOptions {
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	registryFile?: string;
	/** Workspace used to pick the instance that already owns its session. */
	cwd?: string;
	/** Single-target injection used by older tests. */
	discover?: (options: {
		url?: string;
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
		fetchImpl?: typeof fetch;
		registryFile?: string;
	}) => Promise<BackendTarget | null>;
	/** Full-list injection point. */
	discoverAll?: typeof discoverBackends;
	sleepImpl?: (ms: number) => Promise<unknown>;
}

function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function describeTarget(target: BackendTarget): string {
	const gateway = target.identity.gatewayUrl ?? target.baseUrl;
	return `pid ${target.identity.pid} v${target.identity.version} at ${gateway}`;
}

/** Which discovered backends own `sessionId`; unreachable/foreign ones are skipped. */
async function targetsOwningSession(
	targets: readonly BackendTarget[],
	sessionId: string,
	fetchImpl?: typeof fetch,
): Promise<BackendTarget[]> {
	const owners: BackendTarget[] = [];
	for (const target of targets) {
		try {
			const { sessions } = await new BackendClient(target.baseUrl, fetchImpl).listSessions();
			if (sessions.some(session => session.id === sessionId)) owners.push(target);
		} catch {
			// A backend that cannot list sessions is not a candidate for this id.
		}
	}
	return owners;
}

/** Which discovered backends already host this workspace/branch pair. */
async function targetsOwningCwd(
	targets: readonly BackendTarget[],
	cwd: string,
	fetchImpl?: typeof fetch,
): Promise<BackendTarget[]> {
	const branch = workspaceBranch(cwd);
	const owners: BackendTarget[] = [];
	for (const target of targets) {
		try {
			const session = await new BackendClient(target.baseUrl, fetchImpl).findSessionForCwd(cwd, branch);
			if (session) owners.push(target);
		} catch {
			// Unreachable store: not an owner for selection purposes.
		}
	}
	return owners;
}

/**
 * Pick the one backend an attach intent addresses. Returns undefined only when
 * retries are exhausted and nothing answers; ambiguity and version drift throw
 * so the caller never silently binds to the wrong instance.
 */
async function resolveOnce(
	intent: BackendAttachIntent,
	options: ResolveBackendOptions,
	discoverAll: NonNullable<ResolveBackendOptions["discoverAll"]>,
): Promise<ResolvedBackendTarget | undefined> {
	const discoverOptions = {
		url: intent.url,
		env: options.env ?? process.env,
		timeoutMs: options.timeoutMs,
		fetchImpl: options.fetchImpl,
		registryFile: options.registryFile,
	};
	let targets = await discoverAll(discoverOptions);

	// An explicit URL means exactly that instance. Default candidates answering
	// elsewhere must not steal the attach.
	if (intent.url) {
		const wanted = originOf(intent.url);
		targets = wanted ? targets.filter(target => originOf(target.baseUrl) === wanted) : [];
	}

	if (targets.length === 0) return undefined;

	const sameVersion = targets.filter(target => target.identity.version === VERSION);
	if (sameVersion.length > 0) {
		targets = sameVersion;
	} else {
		throw new BackendAttachError(
			"version-mismatch",
			`Backend ${describeTarget(targets[0]!)} runs a different zeta version (client ${VERSION}); ` +
				`start a matching \`zetacode serve\` or upgrade the client.`,
		);
	}

	// Session ownership disambiguates instances; a single reachable backend is
	// authoritative for the id and later resolves it itself (a session can be
	// addressable without appearing in the list, e.g. a live in-memory run).
	if (targets.length > 1 && intent.sessionId) {
		const owners = await targetsOwningSession(targets, intent.sessionId, options.fetchImpl);
		if (owners.length === 0) {
			throw new BackendAttachError("session-not-found", `No reachable backend owns session ${intent.sessionId}.`);
		}
		targets = owners;
	}

	// With several instances, a workspace that already has a session selects
	// its owner. Two instances hosting the same (cwd, branch) remain ambiguous:
	// creating a third session would guess which store the operator meant.
	if (targets.length > 1 && !intent.sessionId && options.cwd) {
		const owners = await targetsOwningCwd(targets, options.cwd, options.fetchImpl);
		if (owners.length === 1) targets = owners;
	}

	if (targets.length > 1) {
		throw new BackendAttachError(
			"ambiguous",
			`${targets.length} zeta backends are live:\n` +
				targets.map(target => `  - ${describeTarget(target)}`).join("\n") +
				`\nChoose one with --backend-url <url>${intent.sessionId ? "" : " or --attach-session <id>"}.`,
		);
	}

	return { ...intent, backend: targets[0]! };
}

/**
 * Resolve an attach intent against the live registry. A registered serve that
 * is still booting is retried; an unregistered machine fails immediately.
 */
export async function resolveBackendTarget(
	intent: BackendAttachIntent | undefined,
	options: ResolveBackendOptions = {},
): Promise<ResolvedBackendTarget | undefined> {
	if (!intent) return undefined;
	const discoverAll =
		options.discoverAll ??
		(options.discover
			? async (discoverOptions: Parameters<typeof discoverBackends>[0] = {}) => {
					const one = await options.discover!(discoverOptions);
					return one ? [one] : [];
				}
			: discoverBackends);

	const resolved = await resolveOnce(intent, options, discoverAll);
	if (resolved) return resolved;

	const registrations = listServeRegistrations({
		file: options.registryFile ?? serveRegistryPath(options.env as NodeJS.ProcessEnv | undefined),
		env: options.env as NodeJS.ProcessEnv | undefined,
	});
	if (registrations.length === 0) return undefined;
	const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
	for (let attempt = 0; attempt < ATTACH_PROBE_RETRIES; attempt++) {
		await sleep(ATTACH_PROBE_RETRY_DELAY_MS);
		const retried = await resolveOnce(intent, options, discoverAll);
		if (retried) return retried;
	}
	return undefined;
}

/** Startup transport decision used by the launch path (and its tests). */
export type StartupTransport = { kind: "in-process" } | { kind: "backend"; target: ResolvedBackendTarget };

/**
 * Resolve the interactive transport.
 *
 * Bare/local launches keep the in-process session. An explicit backend launch
 * is a contract: when no backend answers, startup fails with a diagnostic
 * instead of opening a second local session next to the operator's serve.
 */
export async function resolveStartupTransport(
	args: Args,
	rawArgs: readonly string[],
	options: {
		interactive: boolean;
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
		fetchImpl?: typeof fetch;
		registryFile?: string;
		/** Workspace whose session should pick the backend when several run. */
		cwd?: string;
		discover?: ResolveBackendOptions["discover"];
		discoverAll?: typeof discoverBackends;
	},
): Promise<StartupTransport> {
	const intent = backendAttachIntent(args, rawArgs, options);
	if (!intent) return { kind: "in-process" };
	const target = await resolveBackendTarget(intent, options);
	if (!target) {
		throw new BackendAttachError(
			"unavailable",
			"--attach/--backend was requested but no matching `zetacode serve` backend is reachable. " +
				"Start one (`zetacode serve`) or run a local session with a bare `zetacode`.",
		);
	}
	return { kind: "backend", target };
}
