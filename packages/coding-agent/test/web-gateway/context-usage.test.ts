/**
 * `GET /api/agent/:id/context` — the data source of the web-ui
 * context-statistics panel (`web-ui/components/context-ring/**`).
 *
 * These cases run against a REAL `AgentSession` (bundled model, real tokenizer,
 * real system prompt + tool schemas): the whole point of the route is that it
 * invents no accounting of its own, so a stub session would test nothing. What
 * is pinned here is the projection contract — the category partition, the
 * window arithmetic, and the route's liveness/method gate.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { getTestModel } from "../helpers/model-fixtures";
import { ModelRegistry } from "../../src/config/model-registry";
import { createAgentSession } from "../../src/sdk";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { AgentSessionWrapper, sessions } from "../../src/server/web-gateway/agents";
import {
	buildContextUsageReport,
	handleAgentContextUsage,
	type ContextUsageCategoryId,
	type ContextUsageReport,
} from "../../src/server/web-gateway/context-usage";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

/** Stable wire contract: the panel renders its legend in this order. */
const CATEGORY_ORDER: readonly ContextUsageCategoryId[] = [
	"systemPrompt",
	"systemTools",
	"systemContext",
	"skills",
	"messages",
];

let sharedDir: TempDir;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let previousAgentDir: string | undefined;
const liveSessions: AgentSession[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
	sharedDir = TempDir.createSync("@pi-gateway-context-");
	// Nothing in this file may touch the developer's real `~/.zeta/agent`: the
	// dispatcher resolves it from the env, and session/temp files follow it.
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	process.env.ZETA_CODING_AGENT_DIR = sharedDir.path();
	refreshDirsFromEnv();
	authStorage = await AuthStorage.create(path.join(sharedDir.path(), "auth.db"));
	authStorage.keys.setRuntime("anthropic", "test-key");
	modelRegistry = new ModelRegistry(authStorage, path.join(sharedDir.path(), "models.yml"));
});

afterAll(() => {
	authStorage.close();
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	refreshDirsFromEnv();
	// Best-effort, and deliberately NOT `TempDir.removeSync()`: on Windows the
	// registry's `models.db` handle stays open for the process lifetime
	// (`ModelRegistry` exposes no close), and `removeSyncWithRetries` would spin
	// on it long enough to trip the test runner's hook timeout. Deleting the
	// contents individually keeps the few locked files (and nothing else)
	// behind, with no temp-only data reaching `~/.zeta/agent`.
	for (const entry of fs.readdirSync(sharedDir.path())) {
		try {
			fs.rmSync(sharedDir.join(entry), { recursive: true, force: true });
		} catch {
			// locked by the process-wide registry connection
		}
	}
	try {
		fs.rmSync(sharedDir.path(), { force: true });
	} catch {
		// the locked models.db keeps the now-empty directory in place
	}
});

