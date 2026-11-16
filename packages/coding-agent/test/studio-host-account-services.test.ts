import { afterEach, describe, expect, test } from "bun:test";
import { AuthStorage, type UsageReport } from "@linxiraos/pi-ai";
import { Settings } from "../src/config/settings";
import { AgentRegistry } from "../src/registry/agent-registry";
import type { AgentSession } from "../src/session/agent-session";
import type { AgentSessionHandle } from "../src/session/agent-session-handle";
import {
	ACCOUNT_ID_PATTERN,
	projectQuota,
	StudioAccountStatusService,
} from "../src/server/studio-host/services/account-status-service";
import {
	activateStudioExtensionLink,
	listStudioExtensionLinks,
} from "../src/server/studio-host/services/extension-links-service";
import { accountsOps } from "../src/server/studio-host/ops/accounts";
import type { StudioHostContext } from "../src/server/studio-host/registry";
import { StudioSearchCredentialsService } from "../src/server/studio-host/services/search-credentials-service";
import type { SearchCredentialStatus } from "../src/server/studio-host/protocol/contracts/search-credentials";

const stores: AuthStorage[] = [];
const env = {
	EXA_API_KEY: process.env.EXA_API_KEY,
	OLLAMA_CLOUD_API_KEY: process.env.OLLAMA_CLOUD_API_KEY,
};

afterEach(() => {
	for (const auth of stores.splice(0)) auth.close();
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	AgentRegistry.resetGlobalForTests();
});

async function store(): Promise<AuthStorage> {
	const auth = await AuthStorage.create(":memory:");
	stores.push(auth);
	return auth;
}

function searchSession(auth: AuthStorage, refreshes: string[] = []): AgentSession {
	return {
		sessionId: "chat",
		refreshScopedModels: async () => {},
		modelRegistry: {
			authStorage: auth,
			refreshProvider: async (provider: string) => {
				refreshes.push(provider);
			},
		},
	} as unknown as AgentSession;
}

