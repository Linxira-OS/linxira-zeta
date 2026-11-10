import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import {
	applyDevIsolationEnv,
	DEV_CONFIG_DIR,
	DEV_PORTS,
	DEV_PROFILE,
	GAPS,
	isInside,
	PRODUCTION_PORTS,
	resolveDevIsolation,
	verifyDevIsolation,
} from "./dev-isolation";

const homeDir = path.resolve(process.platform === "win32" ? "C:/Users/dev-user" : "/home/dev-user");
const repoRoot = path.resolve(process.platform === "win32" ? "C:/src/zeta" : "/src/zeta");
const isolation = resolveDevIsolation({ homeDir, repoRoot });

describe("resolveDevIsolation", () => {
	test("pins the dev config root, profile and agent dir", () => {
		expect(isolation.configRoot).toBe(path.join(homeDir, DEV_CONFIG_DIR));
		expect(isolation.profileRoot).toBe(path.join(isolation.configRoot, "profiles", DEV_PROFILE));
		expect(isolation.agentDir).toBe(path.join(isolation.profileRoot, "agent"));
		expect(isolation.env.ZETA_CONFIG_DIR).toBe(DEV_CONFIG_DIR);
		expect(isolation.env.ZETA_PROFILE).toBe(DEV_PROFILE);
		expect(isolation.env.ZETA_CODING_AGENT_DIR).toBe(isolation.agentDir);
	});

	test("keeps every state path out of the production root", () => {
		const productionRoot = path.join(homeDir, ".zeta");
		for (const value of [
			isolation.teamDb,
			isolation.serveRegistry,
			isolation.statsDb,
			isolation.trashDir,
			isolation.workspaceDir,
			isolation.desktopUserData,
			isolation.agentDir,
		]) {
			expect(isInside(value, isolation.configRoot)).toBe(true);
			expect(isInside(value, productionRoot)).toBe(false);
		}
	});

	test("uses dedicated ports and points at the checkout renderer", () => {
		expect(isolation.ports).toEqual({ ...DEV_PORTS });
		expect(new Set(Object.values(isolation.ports)).size).toBe(3);
		for (const port of Object.values(isolation.ports)) {
			expect([PRODUCTION_PORTS.web, PRODUCTION_PORTS.gateway, PRODUCTION_PORTS.stats]).not.toContain(port);
		}
		expect(isolation.env.ZETA_WEB_GATEWAY_PORT).toBe(String(DEV_PORTS.gateway));
		expect(isolation.env.ZETA_GATEWAY_URL).toBe(isolation.urls.gateway);
		expect(isolation.env.ZETA_WEB_APP_DIR).toBe(path.join(repoRoot, "web-app", "dist"));
	});

	test("passes the guard", () => {
		expect(verifyDevIsolation(isolation)).toEqual([]);
	});
});

describe("applyDevIsolationEnv", () => {
	test("overrides production pointers and removes sharing-prone keys", () => {
		const env = applyDevIsolationEnv(isolation, {
			PATH: "/usr/bin",
			ZETA_TEAM_DB: path.join(homeDir, ".zeta", "data", "zeta.db"),
			PI_NATIVES_DIR: path.join(homeDir, ".zeta", "agent", "natives"),
			PI_PROFILE: "work",
			ZETA_WORKTREE_DIR: path.join(homeDir, ".zeta", "wt"),
			XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
			ZETA_AUTH_BROKER_URL: "http://broker.example:8765",
		});

		expect(env.PATH).toBe("/usr/bin");
		expect(env.ZETA_TEAM_DB).toBe(isolation.teamDb);
		for (const key of isolation.clearedEnv) expect(env[key]).toBeUndefined();
		// Credentials are intentionally inherited: the broker is not dev state.
		expect(env.ZETA_AUTH_BROKER_URL).toBe("http://broker.example:8765");
	});
});

describe("verifyDevIsolation", () => {
	test("rejects production ports", () => {
		const failures = verifyDevIsolation({
			...isolation,
			ports: { ...isolation.ports, web: PRODUCTION_PORTS.web },
			env: { ...isolation.env, ZETA_WEB_GATEWAY_PORT: String(isolation.ports.gateway) },
		});
		expect(failures.some(failure => failure.includes("collides with an installed Zeta"))).toBe(true);
	});

	test("rejects a dev root nested under the production root", () => {
		const configRoot = path.join(homeDir, ".zeta");
		const failures = verifyDevIsolation({ ...isolation, configRoot, agentDir: path.join(configRoot, "agent") });
		expect(failures.some(failure => failure.includes("production root"))).toBe(true);
	});
});

describe("audited gaps", () => {
	test("stats.db has no environment override and is isolated by the config root", () => {
		const gap = GAPS.find(entry => entry.key === "stats-db");
		expect(gap).toBeDefined();
		expect(isolation.env.ZETA_STATS_DB).toBeUndefined();
		expect(isolation.statsDb).toBe(path.join(isolation.profileRoot, "stats.db"));
	});

	test("path containment is segment-safe", () => {
		expect(isInside(path.join(homeDir, ".zeta-dev"), path.join(homeDir, ".zeta"))).toBe(false);
		expect(isInside(path.join(homeDir, ".zeta-dev", "stats.db"), path.join(homeDir, ".zeta-dev"))).toBe(true);
	});
});
