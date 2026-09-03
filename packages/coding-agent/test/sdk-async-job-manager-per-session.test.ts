import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type } from "@linxiraos/pi-omptype";
import { removeSyncWithRetries, Snowflake } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAgentSession, type ExtensionFactory } from "@linxiraos/zeta/sdk";
import type { AsyncJobSnapshot } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";

describe("AsyncJobManager per top-level session (concurrent sessions)", () => {
	const tempDirs: string[] = [];
	// Building a ModelRegistry per session is the dominant cost here: createAgentSession
	// otherwise runs discoverAuthStorage (a fresh AuthStorage DB create+reload) and a
	// background online model refresh for every spawn (~450ms each). The per-session
	// ownership behavior under test is independent of model resolution, so we hand every
	// session one shared, network-free registry built once (~10ms/session instead).
	let sharedTempDir: string;
	let sharedAuthStorage: AuthStorage;
	let sharedModelRegistry: ModelRegistry;

	beforeAll(async () => {
		sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-async-per-session-shared-"));
		sharedAuthStorage = await AuthStorage.create(path.join(sharedTempDir, "auth.db"));
		sharedModelRegistry = new ModelRegistry(sharedAuthStorage, path.join(sharedTempDir, "models.yml"));
	});

	afterAll(() => {
		sharedAuthStorage.close();
		removeSyncWithRetries(sharedTempDir);
	});

	afterEach(async () => {
		for (const tempDir of tempDirs.splice(0)) {
			removeSyncWithRetries(tempDir);
		}
	});

	async function spawnTopLevelSession(extraSettings?: Record<string, unknown>, extensions: ExtensionFactory[] = []) {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-async-per-session-${Snowflake.next()}-`));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, `project-${Snowflake.next()}`);
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings: Settings.isolated({ "bash.autoBackground.enabled": true, ...extraSettings }),
			disableExtensionDiscovery: true,
			extensions,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			modelRegistry: sharedModelRegistry,
		});
		return session;
	}

	it("gives every concurrent top-level session its own independent manager", async () => {
		const primary = await spawnTopLevelSession();
		const secondary = await spawnTopLevelSession();
		try {
			const primaryManager = primary.asyncJobManager;
			const secondaryManager = secondary.asyncJobManager;
			expect(primaryManager).toBeDefined();
			expect(secondaryManager).toBeDefined();
			expect(secondaryManager).not.toBe(primaryManager);

			// Disposing the secondary must leave the primary's manager untouched and
			// still fully usable (previously the singleton contract demanded the
			// primary's manager stay installed; now ownership is per-session).
			await secondary.dispose();
			expect(primary.asyncJobManager).toBe(primaryManager);

			const release = Promise.withResolvers<string>();
			const jobId = primaryManager!.register(
				"bash",
				"sleep",
				async ({ signal }) => {
					const aborted = Promise.withResolvers<void>();
					signal.addEventListener("abort", () => aborted.resolve(), { once: true });
					await Promise.race([release.promise, aborted.promise]);
					return signal.aborted ? "aborted" : "completed";
				},
				{ ownerId: "Main" },
			);
			expect(primary.getAsyncJobSnapshot()?.running.some(job => job.id === jobId)).toBe(true);
			release.resolve("done");
			await primaryManager!.waitForAll();
		} finally {
			await primary.dispose();
		}
	}, 60000);

	it("does not cancel the primary session's running jobs when a secondary session disposes", async () => {
		const primary = await spawnTopLevelSession();
		try {
			const primaryManager = primary.asyncJobManager;
			expect(primaryManager).toBeDefined();

			// Register a long-running job on the primary's manager under the
			// MAIN_AGENT_ID owner. The secondary's dispose-time `cancelOwnAsyncJobs`
			// must NOT cancel this job (issue #1923); with per-session managers the
			// secondary never even sees it.
			const release = Promise.withResolvers<string>();
			const jobId = primaryManager!.register(
				"bash",
				"sleep",
				async ({ signal }) => {
					const aborted = Promise.withResolvers<void>();
					signal.addEventListener("abort", () => aborted.resolve(), { once: true });
					await Promise.race([release.promise, aborted.promise]);
					return signal.aborted ? "aborted" : "completed";
				},
				{ ownerId: "Main" },
			);
			expect(primary.getAsyncJobSnapshot()?.running.some(job => job.id === jobId)).toBe(true);

			const secondary = await spawnTopLevelSession();
			try {
				// The secondary has its own manager and a live snapshot — never a
				// nulled-out manager that reads only the primary's jobs.
				expect(secondary.asyncJobManager).toBeDefined();
				expect(secondary.asyncJobManager).not.toBe(primaryManager);
			} finally {
				await secondary.dispose();
			}

			const job = primaryManager!.getJob(jobId);
			expect(job?.status).toBe("running");

			release.resolve("done");
			await primaryManager!.waitForAll();
		} finally {
			await primary.dispose();
		}
	}, 60000);

	it("exposes the owning session's jobs through a production extension context", async () => {
		let observedSnapshot: AsyncJobSnapshot | null | undefined;
		const snapshotExtension: ExtensionFactory = pi => {
			pi.registerTool({
				name: "capture_async_job_snapshot",
				label: "Capture async job snapshot",
				description: "Capture the session-owned async job snapshot for this test.",
				parameters: type({}),
				approval: "read",
				async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
					observedSnapshot = ctx.getAsyncJobSnapshot();
					return { content: [{ type: "text", text: "captured" }] };
				},
			});
		};
		const session = await spawnTopLevelSession(undefined, [snapshotExtension]);
		const manager = session.asyncJobManager;
		expect(manager).toBeDefined();
		const release = Promise.withResolvers<string>();
		const jobId = manager!.register("bash", "extension snapshot test", async () => release.promise, {
			ownerId: "Main",
		});

		try {
			const snapshotTool = session.getToolByName("capture_async_job_snapshot");
			expect(snapshotTool).toBeDefined();
			await snapshotTool!.execute("call-snapshot", {});

			expect(observedSnapshot?.running.some(job => job.id === jobId)).toBe(true);
		} finally {
			release.resolve("done");
			await manager!.waitForAll();
			await session.dispose();
		}
	}, 60000);

	it("runs async bash on the secondary session's own manager instead of the primary's", async () => {
		const primary = await spawnTopLevelSession({ "async.enabled": true });
		try {
			const primaryManager = primary.asyncJobManager;
			expect(primaryManager).toBeDefined();
			const primaryJobCountBefore = primaryManager!.getAllJobs().length;

			const secondary = await spawnTopLevelSession({ "async.enabled": true });
			try {
				expect(secondary.asyncJobManager).toBeDefined();
				const bashTool = secondary.getToolByName("bash");
				expect(bashTool).toBeDefined();
				// Previously the secondary had no manager of its own and this call
				// rejected with "Async job manager unavailable". Now it runs on the
				// secondary's own manager and must not touch the primary's jobs.
				const result = await bashTool!.execute("call-1", { command: "echo hi", async: true });
				expect(result.content).toBeDefined();
			} finally {
				await secondary.dispose();
			}

			// The secondary's async execution must not have leaked a job into the
			// primary's manager.
			expect(primaryManager!.getAllJobs().length).toBe(primaryJobCountBefore);
		} finally {
			await primary.dispose();
		}
	}, 60000);

	it("keeps a live session's manager usable when an unrelated top-level session fails startup", async () => {
		const live = await spawnTopLevelSession();
		try {
			const liveManager = live.asyncJobManager;
			expect(liveManager).toBeDefined();

			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-async-startup-failure-${Snowflake.next()}-`));
			tempDirs.push(tempDir);
			const cwd = path.join(tempDir, `project-${Snowflake.next()}`);
			const agentDir = path.join(tempDir, "agent");
			fs.mkdirSync(cwd, { recursive: true });

			await expect(
				createAgentSession({
					cwd,
					agentDir,
					settings: Settings.isolated({ "bash.autoBackground.enabled": true }),
					disableExtensionDiscovery: true,
					skills: [],
					contextFiles: [],
					promptTemplates: [],
					slashCommands: [],
					enableMCP: false,
					enableLsp: false,
					modelRegistry: sharedModelRegistry,
					systemPrompt: () => {
						throw new Error("forced startup failure");
					},
				}),
			).rejects.toThrow("forced startup failure");

			// The failed session's own manager is disposed with it; the live
			// session's manager is untouched and still registered jobs fine.
			expect(live.asyncJobManager).toBe(liveManager);
			const release = Promise.withResolvers<string>();
			const jobId = liveManager!.register("bash", "still alive", async () => release.promise, {
				ownerId: "Main",
			});
			expect(live.getAsyncJobSnapshot()?.running.some(job => job.id === jobId)).toBe(true);
			release.resolve("done");
			await liveManager!.waitForAll();
		} finally {
			await live.dispose();
		}
	}, 60000);
});
