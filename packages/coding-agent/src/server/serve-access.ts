/**
 * `zetacode serve` exposure resolution.
 *
 * Binding is intentionally boring: the CLI flag wins, then `web.yml`
 * `remote.host`, then `ZETA_SERVE_HOSTNAME`, then loopback. Whatever the
 * source, the result is validated before a socket is opened:
 *
 * - a non-loopback bind always requires `remote.token` (the access gate would
 *   otherwise reject every request, so refuse up front with a clear message);
 * - a non-loopback bind is plain HTTP only when the operator opts in
 *   (`--allow-plain-http` / `remote.allowPlainHttp`), otherwise TLS must be
 *   configured or a TLS reverse proxy documented — never a silent plaintext
 *   exposure;
 * - TLS needs both a certificate and a key, and both files must exist.
 *
 * The same object feeds the listener (`host`, `tls`) and the reported URLs
 * (`scheme`), so the printed origin can never disagree with the bound one.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { WebConfigData } from "../config/web-config";

export interface ServeAccessFlags {
	host?: string;
	/** `--tls`: force TLS (refuses to start without cert + key). */
	tls?: boolean;
	tlsCert?: string;
	tlsKey?: string;
	/** `--allow-plain-http`: explicit opt-in for a plaintext non-loopback bind. */
	allowPlainHttp?: boolean;
}

/**
 * Environment slice consulted for the bind host and TLS paths. `ProcessEnv`
 * itself (an index signature) so `process.env` passes without a cast and tests
 * can pass plain literals.
 */
export type ServeAccessEnvironment = NodeJS.ProcessEnv;

export interface ServeTlsPaths {
	cert: string;
	key: string;
}

export interface ServeAccess {
	host: string;
	scheme: "http" | "https";
	tls: ServeTlsPaths | null;
	loopback: boolean;
	/** The effective plaintext opt-in (flag or web.yml). */
	allowPlainHttp: boolean;
}

export type ServeAccessResolution =
	| { ok: true; access: ServeAccess; warnings: string[] }
	| { ok: false; error: string };

const LOOPBACK_HOSTS: Record<string, true> = {
	localhost: true,
	"::1": true,
	"[::1]": true,
};

/** Loopback bind hosts (IPv4 127/8 literals + localhost + IPv6 ::1). `0.0.0.0`
 *  and `::` are bind-all addresses, NOT loopback. */
export function isLoopbackBindHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	if (normalized === "") return false;
	if (LOOPBACK_HOSTS[normalized]) return true;
	const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
	return match !== null && match.slice(1).every(part => Number(part) <= 255);
}

/**
 * A bind host is a hostname or IP literal — no scheme, path, query, or port.
 * IPv6 literals (`::`, `::1`, optionally bracketed) are allowed; anything that
 * looks like `host:port` is not, because the port comes from `--web-port`.
 */
