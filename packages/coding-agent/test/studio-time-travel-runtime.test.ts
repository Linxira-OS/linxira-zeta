import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";
import { StudioTimeTravelBoundary } from "../src/server/studio-host/services/time-travel-boundary";
import { TimeTravelService } from "../src/server/studio-host/services/time-travel-service";
import { timeTravelTimeline } from "../src/server/studio-host/services/time-travel-timeline";
import { lockWorkspaceRestore } from "../src/session/workspace-restore";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

setDefaultTimeout(30_000);

async function fixture() {
	const root = await mkdtemp(fileURLToPath(new URL("../../../temp/zeta-time-travel-runtime-", import.meta.url)));
	const workspace = join(root, "workspace");
	await mkdir(workspace);
	execFileSync("git", ["init", "-q", workspace], { windowsHide: true });
	const auth = createInMemoryAuthStorage();
	auth.keys.setRuntime("anthropic", "test-only");
	const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	let count = 0;
	const provider = createMockModel({
		id: model.id,
		provider: model.provider,
		handler: async () => {
			await writeFile(join(workspace, "answer.txt"), String(++count));
			return { content: ["done"] };
		},
	});
	const agent = new Agent({
		initialState: { model, systemPrompt: [], tools: [] },
		convertToLlm,
		getApiKey: () => "test-only",
		streamFn: provider.stream,
	});
	const manager = SessionManager.create(workspace, join(root, "sessions"));
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false, "retry.enabled": false, "todo.enabled": false }),
		modelRegistry: new ModelRegistry(auth, join(root, "models.yml")),
	});
	const service = new TimeTravelService(join(root, "profile"));
	await service.updateSettings({ enabled: true });
	const boundary = new StudioTimeTravelBoundary(session, service);
	session.setBeforeNextUserTurn(() => boundary.capture("before"));
	session.setAfterUserTurn(() => boundary.capture("after"));
	return {
		root,
		workspace,
		agent,
		manager,
		session,
		service,
		boundary,
		async close() {
			boundary.dispose();
			await session.dispose();
			auth.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}

test("native turns await real snapshots; exact persisted restore retains later branches and the empty root", async () => {
	const f = await fixture();
	try {
		await f.session.prompt("first");
		await f.session.prompt("later");
		const points = await f.service.list(f.workspace, f.session.sessionId);
		expect(points.map(point => point.phase)).toEqual(["before", "after", "before", "after"]);
		const first = points[1]!,
			later = points[3]!;
		const preview = await f.service.preview(f.workspace, f.session.sessionId, first.id);
		await f.service.withRestore(async store =>
			f.session.withWorkspaceRestore(async () => {
				const result = await store.restore({
					workspace: f.workspace,
					sessionId: f.session.sessionId,
					snapshotId: first.id,
					expectedRevision: preview.revision,
					leafId: later.leafId,
				});
				expect(result.restored).toBe(true);
				expect(await f.session.restoreTreeLeaf(first.leafId)).toBe(true);
			}),
		);
		expect(await readFile(join(f.workspace, "answer.txt"), "utf8")).toBe("1");
		expect(f.session.messages.filter(message => message.role === "user")).toHaveLength(1);
		let reopened = await SessionManager.open(f.manager.getSessionFile()!, undefined, undefined, {
			suppressBreadcrumb: true,
		});
		expect(reopened.getLeafId()).toBe(first.leafId);
		expect(reopened.getEntry(later.leafId!)).toBeDefined();
		await reopened.close();
		await f.session.withWorkspaceRestore(async () => {
			expect(await f.session.restoreTreeLeaf(null)).toBe(true);
		});
		reopened = await SessionManager.open(f.manager.getSessionFile()!, undefined, undefined, {
			suppressBreadcrumb: true,
		});
		expect(reopened.getLeafId()).toBeNull();
		expect(reopened.buildSessionContext().messages).toEqual([]);
		expect(reopened.getEntry(later.leafId!)).toBeDefined();
		await reopened.close();
	} finally {
		await f.close();
	}
});

test("queued follow-ups and interruption retain separate before/after filesystem boundaries", async () => {
	const f = await fixture();
	try {
		const yielded = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>();
		let first = true;
		f.agent.setOnBeforeYield(async () => {
			if (first) {
				first = false;
				yielded.resolve();
				await release.promise;
			}
		});
		const running = f.session.prompt("queue origin");
		await yielded.promise;
		await f.session.prompt("follow up", { streamingBehavior: "followUp" });
		release.resolve();
		await running;
		await f.session.waitForIdle();
		expect((await f.service.list(f.workspace, f.session.sessionId)).map(point => point.phase)).toEqual([
			"before",
			"after",
			"before",
			"after",
		]);
		const interrupted = Promise.withResolvers<void>(),
			finish = Promise.withResolvers<void>();
		f.agent.setOnBeforeYield(async () => {
			interrupted.resolve();
			await finish.promise;
		});
		const turn = f.session.prompt("interrupt");
		await interrupted.promise;
		const stopping = f.session.abort();
		finish.resolve();
		await Promise.all([turn, stopping]);
		await f.session.waitForIdle();
		expect((await f.service.list(f.workspace, f.session.sessionId)).slice(-2).map(point => point.phase)).toEqual([
			"before",
			"after",
		]);
	} finally {
		await f.close();
	}
});

test("restore fences deny newly admitted prompt/bash/eval work and timeline cursors reject changed branches", async () => {
	const f = await fixture();
	try {
		await f.session.prompt("first");
		await f.session.withWorkspaceRestore(async () => {
			await expect(f.session.prompt("must not run")).rejects.toThrow("restore");
			expect(() => f.session.executeBash("echo must-not-run")).toThrow("restore");
			expect(() => f.session.assertEvalExecutionAllowed()).toThrow("restore");
		});
		using _workspace = lockWorkspaceRestore(f.workspace);
		await expect(f.session.prompt("workspace blocked")).rejects.toThrow("restore");
		const entries = Array.from({ length: 125 }, (_, index) => ({
			type: "message" as const,
			id: String(index),
			parentId: index ? String(index - 1) : null,
			timestamp: new Date(index).toISOString(),
			message: {
				role: "user" as const,
				content: [{ type: "text" as const, text: String(index) }],
				timestamp: index,
			},
		}));
		const page = timeTravelTimeline("a", entries, "124", {});
		expect(page.events[0]?.id).toBe("5");
		expect(
			timeTravelTimeline("a", entries, "124", { cursor: page.olderCursor! }).events.map(event => event.id),
		).toEqual(["0", "1", "2", "3", "4"]);
		expect(() => timeTravelTimeline("b", entries, "124", { cursor: page.olderCursor! })).toThrow("Timeline changed");
	} finally {
		await f.close();
	}
});
