/**
 * Memory read surface contract (`GET /api/agent/:id/memory`, `/memory/search`,
 * `/memory/items/:memId`).
 *
 * The five memory backends are deliberately asymmetric, so this suite pins the
 * two things a client must be able to trust:
 *
 * - the declared {@link MEMORY_CAPABILITIES} matrix (one row per backend), and
 * - the degradation path: an operation a backend cannot answer reports
 *   `supported: false` with an explicit `message` — never a bare empty result.
 *
 * Reserved write routes (`PATCH` item, `POST /memory`) must answer 501 without
 * needing a live session; the read routes answer 404 for sessions the gateway
 * cannot resolve.
 *
 * Backend reads are exercised against real sessions (the `context-usage.test.ts`
 * harness): `local` over a seeded memory root, `sharpshooter` over a seeded bank,
 * and `off`/`hindsight` as the two unsupported rows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { getTestModel } from "../helpers/model-fixtures";
import { ModelRegistry } from "../../src/config/model-registry";
import { getMemoryRoot } from "../../src/memories";
import type { MemoryBackendId } from "../../src/memory-backend/types";
import { createAgentSession } from "../../src/sdk";
import { webGatewayFetch } from "../../src/server/web-gateway";
import { AgentSessionWrapper, sessions } from "../../src/server/web-gateway/agents";
import { MEMORY_CAPABILITIES, type MemoryCapabilities } from "../../src/server/web-gateway/memory";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { sharpshooterBankDir } from "../../src/sharpshooter/paths";

/** Wire contract: the full 5-backend × 7-capability matrix. */
const EXPECTED_MATRIX: Record<MemoryBackendId, MemoryCapabilities> = {
	off: { list: false, search: false, item: false, files: false, write: false, archive: false, maintenance: false },
	local: { list: true, search: false, item: true, files: true, write: false, archive: false, maintenance: false },
	mnemopi: { list: true, search: true, item: true, files: false, write: false, archive: false, maintenance: false },
	sharpshooter: {
		list: true,
		search: true,
		item: false,
		files: false,
		write: false,
		archive: false,
		maintenance: false,
	},
	hindsight: {
		list: false,
		search: false,
		item: false,
		files: false,
		write: false,
		archive: false,
		maintenance: false,
	},
};

interface ListBody {
	backend: MemoryBackendId;
	supported: boolean;
	available?: boolean;
	capabilities: MemoryCapabilities;
	count: number;
	items: Array<{ id?: string; content: string; source?: string; kind?: string; truncated?: boolean }>;
	message?: string;
}

interface SearchBody {
	backend: MemoryBackendId;
	supported: boolean;
	capabilities: MemoryCapabilities;
	query: string;
	count: number;
	items: Array<{ id?: string; content: string; source?: string }>;
	message?: string;
}

interface ItemBody {
	backend: MemoryBackendId;
	supported: boolean;
	capabilities: MemoryCapabilities;
	item: { id: string; content: string; kind?: string } | null;
	message?: string;
	error?: string;
}

