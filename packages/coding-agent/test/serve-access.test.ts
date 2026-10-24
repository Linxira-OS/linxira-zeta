/**
 * `zetacode serve` exposure resolution — the `--host`/web.yml/env precedence
 * chain, the built-in TLS listener selection, and every refusal that keeps a
 * plaintext or token-less control plane off the network.
 */

import { describe, expect, test } from "bun:test";
import {
	isLoopbackBindHost,
	resolveServeAccess,
	type ServeAccessInput,
	type ServeAccessResolution,
} from "../src/server/serve-access";

const existing = () => true;
const missing = () => false;

function resolve(input: ServeAccessInput): ServeAccessResolution {
	return resolveServeAccess({ fileExists: existing, ...input });
}

describe("host resolution", () => {
	test("defaults to loopback when nothing is configured", () => {
		const result = resolve({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.access).toEqual({
			host: "127.0.0.1",
			scheme: "http",
			tls: null,
			loopback: true,
			allowPlainHttp: false,
		});
		expect(result.warnings).toEqual([]);
	});

	test("flag beats config beats env", () => {
		const config = { remote: { host: "10.0.0.5", token: "tok" } } as never;
		// These hosts are non-loopback, so plaintext needs the explicit opt-in;
		// the assertions here are purely about precedence.
		const allow = { allowPlainHttp: true };
		const flag = resolve({
			flags: { host: "192.168.1.9", ...allow },
			config,
			env: { ZETA_SERVE_HOSTNAME: "10.1.1.1" },
		});
		expect(flag.ok && flag.access.host).toBe("192.168.1.9");
		const fromConfig = resolve({ flags: allow, config, env: { ZETA_SERVE_HOSTNAME: "10.1.1.1" } });
		expect(fromConfig.ok && fromConfig.access.host).toBe("10.0.0.5");
		const fromEnv = resolve({
			flags: allow,
			config: { remote: { token: "tok" } } as never,
			env: { ZETA_SERVE_HOSTNAME: "10.1.1.1" },
		});
		expect(fromEnv.ok && fromEnv.access.host).toBe("10.1.1.1");
	});

	test("rejects a scheme, a path, or an embedded port", () => {
		expect(resolve({ flags: { host: "https://zeta.example" } }).ok).toBe(false);
		expect(resolve({ flags: { host: "zeta.example/api" } }).ok).toBe(false);
		expect(resolve({ flags: { host: "zeta.example:43141" } }).ok).toBe(false);
		expect(resolve({ flags: { host: "   " } }).ok).toBe(false);
	});

	test("loopback detection covers 127/8 and ::1 but not bind-all", () => {
		expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
		expect(isLoopbackBindHost("127.10.0.9")).toBe(true);
		expect(isLoopbackBindHost("localhost")).toBe(true);
		expect(isLoopbackBindHost("::1")).toBe(true);
		expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
		expect(isLoopbackBindHost("::")).toBe(false);
		expect(isLoopbackBindHost("192.168.1.5")).toBe(false);
	});
});

describe("exposure refusals", () => {
	test("non-loopback without a token is refused", () => {
		const result = resolve({ flags: { host: "0.0.0.0" } });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("remote.token");
	});

	test("plaintext beyond loopback is refused unless explicitly opted in", () => {
		const config = { remote: { token: "tok" } } as never;
		const refused = resolve({ flags: { host: "192.168.1.5" }, config });
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error).toContain("--allow-plain-http");

		const viaFlag = resolve({ flags: { host: "192.168.1.5", allowPlainHttp: true }, config });
		expect(viaFlag.ok).toBe(true);
		expect(viaFlag.ok && viaFlag.access.scheme).toBe("http");
		expect(viaFlag.ok && viaFlag.warnings.length).toBe(1);

		const viaConfig = resolve({
			flags: { host: "192.168.1.5" },
			config: { remote: { token: "tok", allowPlainHttp: true } } as never,
		});
		expect(viaConfig.ok).toBe(true);
	});

	test("TLS enabled without certificate/key is refused", () => {
		const result = resolve({ flags: { tls: true } });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("TLS");
	});

	test("a lone certificate flag is refused", () => {
		const result = resolve({ flags: { tlsCert: "cert.pem" } });
		expect(result.ok).toBe(false);
	});

	test("a missing certificate/key file is refused", () => {
		const result = resolve({ flags: { tlsCert: "cert.pem", tlsKey: "key.pem" }, fileExists: missing });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("not found");
	});
});

describe("TLS selection", () => {
	test("cert + key switch the scheme to https for a loopback bind", () => {
		const result = resolve({ flags: { tlsCert: "cert.pem", tlsKey: "key.pem" } });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.access.scheme).toBe("https");
		expect(result.access.tls).toEqual({ cert: "cert.pem", key: "key.pem" });
	});

	test("web.yml TLS is used, and allows a non-loopback bind without the plaintext opt-in", () => {
		const config = {
			remote: { host: "zeta.example", token: "tok", tls: { cert: "/certs/fullchain.pem", key: "/certs/key.pem" } },
		} as never;
		const result = resolve({ config });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.access.scheme).toBe("https");
		expect(result.access.host).toBe("zeta.example");
	});

	test("env TLS is the fallback when neither flag nor config provides one", () => {
		const result = resolve({
			flags: { host: "0.0.0.0" },
			config: { remote: { token: "tok" } } as never,
			env: { ZETA_SERVE_TLS_CERT: "env-cert.pem", ZETA_SERVE_TLS_KEY: "env-key.pem" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.access.scheme).toBe("https");
	});

	test("flag TLS wins over config TLS", () => {
		const result = resolve({
			flags: { tlsCert: "flag-cert.pem", tlsKey: "flag-key.pem" },
			config: { remote: { tls: { cert: "cfg-cert.pem", key: "cfg-key.pem" } } } as never,
		});
		expect(result.ok && result.access.tls).toEqual({ cert: "flag-cert.pem", key: "flag-key.pem" });
	});
});
