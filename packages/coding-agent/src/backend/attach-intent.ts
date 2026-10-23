/**
 * Startup decision: should this interactive/TUI launch attach to a running
 * `zetacode serve` backend, and to which session?
 *
 * Bare `zetacode` (no argv) attaches to the newest backend session for the
 * current directory. Explicit addressing:
 *   --attach                     attach, newest session in this cwd
 *   --attach-session <id>        attach to that session (any repository)
 *   --attach-new                 force a fresh session in this cwd
 * `--backend` opts a print launch into the same transport.
 *
 * A missing backend is never fatal for the interactive path: the caller keeps
 * today's in-process session. Explicit `--attach` likewise falls back (with a
 * warning) so a stale `serve` cannot brick the CLI.
 */

import type { Args } from "../cli/args";
import { readServeRegistration, serveRegistryPath } from "../server/serve-registry";
import type { BackendTarget } from "./client";
import { discoverBackend } from "./client";

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

/**
 * The backend attach request for this launch, or undefined when the launch
 * keeps its in-process session.
 *
 * Only a true bare launch auto-attaches: an argv prompt, a session selector,
 * print mode, RPC, goal/plan startup, or an explicit local-session flag all
 * mean the caller chose the in-process path. `--attach` is the opt-in that
 * overrides that.
 */
export function backendAttachIntent(
	args: Args,
	rawArgs: readonly string[],
	options: { interactive: boolean },
): BackendAttachIntent | undefined {
	if (!options.interactive) return undefined;
	const explicit = args.attach === true || args.attachSession !== undefined || args.attachNew === true;
	const address = args.attachSession?.trim();
	const intent: BackendAttachIntent = {
		...(address ? { sessionId: address } : {}),
		newSession: args.attachNew === true,
		...(args.backendUrl ? { url: args.backendUrl } : {}),
		explicit,
	};
	if (explicit) return intent;

	// Bare `zetacode`: attach only when nothing else selected a local session.
	if (rawArgs.length > 0) return undefined;
	if (
		args.continue ||
		args.resume !== undefined ||
		args.fork ||
		args.restore ||
		args.fromClaude ||
		args.fromCodex ||
		args.noSession ||
		args.messages.length > 0 ||
		args.fileArgs.length > 0 ||
		args.join
	) {
		return undefined;
	}
	return intent;
}

/** Probe retry cadence for a serve that is still coming up. */
const ATTACH_PROBE_RETRIES = 3;
const ATTACH_PROBE_RETRY_DELAY_MS = 400;

/**
 * Probe the backend for an intent. Returns undefined when nothing answers;
 * the caller falls back to the in-process session.
 *
 * A serve that was started moments ago can miss the first probe (cold module
 * cache, first bind) while its registration already names it. Retry only in
 * that case, so a machine without `serve` still falls back immediately.
 */
export async function resolveBackendTarget(
	intent: BackendAttachIntent | undefined,
	options: {
		env?: Record<string, string | undefined>;
		timeoutMs?: number;
		fetchImpl?: typeof fetch;
		registryFile?: string;
		discover?: typeof discoverBackend;
		sleepImpl?: (ms: number) => Promise<unknown>;
	} = {},
): Promise<ResolvedBackendTarget | undefined> {
	if (!intent) return undefined;
	const discover = options.discover ?? discoverBackend;
	const discoverOptions = {
		url: intent.url,
		env: options.env ?? process.env,
		timeoutMs: options.timeoutMs,
		fetchImpl: options.fetchImpl,
		registryFile: options.registryFile,
	};
	const backend = await discover(discoverOptions);
	if (backend) return { ...intent, backend };

	const registration = readServeRegistration(
		options.registryFile ?? serveRegistryPath(options.env as NodeJS.ProcessEnv | undefined),
	);
	if (!registration) return undefined;
	const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
	for (let attempt = 0; attempt < ATTACH_PROBE_RETRIES; attempt++) {
		await sleep(ATTACH_PROBE_RETRY_DELAY_MS);
		const retried = await discover(discoverOptions);
		if (retried) return { ...intent, backend: retried };
	}
	return undefined;
}

/** Startup transport decision used by the launch path (and its tests). */
export type StartupTransport = { kind: "in-process" } | { kind: "backend"; target: ResolvedBackendTarget };

/**
 * Resolve the interactive transport. A missing backend is the in-process
 * fallback, never an error: the CLI must stay usable with `serve` stopped.
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
		discover?: typeof discoverBackend;
	},
): Promise<StartupTransport> {
	const intent = backendAttachIntent(args, rawArgs, options);
	if (!intent) return { kind: "in-process" };
	const target = await resolveBackendTarget(intent, options);
	return target ? { kind: "backend", target } : { kind: "in-process" };
}