let sharedDir: TempDir;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let previousAgentDir: string | undefined;
const liveSessions: AgentSession[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
	sharedDir = TempDir.createSync("@pi-gateway-memory-");
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

afterEach(async () => {
	for (const session of liveSessions.splice(0)) await session.dispose();
	for (const wrapper of sessions.values()) wrapper.destroy();
	sessions.clear();
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDir(prefix: string): TempDir {
	const dir = TempDir.createSync(prefix);
	cleanups.push(() => dir.removeSync());
	return dir;
}

/** Live session registered in the gateway map with the requested memory backend. */
async function startMemorySession(dir: TempDir, backend: MemoryBackendId) {
	const model = getTestModel("anthropic");
	const sessionManager = SessionManager.create(dir.path(), undefined, undefined, { client: "web" });
	const { session } = await createAgentSession({
		cwd: dir.path(),
		agentDir: getAgentDir(),
		authStorage,
		modelRegistry,
		sessionManager,
		model,
		settings: Settings.isolated({ "memory.backend": backend }),
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
	const sessionId = sessionManager.getSessionId();
	sessions.set(sessionId, new AgentSessionWrapper(session, sessionId, null));
	return { sessionId, cwd: dir.path() };
}

function gatewayFetch(url: string, method = "GET"): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${url}`, { method }), "127.0.0.1");
}

describe("MEMORY_CAPABILITIES matrix", () => {
	test("declares exactly the documented capabilities for all five backends", () => {
		expect(MEMORY_CAPABILITIES).toEqual(EXPECTED_MATRIX);
	});

	test("models the asymmetry: local/search, sharpshooter/item, hindsight/everything", () => {
		expect(MEMORY_CAPABILITIES.local.search).toBe(false);
		expect(MEMORY_CAPABILITIES.local.files).toBe(true);
		expect(MEMORY_CAPABILITIES.mnemopi).toEqual({
			...EXPECTED_MATRIX.mnemopi,
			write: false,
		});
		expect(MEMORY_CAPABILITIES.sharpshooter.item).toBe(false);
		expect(Object.values(MEMORY_CAPABILITIES.hindsight)).toEqual(
			Array.from({ length: Object.keys(EXPECTED_MATRIX.hindsight).length }, () => false),
		);
	});

	test("no backend claims a write capability in the read-only batch", () => {
		for (const capabilities of Object.values(MEMORY_CAPABILITIES)) {
			expect(capabilities.write).toBe(false);
			expect(capabilities.archive).toBe(false);
			expect(capabilities.maintenance).toBe(false);
		}
	});
});

describe("reserved write routes", () => {
	test("PATCH /memory/items/:memId answers 501 without needing a session", async () => {
		const response = await gatewayFetch("/api/agent/no-such-session/memory/items/abc", "PATCH");
		expect(response.status).toBe(501);
		const body = (await response.json()) as { unsupported: boolean; error: string; message: string };
		expect(body.unsupported).toBe(true);
		expect(body.error).toContain("not implemented");
		expect(body.message.length).toBeGreaterThan(0);
	});

	test("POST /api/agent/:id/memory (maintenance) answers 501", async () => {
		const response = await gatewayFetch("/api/agent/no-such-session/memory", "POST");
		expect(response.status).toBe(501);
		const body = (await response.json()) as { unsupported: boolean };
		expect(body.unsupported).toBe(true);
	});
});

describe("dispatcher guards", () => {
	test("unknown session → 404 on list, search, and item", async () => {
		expect((await gatewayFetch("/api/agent/no-such-session/memory")).status).toBe(404);
		expect((await gatewayFetch("/api/agent/no-such-session/memory/search?q=x")).status).toBe(404);
		expect((await gatewayFetch("/api/agent/no-such-session/memory/items/x")).status).toBe(404);
	});

	test("search without `q` is rejected before any session work", async () => {
		const response = await gatewayFetch("/api/agent/no-such-session/memory/search");
		expect(response.status).toBe(400);
		expect((await response.json()) as { error: string }).toHaveProperty("error");
	});

	test("unsupported methods answer 405 (memory routes are not swallowed by /api/agent/:id)", async () => {
		expect((await gatewayFetch("/api/agent/no-such-session/memory", "DELETE")).status).toBe(405);
		expect((await gatewayFetch("/api/agent/no-such-session/memory/search", "POST")).status).toBe(405);
		expect((await gatewayFetch("/api/agent/no-such-session/memory/items/x", "DELETE")).status).toBe(405);
	});
});

describe("unsupported backends degrade explicitly", () => {
	for (const backend of ["off", "hindsight"] as const) {
		test(`${backend}: list, search, and item report supported:false with a message`, async () => {
			const { sessionId } = await startMemorySession(tempDir(`@pi-gateway-memory-${backend}-`), backend);

			const list = (await (await gatewayFetch(`/api/agent/${sessionId}/memory`)).json()) as ListBody;
			expect(list.backend).toBe(backend);
			expect(list.supported).toBe(false);
			expect(list.count).toBe(0);
			expect(list.items).toEqual([]);
			expect(list.message?.length ?? 0).toBeGreaterThan(0);
			expect(list.capabilities).toEqual(EXPECTED_MATRIX[backend]);

			const search = (await (
				await gatewayFetch(`/api/agent/${sessionId}/memory/search?q=anything`)
			).json()) as SearchBody;
			expect(search.supported).toBe(false);
			expect(search.count).toBe(0);
			expect(search.message?.length ?? 0).toBeGreaterThan(0);

			const item = (await (await gatewayFetch(`/api/agent/${sessionId}/memory/items/whatever`)).json()) as ItemBody;
			expect(item.supported).toBe(false);
			expect(item.item).toBeNull();
			expect(item.message?.length ?? 0).toBeGreaterThan(0);
		});
	}

	test("hindsight messages point at the remote service instead of an empty result", async () => {
		const { sessionId } = await startMemorySession(tempDir("@pi-gateway-memory-hs-msg-"), "hindsight");
		const list = (await (await gatewayFetch(`/api/agent/${sessionId}/memory`)).json()) as ListBody;
		const search = (await (await gatewayFetch(`/api/agent/${sessionId}/memory/search?q=db`)).json()) as SearchBody;
		expect(list.message).toContain("remote Hindsight service");
		expect(search.message).toContain("recall");
	});
});

describe("local backend: file list + item, no search", () => {
	test("lists the memory-root files, serves item content, rejects traversal, reports search unsupported", async () => {
		const dir = tempDir("@pi-gateway-memory-local-");
		const { sessionId, cwd } = await startMemorySession(dir, "local");
		const root = getMemoryRoot(getAgentDir(), cwd);
		fs.mkdirSync(path.join(root, "skills"), { recursive: true });
		fs.writeFileSync(path.join(root, "learned.md"), "# Lessons\n\n- always run the guards\n", "utf8");
		fs.writeFileSync(path.join(root, "skills", "note.md"), "skill note body\n", "utf8");

		const list = (await (await gatewayFetch(`/api/agent/${sessionId}/memory`)).json()) as ListBody;
		expect(list.supported).toBe(true);
		expect(list.capabilities.files).toBe(true);
		const ids = list.items.map(item => item.id);
		expect(ids).toContain("learned.md");
		expect(ids).toContain("skills/note.md");
		const learned = list.items.find(item => item.id === "learned.md");
		expect(learned?.kind).toBe("learned");
		expect(learned?.content).toContain("always run the guards");

		const item = (await (await gatewayFetch(`/api/agent/${sessionId}/memory/items/learned.md`)).json()) as ItemBody;
		expect(item.supported).toBe(true);
		expect(item.item?.id).toBe("learned.md");
		expect(item.item?.content).toBe("# Lessons\n\n- always run the guards\n");

		const nested = (await (
			await gatewayFetch(`/api/agent/${sessionId}/memory/items/skills%2Fnote.md`)
		).json()) as ItemBody;
		expect(nested.item?.content).toBe("skill note body\n");

		expect((await gatewayFetch(`/api/agent/${sessionId}/memory/items/..%2Fescape.md`)).status).toBe(404);

		const search = (await (
			await gatewayFetch(`/api/agent/${sessionId}/memory/search?q=guards`)
		).json()) as SearchBody;
		expect(search.supported).toBe(false);
		expect(search.count).toBe(0);
		expect(search.items).toEqual([]);
		expect(search.message).toContain("local backend");
	});

	test("clamps `limit` to 1..50 and ignores non-numeric values", async () => {
		const dir = tempDir("@pi-gateway-memory-limit-");
		const { sessionId, cwd } = await startMemorySession(dir, "local");
		const root = getMemoryRoot(getAgentDir(), cwd);
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, "learned.md"), "a\n", "utf8");
		fs.writeFileSync(path.join(root, "memory_summary.md"), "b\n", "utf8");

		const clamped = (await (await gatewayFetch(`/api/agent/${sessionId}/memory?limit=1`)).json()) as ListBody;
		expect(clamped.items.length).toBe(1);

		const junk = (await (await gatewayFetch(`/api/agent/${sessionId}/memory?limit=not-a-number`)).json()) as ListBody;
		expect(junk.items.length).toBe(2);
	});
});

describe("sharpshooter backend: line list + substring search, no item ids", () => {
	test("lists decision lines, searches them, and reports item lookup unsupported", async () => {
		const dir = tempDir("@pi-gateway-memory-ss-");
		const { sessionId, cwd } = await startMemorySession(dir, "sharpshooter");
		const bank = sharpshooterBankDir(getAgentDir(), cwd);
		fs.mkdirSync(bank, { recursive: true });
		fs.writeFileSync(path.join(bank, "architecture.md"), "Prefer boring designs\nNever shim\n", "utf8");
		fs.writeFileSync(path.join(bank, "product.md"), "Ship read surface first\n", "utf8");

		const list = (await (await gatewayFetch(`/api/agent/${sessionId}/memory`)).json()) as ListBody;
		expect(list.supported).toBe(true);
		expect(list.backend).toBe("sharpshooter");
		const ids = list.items.map(item => item.id);
		expect(ids).toContain("architecture.md#0");
		expect(ids).toContain("product.md#0");
		expect(list.items.find(item => item.id === "architecture.md#1")?.content).toBe("Never shim");

		const search = (await (
			await gatewayFetch(`/api/agent/${sessionId}/memory/search?q=boring`)
		).json()) as SearchBody;
		expect(search.supported).toBe(true);
		expect(search.count).toBe(1);
		expect(search.items[0].content).toBe("Prefer boring designs");
		expect(search.items[0].source).toBe("architecture.md");

		const item = (await (
			await gatewayFetch(`/api/agent/${sessionId}/memory/items/architecture.md%230`)
		).json()) as ItemBody;
		expect(item.supported).toBe(false);
		expect(item.message).toContain("sharpshooter");
	});
});
