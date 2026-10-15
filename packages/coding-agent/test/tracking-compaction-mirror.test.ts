/**
 * Project-tracking compaction mirror: every committed compaction summary must
 * land in `<project>/.zeta/tracking/summaries/compaction-<ts>.md` while
 * `tracking.enabled` is on, and nothing at all may be written (not even the
 * directory) while it is off.
 *
 * `TrackingRecorder.recordCompaction` implemented the write from the start but
 * had no production call site, so these assertions failed against the
 * pre-wiring tree: the summary stayed inside the session transcript and the
 * Web UI Summaries tab reported an empty directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import * as compactionModule from "@linxiraos/pi-agent-core/compaction";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { getProjectTrackingDir, TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";

import { assistantMsg, userMsg } from "./utilities";

const COMPACTION_SETTINGS = { "compaction.keepRecentTokens": 1, "compaction.methodOrder": ["soft"] } as const;

describe("tracking compaction mirror", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage | undefined;
	let session: AgentSession | undefined;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-tracking-compaction-");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await session?.dispose().catch(() => {});
		session = undefined;
		authStorage?.close();
		authStorage = undefined;
		tempDir.removeSync();
	});

	async function startSession(settings: Settings): Promise<AgentSession> {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) throw new Error("Expected bundled gpt-4o-mini model");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.keys.setRuntime(model.provider, "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		const created = new AgentSession({
			agent: new Agent({
				initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			}),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings,
			modelRegistry,
		});
		created.subscribe(() => {});
		for (const [question, answer] of [
			["first question", "first answer"],
			["second question", "second answer"],
		] as const) {
			const user = userMsg(question);
			const assistant = assistantMsg(answer);
			created.agent.appendMessage(user);
			created.sessionManager.appendMessage(user);
			created.agent.appendMessage(assistant);
			created.sessionManager.appendMessage(assistant);
		}
		return created;
	}

	/** Commit a compaction without a provider round-trip. */
	function stubCommittedSummary(summary: string): void {
		vi.spyOn(compactionModule, "compact").mockImplementation(async (preparation, model) => ({
			summary,
			shortSummary: summary,
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: 10,
			details: { provider: model.provider },
		}));
	}

	function summariesDir(): string {
		return path.join(getProjectTrackingDir(tempDir.path()), "summaries");
	}

	it("writes the committed summary into summaries/ when tracking is enabled", async () => {
		session = await startSession(Settings.isolated({ "tracking.enabled": true, ...COMPACTION_SETTINGS }));
		stubCommittedSummary("mirrored summary body");

		await session.compact();

		const files = await fsp.readdir(summariesDir());
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^compaction-\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/);
		expect(await fsp.readFile(path.join(summariesDir(), files[0]!), "utf8")).toContain("mirrored summary body");
	});

	it("writes nothing and creates no directory when tracking is disabled", async () => {
		session = await startSession(Settings.isolated({ ...COMPACTION_SETTINGS }));
		stubCommittedSummary("ignored summary");

		await session.compact();

		expect(fs.existsSync(summariesDir())).toBe(false);
	});
});
