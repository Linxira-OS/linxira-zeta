/**
 * A /resume navigation pins Vibe workers to their source transcript instead of
 * cancelling them. Queued follow-ups, in-flight turn jobs, and the source write
 * serializer must all survive the pin/reattach cycle.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Snowflake, TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { VibeSessionRegistry } from "@linxiraos/zeta/vibe/runtime";

describe("Vibe source pinning across /resume", () => {
	afterEach(() => {
		VibeSessionRegistry.resetGlobalForTests();
	});

	it("keeps a queued follow-up and the in-flight turn across pin and reattach", async () => {
		using tempDir = TempDir.createSync("@pi-vibe-source-pin-");
		const source = SessionManager.create(tempDir.path(), tempDir.path());
		source.appendMessage({ role: "user", content: "director session", timestamp: 1 });
		await source.ensureOnDisk();
		const sourceId = source.getSessionId();
		const rawSourceFile = source.getSessionFile();
		if (!rawSourceFile) throw new Error("Expected a persisted source session");
		const sourceFile = path.resolve(rawSourceFile);

		const registry = VibeSessionRegistry.global();
		const toolSession = {
			cwd: tempDir.path(),
			hasUI: false,
			getAgentId: () => "Main",
			getSessionId: () => sourceId,
			getSessionFile: () => sourceFile,
			sessionManager: source,
			settings: Settings.isolated(),
		} as unknown as ToolSession;
		const workerId = `source-pin-${Snowflake.next()}`;
		registry.registerRecordForTests({
			id: workerId,
			ownerId: "Main",
			parentSessionId: sourceId,
			parentSessionFile: sourceFile,
			childSessionFile: `${workerId}.jsonl`,
			jobId: `${workerId}-t1`,
		});

		expect(await registry.send(toolSession, { session: workerId, message: "queued while streaming" })).toMatchObject({
			mode: "queued",
		});
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(1);

		const scope = registry.ownerScope(toolSession);
		registry.pinScopeToSource(scope, {
			parentSessionId: sourceId,
			parentSessionFile: sourceFile,
			leafId: source.getLeafId(),
			sessionManager: source,
		});

		// Pinning does not clear the queue or the in-flight turn.
		expect(registry.hasPendingWorkForTranscript(sourceId, sourceFile)).toBe(true);
		expect(await registry.send(toolSession, { session: workerId, message: "queued after pin" })).toMatchObject({
			mode: "queued",
		});
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(2);

		// Returning to the source reattaches the same live record; nothing was
		// tombstoned and the queued directives remain for the next turn.
		const reattached = registry.reattachScopeToLive(sourceId, sourceFile);
		expect(reattached).toBe(1);
		expect(registry.listIds(toolSession)).toContain(workerId);
		expect(registry.screens(toolSession, [workerId])[0]?.queued).toBe(2);
		expect(registry.hasPendingWorkForTranscript(sourceId, sourceFile)).toBe(true);
		await source.close();
	});

	it("does not pin records whose parent transcript is different", async () => {
		using tempDir = TempDir.createSync("@pi-vibe-source-scope-");
		const registry = VibeSessionRegistry.global();
		const workerId = `source-miss-${Snowflake.next()}`;
		registry.registerRecordForTests({
			id: workerId,
			ownerId: "Main",
			parentSessionId: "source-a",
			parentSessionFile: tempDir.join("a.jsonl"),
			jobId: `${workerId}-t1`,
		});
		const scope = { ownerId: "Main", parentSessionId: "source-b", parentSessionFile: tempDir.join("b.jsonl") };
		expect(registry.pinScopeToSource(scope, {
			parentSessionId: "source-b",
			parentSessionFile: tempDir.join("b.jsonl"),
			sessionManager: SessionManager.inMemory(tempDir.path()),
		})).toBe(0);
		expect(registry.reattachScopeToLive("source-b", tempDir.join("b.jsonl"))).toBe(0);
		expect(registry.hasPendingWorkForTranscript("source-a", tempDir.join("a.jsonl"))).toBe(true);
	});
});
