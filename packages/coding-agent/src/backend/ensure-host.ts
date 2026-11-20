/**
 * Ensure-machine-host: reuse a healthy `zetacode serve` instance or start the
 * hidden daemon. This is the one entry point CLI/TUI/Web/Desktop can share;
 * it never kills a live instance.
 *
 * The version rule mirrors `serve` discovery:
 * - same version + healthy identity → reuse;
 * - another version answers → raise a typed conflict, never take the port;
 * - nothing answers → start the daemon (which owns one instance per user).
 */
import { VERSION, ZETA_GATEWAY_PORT, ZETA_STATS_PORT, ZETA_WEB_PORT } from "@linxiraos/pi-utils";
import { WebConfig } from "../config/web-config";
import { resolveServeAccess, type ServeAccess } from "../server/serve-access";
import {
	isPidAlive,
	listServeRegistrations,
	probeServeIdentity,
	type ServeRegistration,
} from "../server/serve-registry";
import type { ServeIdentity } from "../server/web-gateway/identity";

export interface EnsureHostOptions {
	cwd?: string;
	/** Force IM hosting even when web.yml leaves every instance disabled. */
	channels?: boolean;
	webPort?: number;
	statsPort?: number;
	gatewayPort?: number;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	/** Test seam: replace the live-registry probe. */
	probe?: typeof probeServeIdentity;
	/** Test seam: replace the daemon starter. */
	start?: (options: Parameters<typeof import("../commands/daemon").startDaemon>[0]) => Promise<
		import("../commands/daemon").DaemonStartResult
	>;
}

export interface EnsureHostResult {
	action: "reused" | "started";
	pid: number;
	webUrl: string;
	gatewayUrl: string | null;
	statsUrl: string | null;
	registration: ServeRegistration | null;
}

export class HostVersionConflictError extends Error {
	readonly identity: ServeIdentity;

	constructor(identity: ServeIdentity) {
		super(
			`A different Zeta host is already running (pid ${identity.pid}, version ${identity.version}); ` +
				`this CLI is ${VERSION}. Leave it running or start a separate instance on other ports.`,
		);
		this.name = "HostVersionConflictError";
		this.identity = identity;
	}
}

/** A live registration that answers its identity probe, newest first. */
async function liveRegistrations(
	probe: typeof probeServeIdentity,
	timeoutMs: number,
): Promise<Array<{ registration: ServeRegistration; identity: ServeIdentity }>> {
	const found: Array<{ registration: ServeRegistration; identity: ServeIdentity }> = [];
	for (const registration of listServeRegistrations()) {
		if (!isPidAlive(registration.pid)) continue;
		const identity = await probe(registration.webUrl, { timeoutMs });
		if (identity !== null) found.push({ registration, identity });
	}
	return found;
}

/**
 * Ensure the local Host is available. Returns the live/started instance URL
 * and pid. Never terminates an existing process.
 */
export async function ensureHost(options: EnsureHostOptions = {}): Promise<EnsureHostResult> {
	const env = options.env ?? process.env;
	const probe = options.probe ?? probeServeIdentity;
	const wanted = options.timeoutMs ?? 1_500;
	const live = await liveRegistrations(probe, wanted);
	for (const { registration, identity } of live) {
		if (identity.version !== VERSION) throw new HostVersionConflictError(identity);
		return {
			action: "reused",
			pid: identity.pid,
			webUrl: identity.webUrl ?? registration.webUrl,
			gatewayUrl: identity.gatewayUrl ?? registration.gatewayUrl,
			statsUrl: identity.statsUrl ?? (registration.statsUrl || null),
			registration,
		};
	}

	const config = await WebConfig.load();
	const access = resolveServeAccess({ flags: {}, config: config.getData(), env });
	if (!access.ok) throw new Error(`Cannot start Zeta Host: ${access.error}`);
	const ports = {
		webPort: options.webPort ?? ZETA_WEB_PORT,
		statsPort: options.statsPort ?? ZETA_STATS_PORT,
		gatewayPort: options.gatewayPort ?? ZETA_GATEWAY_PORT,
	};
	const start =
		options.start ??
		(async (input: Parameters<typeof import("../commands/daemon").startDaemon>[0]) => {
			const { startDaemon } = await import("../commands/daemon");
			return startDaemon(input);
		});
	const result = await start({
		...ports,
		access: access.access satisfies ServeAccess,
		cwd: options.cwd ?? process.cwd(),
		env,
		channels: options.channels ?? true,
	});
	if (result.action === "failed" || result.status.pid === null || result.status.webUrl === null) {
		throw new Error(result.message ?? "Zeta Host did not start");
	}
	return {
		action: "started",
		pid: result.status.pid,
		webUrl: result.status.webUrl,
		gatewayUrl: result.status.gatewayUrl,
		statsUrl: result.status.statsUrl,
		registration: null,
	};
}