// Sessions are disposed (and only then their temp dirs removed) before the
// next case: a live session keeps its session file open, and Windows refuses
// to delete a directory out from under it.
afterEach(async () => {
	for (const session of liveSessions.splice(0)) await session.dispose();
	// `destroy()` deletes the entry it is iterating over, which Map iteration
	// tolerates; no snapshot array needed.
	for (const wrapper of sessions.values()) wrapper.destroy();
	sessions.clear();
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/** TempDir registered for removal after the case's sessions are disposed. */
function tempDir(prefix: string): TempDir {
	const dir = TempDir.createSync(prefix);
	cleanups.push(() => dir.removeSync());
	return dir;
}

/** Build a live wrapper registered in the gateway's session map, like `startRpcSession` does. */
async function startWrappedSession(dir: TempDir) {
	const model = getTestModel("anthropic");
	const contextWindow = model.contextWindow;
	if (typeof contextWindow !== "number" || contextWindow <= 0) {
		throw new Error(`Test fixture model ${model.provider}/${model.id} declares no context window`);
	}
	const sessionManager = SessionManager.create(dir.path(), undefined, undefined, { client: "web" });
	const { session } = await createAgentSession({
		cwd: dir.path(),
		agentDir: dir.path(),
		authStorage,
		modelRegistry,
		sessionManager,
		model,
		// In-memory settings: the default would open `<agentDir>/agent.db` and
		// keep it locked after dispose, making the temp dir unremovable.
		settings: Settings.isolated(),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	liveSessions.push(session);
	const wrapper = new AgentSessionWrapper(session, sessionManager.getSessionId(), null);
	sessions.set(sessionManager.getSessionId(), wrapper);
	return { wrapper, sessionId: sessionManager.getSessionId(), model, contextWindow };
}

describe("buildContextUsageReport", () => {
	test("projects the session's own accounting: window, categories, counters", async () => {
		const { wrapper, sessionId, model, contextWindow } = await startWrappedSession(
			tempDir("@pi-gateway-context-case-"),
		);
		const report = buildContextUsageReport(wrapper.getSession());

		expect(report.sessionId).toBe(sessionId);
		expect(report.model).toEqual({ provider: model.provider, modelId: model.id });
		expect(report.contextWindow).toBe(contextWindow);

		// Category ids are the stable wire contract, in legend order.
		expect(report.categories.map(category => category.id)).toEqual([...CATEGORY_ORDER]);

		// The category split partitions the used tokens; with an empty transcript
		// every token is non-message content.
		const categoryTotal = report.categories.reduce((sum, category) => sum + category.tokens, 0);
		expect(categoryTotal).toBe(report.usedTokens);
		const messagesTokens = report.categories.find(category => category.id === "messages")?.tokens ?? 0;
		expect(messagesTokens).toBe(0);
		// A default system prompt plus the default tool set must report real
		// occupancy, dominated by the tool schemas.
		const toolsTokens = report.categories.find(category => category.id === "systemTools")?.tokens ?? 0;
		expect(toolsTokens).toBeGreaterThan(0);

		expect(report.percent).toBeCloseTo((report.usedTokens / contextWindow) * 100, 10);

		// Fresh session: no usage, no calls, no spend.
		expect(report.usage).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
		expect(report.calls).toEqual({
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			premiumRequests: 0,
		});
		expect(report.cost).toBe(0);
		expect(report.autoCompactBufferTokens).toBeGreaterThanOrEqual(0);
		expect(report.freeTokens).toBeGreaterThan(0);
		const thresholdPercent = report.compaction.thresholdPercent;
		expect(report.compaction.enabled).toBe(report.compaction.thresholdTokens !== null);
		if (report.compaction.enabled) {
			expect(thresholdPercent).not.toBeNull();
			expect(thresholdPercent!).toBeGreaterThan(0);
			expect(thresholdPercent!).toBeLessThanOrEqual(100);
		}
	});

	test("budgets never exceed the window", async () => {
		const { wrapper } = await startWrappedSession(tempDir("@pi-gateway-context-budget-"));
		const report: ContextUsageReport = buildContextUsageReport(wrapper.getSession());
		for (const category of report.categories) expect(category.tokens).toBeGreaterThanOrEqual(0);
		expect(report.usedTokens).toBeGreaterThanOrEqual(
			report.categories.reduce((sum, category) => sum + category.tokens, 0),
		);
		expect(report.freeTokens + report.autoCompactBufferTokens + report.usedTokens).toBeLessThanOrEqual(
			report.contextWindow,
		);
	});
});

describe("GET /api/agent/:id/context", () => {
	test("serves the live session's context report", async () => {
		const { sessionId, contextWindow } = await startWrappedSession(tempDir("@pi-gateway-context-route-"));
		const response = handleAgentContextUsage(sessionId);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");

		const body = (await response.json()) as { running: boolean; context: ContextUsageReport };
		expect(body.running).toBe(true);
		expect(body.context.sessionId).toBe(sessionId);
		expect(body.context.contextWindow).toBe(contextWindow);
		expect(body.context.categories.map(category => category.id)).toEqual([...CATEGORY_ORDER]);
	});

	test("reports { running: false } for a session the gateway is not hosting", async () => {
		const response = handleAgentContextUsage("no-such-session");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ running: false });
	});

	test("is reachable through the gateway dispatcher and answers GET only", async () => {
		// `/api/agent/<id>/context` must not be swallowed by the single-segment id
		// route. (`beforeAll` already pointed the dispatcher's agent dir at a temp
		// dir, so this cannot reach the real `~/.zeta/agent`.)
		const getResponse = await webGatewayFetch(
			new Request("http://127.0.0.1/api/agent/no-such-session/context", { method: "GET" }),
			"127.0.0.1",
		);
		expect(getResponse.status).toBe(200);
		expect(await getResponse.json()).toEqual({ running: false });

		const postResponse = await webGatewayFetch(
			new Request("http://127.0.0.1/api/agent/no-such-session/context", { method: "POST" }),
			"127.0.0.1",
		);
		expect(postResponse.status).toBe(405);
	});
});