describe("native search credentials", () => {
	test("reads metadata from the real AuthStorage without returning secret bytes", async () => {
		process.env.EXA_API_KEY = "environment-only-key";
		process.env.OLLAMA_CLOUD_API_KEY = "other-native-key";
		const auth = await store();
		await auth.credentials.upsert("exa", {
			type: "oauth",
			access: "oauth-access-secret",
			refresh: "oauth-refresh-secret",
			expires: Date.now() + 86_400_000,
			email: "exa@example.test",
		});
		await auth.credentials.upsert("exa", { type: "api_key", key: "native-key", source: "login" });
		const service = new StudioSearchCredentialsService(searchSession(auth));
		const listed = (await service.execute({
			kind: "search.credentials.list",
			sessionId: "chat",
			providers: ["exa", "ollama-cloud"],
		})) as { providers: SearchCredentialStatus[] };
		expect(listed.providers.map(row => row.provider)).toEqual(["exa", "ollama-cloud"]);
		expect(listed.providers[0]!.credentials.map(row => row.type).sort()).toEqual(["api_key", "oauth"]);
		expect(listed.providers[0]!.configured).toBe(true);
		expect(listed.providers[1]!.source).toBe("env");
		expect(listed.providers[1]!.envVar).toBe("OLLAMA_CLOUD_API_KEY");
		const wire = JSON.stringify(listed);
		for (const secret of [
			"environment-only-key",
			"other-native-key",
			"oauth-access-secret",
			"oauth-refresh-secret",
			"native-key",
		])
			expect(wire.includes(secret)).toBe(false);
	});

	test("live guard runs after native revalidation and before the native mutation", async () => {
		delete process.env.EXA_API_KEY;
		const auth = await store();
		const service = new StudioSearchCredentialsService(searchSession(auth));
		let calls = 0;
		await expect(
			service.execute(
				{ kind: "search.credentials.set", sessionId: "chat", provider: "exa", apiKey: "guarded-key" },
				() => {
					calls++;
					if (calls === 2) throw new Error("stale authority");
				},
			),
		).rejects.toThrow("stale authority");
		expect(auth.credentials.list("exa")).toEqual([]);
		expect(calls).toBe(2);

		await auth.credentials.upsert("ollama-cloud", { type: "api_key", key: "kept-key", source: "login" });
		const id = auth.credentials.list("ollama-cloud")[0]!.id;
		calls = 0;
		await expect(
			service.execute(
				{ kind: "search.credentials.remove", sessionId: "chat", provider: "ollama-cloud", credentialId: id },
				() => {
					calls++;
					// First call follows revalidate; second follows the native reload and
					// precedes removeById.
					if (calls === 2) throw new Error("stale authority");
				},
			),
		).rejects.toThrow("stale authority");
		expect(calls).toBe(2);
		expect(auth.credentials.list("ollama-cloud")).toHaveLength(1);
	});

	test("set and remove mutate the same native pool, preserve sibling OAuth, and reject stale/foreign targets", async () => {
		delete process.env.EXA_API_KEY;
		const auth = await store();
		await auth.credentials.upsert("exa", {
			type: "oauth",
			access: "sibling-access",
			refresh: "sibling-refresh",
			expires: Date.now() + 86_400_000,
			email: "sibling@example.test",
		});
		await auth.credentials.upsert("ollama-cloud", { type: "api_key", key: "ollama-key", source: "login" });
		const refreshes: string[] = [];
		const service = new StudioSearchCredentialsService(searchSession(auth, refreshes));

		const saved = (await service.execute({
			kind: "search.credentials.set",
			sessionId: "chat",
			provider: "exa",
			apiKey: "  native-key  ",
		})) as SearchCredentialStatus;
		expect(saved.credentials.map(row => row.type).sort()).toEqual(["api_key", "oauth"]);
		expect(auth.credentials.list("exa").find(row => row.credential.type === "api_key")?.credential).toMatchObject({
			key: "native-key",
			source: "login",
		});
		expect(refreshes).toEqual(["exa"]);
		expect(JSON.stringify(saved)).not.toContain("native-key");
		expect(JSON.stringify(saved)).not.toContain("sibling-access");

		const key = saved.credentials.find(row => row.type === "api_key")!;
		await service.execute({
			kind: "search.credentials.remove",
			sessionId: "chat",
			provider: "exa",
			credentialId: key.id,
		});
		expect(auth.credentials.list("exa").map(row => row.credential.type)).toEqual(["oauth"]);
		expect(refreshes).toEqual(["exa", "exa"]);
		await expect(
			service.execute({
				kind: "search.credentials.remove",
				sessionId: "chat",
				provider: "exa",
				credentialId: key.id,
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });

		const ollamaId = auth.credentials.list("ollama-cloud")[0]!.id;
		await service.execute({
			kind: "search.credentials.remove",
			sessionId: "chat",
			provider: "ollama-cloud",
			credentialId: ollamaId,
		});
		expect(auth.credentials.list("ollama-cloud")).toEqual([]);
		expect(await auth.keys.get("ollama-cloud")).toBeUndefined();

		await expect(
			service.execute({
				kind: "search.credentials.list",
				sessionId: "foreign",
				providers: ["exa"],
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			service.execute({
				kind: "search.credentials.set",
				sessionId: "chat",
				provider: "google-gemini-cli",
				apiKey: "not-allowed",
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			service.execute({
				kind: "search.credentials.list",
				sessionId: "chat",
				providers: ["not-a-search-provider"],
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});

describe("read-only native account status", () => {
	test("projects the real OAuth pool, rejects foreign/stale logout, and removes the exact credential", async () => {
		const auth = await store();
		await auth.credentials.upsert("anthropic", {
			type: "oauth",
			access: "access-one",
			refresh: "refresh-one",
			expires: Date.now() + 86_400_000,
			email: "same@example.test",
			accountId: "shared",
			orgId: "org-one",
			orgName: "One",
		});
		await auth.credentials.upsert("anthropic", {
			type: "oauth",
			access: "access-two",
			refresh: "refresh-two",
			expires: Date.now() + 86_400_000,
			email: "same@example.test",
			accountId: "shared",
			orgId: "org-two",
			orgName: "Two",
		});
		const credentialIds = auth.credentials.list("anthropic").map(row => row.id);
		expect(credentialIds).toHaveLength(2);

		let reportsCalls = 0;
		let resetsCalls = 0;
		let redeems = 0;
		const usage = {
			invalidate: async () => {},
			reports: async () => {
				reportsCalls++;
				return [
					{
						provider: "anthropic",
						fetchedAt: 10,
						metadata: { accountId: "shared" },
						raw: { token: "private-report-bytes" },
						limits: [
							{
								id: "weekly",
								label: "Weekly",
								scope: { provider: "anthropic" },
								amount: { unit: "percent", used: 75 },
							},
						],
					},
				] satisfies UsageReport[];
			},
		};
		const resets = {
			list: async () => {
				resetsCalls++;
				return [
					{
						provider: "anthropic",
						credentialId: credentialIds[0]!,
						active: true,
						availableCount: 2,
						credits: [
							{
								id: "private-credit-id",
								title: "Saved reset",
								remainingCount: 2,
								usable: true,
								clears: ["weekly"],
							},
						],
					},
				];
			},
			redeem: async () => {
				redeems++;
				throw new Error("must never redeem");
			},
		};
		const authView = {
			credentials: auth.credentials,
			keys: auth.keys,
			oauth: auth.oauth,
			usage,
			resets,
		};
		const session = {
			sessionId: "session",
			settings: Settings.isolated(),
			modelRegistry: { authStorage: authView, getAvailable: () => [] },
		} as unknown as AgentSession;
		const service = new StudioAccountStatusService(session);

		const cold = await service.get(false);
		expect(reportsCalls).toBe(0);
		expect(cold.accounts).toHaveLength(2);
		expect(cold.accounts.every(account => account.resets.state === "unfetched")).toBe(true);
		expect(new Set(cold.accounts.map(account => account.id)).size).toBe(2);
		expect(cold.accounts.every(account => ACCOUNT_ID_PATTERN.test(account.id))).toBe(true);

		const [refreshed] = await Promise.all([service.get(true), service.get(true)]);
		expect(reportsCalls).toBe(1);
		expect(resetsCalls).toBe(1);
		expect(redeems).toBe(0);
		expect(refreshed.accounts.every(account => account.limits.length === 0)).toBe(true);
		expect(refreshed.unassigned[0]?.limits[0]?.usedFraction).toBe(0.75);
		expect(refreshed.accounts.some(account => account.resets.availableCount === 2)).toBe(true);
		const wire = JSON.stringify(refreshed);
		for (const secret of [
			"access-one",
			"access-two",
			"refresh-one",
			"refresh-two",
			"private-report-bytes",
			"private-credit-id",
			'"credentialId"',
			'"raw"',
		])
			expect(wire.includes(secret)).toBe(false);

		const second = refreshed.accounts.find(account => account.id !== cold.accounts[0]!.id)!;
		await expect(service.logout("foreign", second.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
		expect(auth.credentials.list("anthropic")).toHaveLength(2);
		await expect(service.logout("session", "account-not-a-real-id")).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});
		expect(await service.logout("session", second.id)).toEqual({ loggedOut: true });
		expect(auth.credentials.list("anthropic").map(row => row.id)).toEqual([credentialIds[0]!]);
		expect((await service.get()).accounts).toHaveLength(1);
		await expect(service.logout("session", second.id)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		service.dispose();
	});

	test("pool methods expose the real OAuth identities and persist one agent entry", async () => {
		const auth = await store();
		await auth.credentials.upsert("anthropic", {
			type: "oauth",
			access: "pool-access",
			refresh: "pool-refresh",
			expires: Date.now() + 86_400_000,
			email: "pool@example.test",
			orgId: "org-pool",
			orgName: "Pool Org",
		});
		const session = {
			sessionId: "session",
			settings: Settings.isolated(),
			modelRegistry: { authStorage: auth, getAvailable: () => [] },
		} as unknown as AgentSession;
		const service = new StudioAccountStatusService(session);
		const options = service.poolOptions();
		expect(options.truncated).toBe(false);
		expect(options.accounts).toEqual([
			{
				provider: "anthropic",
				identityKey: "email:pool@example.test|org:org-pool",
				label: "email:pool@example.test|org:org-pool · Pool Org",
			},
		]);
		expect(service.poolGet()).toEqual({ global: {}, effective: {} });
		const identityKey = options.accounts[0]!.identityKey;
		const written = await service.poolSet("worker", { anthropic: [identityKey] });
		expect(written.global.worker?.anthropic).toEqual([identityKey]);
		expect(service.poolGet().effective.worker?.anthropic).toEqual([identityKey]);
		service.dispose();
	});

	test("pool projections keep a prototype-named agent as an own entry", async () => {
		const auth = await store();
		const pools = JSON.parse('{"__proto__":{"anthropic":["email:pool@example.test"]}}') as Record<
			string,
			Record<string, string[]>
		>;
		const session = {
			sessionId: "session",
			settings: Settings.isolated({ "task.agentAccountPools": pools }),
			modelRegistry: { authStorage: auth, getAvailable: () => [] },
		} as unknown as AgentSession;
		const service = new StudioAccountStatusService(session);
		const projected = service.poolGet();
		expect(Object.getPrototypeOf(projected.global)).toBeNull();
		expect(Object.getPrototypeOf(projected.effective)).toBeNull();
		expect(Object.hasOwn(projected.effective, "__proto__")).toBe(true);
		expect(projected.effective["__proto__"]?.anthropic).toEqual(["email:pool@example.test"]);
		expect(JSON.stringify(projected)).toContain('"__proto__"');
		service.dispose();
	});

	test("quota details are opt-in while the compact status response stays stable", () => {
		const report = {
			provider: "anthropic",
			fetchedAt: 123,
			limits: [
				{
					id: "weekly",
					label: "Weekly",
					scope: {
						provider: "anthropic",
						projectId: "project",
						orgId: "organization",
						shared: true,
						sharedGroup: "group",
						tier: "low_priority",
					},
					amount: { unit: "percent" as const, usedFraction: 0.8 },
					notes: ["Lower priority allowance"],
					window: { id: "7d", label: "Weekly", resetsAt: 900, resetLabel: "regen" },
				},
			],
		} satisfies UsageReport;
		const legacy = projectQuota(report)[0]!;
		expect("scope" in legacy).toBe(false);
		expect("notes" in legacy).toBe(false);
		expect("resetLabel" in legacy).toBe(false);
		expect(projectQuota(report, true)[0]).toMatchObject({
			scope: report.limits[0]!.scope,
			notes: ["Lower priority allowance"],
			resetLabel: "regen",
			resetsAt: 900,
		});
	});
});

describe("command input envelopes", () => {
	test("builders accept CommandInput without kind and validate pool entries", async () => {
		const commands = accountsOps.commands;
		const context: StudioHostContext = {
			capabilities: {
				profile: "limited",
				generatedAt: "2026-01-01T00:00:00.000Z",
				hash: "test",
				capabilities: [],
			},
			privateOwner: { id: "test", expiresAt: Date.now() + 60_000, isLive: () => true },
		};
		await expect(
			commands["search.credentials.list"]({ sessionId: "chat", providers: ["exa"] }, context),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			commands["search.credentials.set"]({ sessionId: "chat", provider: "exa", apiKey: "test-key" }, context),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			commands["search.credentials.remove"]({ sessionId: "chat", provider: "exa", credentialId: 1 }, context),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(commands["accounts.status"]({ refresh: false }, context)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		await expect(
			commands["accounts.logout"](
				{ sessionId: "chat", accountId: "account-0123456789abcdef0123456789abcdef" },
				context,
			),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(commands["accounts.pool.options"]({ sessionId: "chat" }, context)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		await expect(commands["accounts.pool.get"]({ sessionId: "chat" }, context)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		await expect(
			commands["accounts.pool.set"](
				{ sessionId: "chat", agent: "worker", pools: { anthropic: ["email:pool@example.test"] } },
				context,
			),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			commands["extensions.links.activate"]({ sessionId: "chat", url: "studio-test:details/1" }, context),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });

		await expect(
			commands["accounts.pool.set"](
				{ sessionId: "chat", agent: "worker", pools: { anthropic: "not-an-array" } },
				context,
			),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			commands["accounts.pool.set"]({ sessionId: "chat", agent: "worker" }, context),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			commands["accounts.pool.set"]({ sessionId: "chat", agent: "", pools: null }, context),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});

describe("native extension links", () => {
	function fakeRunner(schemes: string[], calls: Array<{ url: string; ui: unknown }>) {
		return {
			getLinkSchemes: () => schemes,
			getUIContext: () => ({ kind: "fake-ui" }),
			emitLinkActivate: async (url: string, ui?: unknown) => {
				calls.push({ url, ui });
				return schemes.includes(url.slice(0, url.indexOf(":")).toLowerCase());
			},
		};
	}
	function viewSession(
		id: string,
		runner: {
			getLinkSchemes(): string[];
			getUIContext(): unknown;
			emitLinkActivate(url: string, ui?: unknown): Promise<boolean>;
		},
		home?: { schemes: string[]; calls: string[] },
	): AgentSessionHandle {
		return {
			sessionId: id,
			instanceKey: `thread:${id}`,
			isDisposed: false,
			sessionManager: { getSessionId: () => id },
			activeToolExecutionUpdates: () => [],
			extensionRunner: runner,
			...(home
				? {
						getStudioLinkSchemes: () => home.schemes,
						activateStudioLink: async (url: string) => {
							home.calls.push(url);
							return home.schemes.includes(url.slice(0, url.indexOf(":")).toLowerCase());
						},
					}
				: {
						getStudioLinkSchemes: () => runner.getLinkSchemes(),
						activateStudioLink: (url: string) => runner.emitLinkActivate(url, runner.getUIContext()),
					}),
		} as unknown as AgentSessionHandle;
	}

	test("lists only owned/registered schemes and dispatches only to the owned agent target", async () => {
		const mainCalls: Array<{ url: string; ui: unknown }> = [];
		const mirrorCalls: Array<{ url: string; ui: unknown }> = [];
		const homeCalls: string[] = [];
		const mainRunner = fakeRunner(["main-link"], mainCalls);
		// The worker mirror intentionally exposes the ancestor's scheme; the
		// child's home-thread surface owns the real one.
		const childMirror = fakeRunner(["ancestor-only"], mirrorCalls);
		const main = viewSession("main", mainRunner);
		const child = viewSession("child-session", childMirror, { schemes: ["studio-test"], calls: homeCalls });
		const registry = AgentRegistry.global();
		registry.register({ id: "main", displayName: "Main", kind: "main", session: main });
		registry.register({ id: "worker", displayName: "Worker", kind: "sub", parentId: "main", session: child });

		const mainTarget = { sessionId: "main" };
		expect(listStudioExtensionLinks(main as unknown as AgentSession, mainTarget)).toEqual({
			schemes: ["main-link"],
		});
		expect(
			listStudioExtensionLinks(main as unknown as AgentSession, {
				sessionId: "main",
				agentId: "worker",
				sourceSessionId: "child-session",
			}),
		).toEqual({ schemes: ["studio-test"] });
		expect(
			listStudioExtensionLinks(main as unknown as AgentSession, {
				sessionId: "main",
				agentId: "worker",
				sourceSessionId: "main",
			}),
		).toEqual({ schemes: [] });
		expect(
			listStudioExtensionLinks(main as unknown as AgentSession, {
				sessionId: "main",
				agentId: "not-owned",
			}),
		).toEqual({ schemes: [] });

		expect(
			await activateStudioExtensionLink(main as unknown as AgentSession, {
				kind: "extensions.links.activate",
				sessionId: "main",
				agentId: "worker",
				sourceSessionId: "child-session",
				url: "studio-test:details/1",
			}),
		).toEqual({ handled: true });
		expect(homeCalls).toEqual(["studio-test:details/1"]);
		expect(mirrorCalls).toHaveLength(0);

		expect(
			await activateStudioExtensionLink(main as unknown as AgentSession, {
				kind: "extensions.links.activate",
				sessionId: "main",
				agentId: "worker",
				sourceSessionId: "child-session",
				url: "ancestor-only:run",
			}),
		).toEqual({ handled: false });
		expect(homeCalls).toHaveLength(1);
		expect(mirrorCalls).toHaveLength(0);

		expect(
			await activateStudioExtensionLink(main as unknown as AgentSession, {
				kind: "extensions.links.activate",
				sessionId: "main",
				url: "main-link:run",
			}),
		).toEqual({ handled: true });
		expect(mainCalls).toHaveLength(1);

		await expect(
			activateStudioExtensionLink(main as unknown as AgentSession, {
				kind: "extensions.links.activate",
				sessionId: "main",
				agentId: "not-owned",
				url: "studio-test:details/1",
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			activateStudioExtensionLink(main as unknown as AgentSession, {
				kind: "extensions.links.activate",
				sessionId: "foreign",
				url: "studio-test:details/1",
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		expect(homeCalls).toHaveLength(1);
		expect(mirrorCalls).toHaveLength(0);
		expect(mainCalls).toHaveLength(1);
	});
});