function validateBindHost(host: string): string | null {
	if (/[\s/?#]/.test(host) || host.includes("://"))
		return "must be a hostname or IP literal, without a scheme or path";
	const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const colonCount = (unbracketed.match(/:/g) ?? []).length;
	if (colonCount === 1) return "must not include a port; use --web-port";
	if (colonCount > 1 && !/^[0-9a-f:]+$/i.test(unbracketed)) return "is not a valid IPv6 literal";
	return null;
}

function tlsFromEnvironment(env: ServeAccessEnvironment): ServeTlsPaths | null {
	if (env.ZETA_SERVE_TLS_CERT && env.ZETA_SERVE_TLS_KEY) {
		return { cert: env.ZETA_SERVE_TLS_CERT, key: env.ZETA_SERVE_TLS_KEY };
	}
	return null;
}

function tlsFromConfig(config: WebConfigData | undefined): ServeTlsPaths | null {
	const tls = config?.remote.tls;
	if (tls?.cert && tls.key) return { cert: tls.cert, key: tls.key };
	return null;
}

function tlsFromFlags(flags: ServeAccessFlags): ServeTlsPaths | null {
	if (flags.tlsCert && flags.tlsKey) return { cert: flags.tlsCert, key: flags.tlsKey };
	return null;
}

export interface ServeAccessInput {
	flags?: ServeAccessFlags;
	config?: WebConfigData;
	env?: ServeAccessEnvironment;
	fileExists?: (filePath: string) => boolean;
}

/**
 * Resolve the effective bind access, or refuse with an actionable message.
 * Pure apart from the injectable `fileExists` (the TLS paths are checked on
 * disk before the listener is created, so a typo cannot surface as an opaque
 * Bun.serve failure after the Web UI child already started).
 */
export function resolveServeAccess(input: ServeAccessInput): ServeAccessResolution {
	const flags = input.flags ?? {};
	const env = input.env ?? {};
	const fileExists = input.fileExists ?? existsSync;

	const requestedHost = (flags.host ?? input.config?.remote.host ?? env.ZETA_SERVE_HOSTNAME ?? "127.0.0.1").trim();
	if (requestedHost === "") return { ok: false, error: "The bind host is empty; omit --host to use 127.0.0.1" };
	const hostProblem = validateBindHost(requestedHost);
	if (hostProblem) return { ok: false, error: `Invalid --host "${requestedHost}": ${hostProblem}` };

	const flagTls = tlsFromFlags(flags);
	const envTls = tlsFromEnvironment(env);
	const configTls = tlsFromConfig(input.config);
	const certOnly = Boolean(flags.tlsCert) !== Boolean(flags.tlsKey);
	if (certOnly) {
		return { ok: false, error: "TLS needs both --tls-cert and --tls-key (only one was provided)" };
	}
	const tls = flagTls ?? envTls ?? configTls;
	const tlsForced = flags.tls === true || input.config?.remote.tls?.enabled === true;
	if (tlsForced && !tls) {
		return {
			ok: false,
			error: "TLS is enabled but no certificate/key is configured (--tls-cert/--tls-key, ZETA_SERVE_TLS_CERT/KEY, or remote.tls in web.yml)",
		};
	}
	if (tls) {
		const missing = [tls.cert, tls.key].filter(filePath => !fileExists(path.resolve(filePath)));
		if (missing.length > 0) {
			return { ok: false, error: `TLS certificate/key file not found: ${missing.join(", ")}` };
		}
	}

	const loopback = isLoopbackBindHost(requestedHost);
	const allowPlainHttp = flags.allowPlainHttp === true || input.config?.remote.allowPlainHttp === true;
	const token = input.config?.remote.token?.trim() ?? "";
	const warnings: string[] = [];

	if (!loopback) {
		if (token === "") {
			return {
				ok: false,
				error: `Refusing to bind ${requestedHost} without remote.token: every non-loopback request would be rejected. Set remote.token in Settings → Remote Access (or run without --host).`,
			};
		}
		if (!tls && !allowPlainHttp) {
			return {
				ok: false,
				error: `Refusing plain HTTP on non-loopback host ${requestedHost}. Provide --tls-cert/--tls-key (or remote.tls in web.yml), put a TLS reverse proxy in front (see docs/remote-workspaces.md), or pass --allow-plain-http to accept plaintext exposure on your own network.`,
			};
		}
		if (!tls) {
			warnings.push(
				`Plain HTTP is exposed on ${requestedHost}: remote browsers send the token in clear text. Use TLS or a trusted LAN only.`,
			);
		}
	}

	return {
		ok: true,
		access: { host: requestedHost, scheme: tls ? "https" : "http", tls, loopback, allowPlainHttp },
		warnings,
	};
}

/** Origin string for a resolved access + port (`http://host:port` / `https://`). */
export function formatAccessUrl(access: Pick<ServeAccess, "host" | "scheme">, port: number): string {
	const bare = access.host.startsWith("[") ? access.host.slice(1, -1) : access.host;
	const urlHost = bare.includes(":") ? `[${bare}]` : bare;
	return `${access.scheme}://${urlHost}:${port}`;
}
