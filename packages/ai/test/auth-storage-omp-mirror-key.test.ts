/**
 * OMP compatibility mirror tier — the lowest rung of the key precedence
 * cascade (`setConfig` with `mirror: true`).
 *
 * The coding-agent OMP overlay reads upstream agent.db API keys and injects
 * them so bundled providers stay usable. The injection used to use the
 * config-override tier (above OAuth/login/env/stored), so a key the user
 * saved into Zeta's agent.db afterwards never authenticated a single request
 * — the stale upstream key kept winning. The mirror tier fixes the two
 * states that matter:
 *
 * - nothing local: the mirror key serves requests (fallback works);
 * - local key saved (any tier): the local key wins immediately, with no
 *   reload needed to evict the mirror.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type AuthCredentialStore, AuthStorage, SqliteAuthCredentialStore } from "@linxiraos/pi-ai/auth-storage";
import { removeWithRetries } from "../../utils/src/temp";
import { withEnv } from "./helpers";

const SUPPRESS_DEEPSEEK_ENV = {
	DEEPSEEK_API_KEY: undefined,
} as const;

describe("AuthStorage OMP mirror-tier keys", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-omp-mirror-"));
		store = await SqliteAuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store);
	});

	afterEach(async () => {
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) await removeWithRetries(tempDir);
	});

	test("mirror serves the key when nothing local exists", async () => {
		await withEnv(SUPPRESS_DEEPSEEK_ENV, async () => {
			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			await expect(authStorage!.keys.get("deepseek")).resolves.toBe("omp-upstream-key");
			await expect(authStorage!.keys.peek("deepseek")).resolves.toBe("omp-upstream-key");
			expect(authStorage!.keys.source("deepseek")).toEqual({ kind: "config", concrete: true });
			expect(authStorage!.keys.describe("deepseek")).toBe("OMP compatibility mirror (upstream agent.db)");
		});
	});

	test("api key stored after the mirror never loses to the upstream key", async () => {
		await withEnv(SUPPRESS_DEEPSEEK_ENV, async () => {
			// Static load happened while Zeta had no credential: mirror installed.
			authStorage!.keys.setConfig("deepseek", "omp-stale-key", { mirror: true });
			// User then saves their own key through the web api-key endpoint
			// (stored tier — the lowest persisted tier).
			await authStorage!.credentials.set("deepseek", { type: "api_key", key: "user-new-key" });
			await expect(authStorage!.keys.get("deepseek")).resolves.toBe("user-new-key");
			expect(authStorage!.keys.source("deepseek")).toEqual({ kind: "api_key", concrete: true });
		});
	});

	test("stored oauth and login credentials outrank the mirror", async () => {
		await withEnv(SUPPRESS_DEEPSEEK_ENV, async () => {
			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			await authStorage!.credentials.set("deepseek", [
				{
					type: "oauth",
					access: "oauth-access",
					refresh: "oauth-refresh",
					expires: Date.now() + 60 * 60_000,
				},
			]);
			await expect(authStorage!.keys.get("deepseek")).resolves.toBe("oauth-access");
		});
		await withEnv(SUPPRESS_DEEPSEEK_ENV, async () => {
			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			await authStorage!.credentials.set("deepseek", { type: "api_key", key: "login-key", source: "login" });
			await expect(authStorage!.keys.get("deepseek")).resolves.toBe("login-key");
		});
	});

	test("removeConfig and clearConfig drop the mirror; setConfig without mirror replaces it", async () => {
		await withEnv(SUPPRESS_DEEPSEEK_ENV, async () => {
			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			authStorage!.keys.removeConfig("deepseek");
			await expect(authStorage!.keys.get("deepseek")).resolves.toBeUndefined();
			expect(authStorage!.keys.source("deepseek")).toBeUndefined();

			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			authStorage!.keys.clearConfig();
			await expect(authStorage!.keys.get("deepseek")).resolves.toBeUndefined();

			authStorage!.keys.setConfig("deepseek", "omp-upstream-key", { mirror: true });
			authStorage!.keys.setConfig("deepseek", "pinned-in-yml");
			await expect(authStorage!.keys.get("deepseek")).resolves.toBe("pinned-in-yml");
		});
	});
});
