import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import type { AgentSession } from "../src/session/agent-session";
import type { StudioBtwSnapshot } from "../src/server/studio-host/services/btw-service";
import { StudioMainBtwRuntime } from "../src/server/studio-host/services/main-btw-runtime";
import { StudioResourceService } from "../src/server/studio-host/services/resource-service";
import { StudioSessionOptionsService } from "../src/server/studio-host/services/session-options-service";
import { StudioRuntimeUtilityService } from "../src/server/studio-host/services/runtime-utility-service";
import { SessionManager } from "../src/session/session-manager";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "studio-utilities-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

interface FakeBtwSession {
	session: AgentSession;
	readonly injected: string[];
	readonly branch: ReturnType<typeof vi.fn>;
	setSessionId(id: string): void;
}

function btwSession(artifacts: string): FakeBtwSession {
	let sessionId = "session-a";
	let leafId: string | null = "leaf-a";
	const injected: string[] = [];
	const answer = "Status ok.\n<inject>Steer the next turn</inject>";
	const assistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: answer }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	} satisfies AssistantMessage;
	const branch = vi.fn(async () => {
		sessionId = "session-b";
		leafId = "leaf-b";
		return { cancelled: false };
	});
	const session = {
		sessionId,
		model: { provider: "anthropic", id: "test-model", api: "anthropic-messages", name: "Test" },
		isStreaming: false,
		sessionManager: {
			getSessionId: () => sessionId,
			getLeafId: () => leafId,
			ensureOnDisk: async () => {},
			getArtifactsDir: () => artifacts,
			getCwd: () => artifacts,
			getSessionFile: () => path.join(artifacts, "session.jsonl"),
		},
		runEphemeralTurn: async (options: { onTextDelta?: (delta: string) => void }) => {
			options.onTextDelta?.("Status ok.\n");
			options.onTextDelta?.("<inject>Steer the next turn</inject>");
			return { replyText: answer, assistantMessage };
		},
		branchFromBtw: branch,
	} as unknown as AgentSession;
	return {
		session,
		injected,
		branch,
		setSessionId(id) {
			sessionId = id;
		},
	};
}

function runtimeFor(fake: FakeBtwSession): StudioMainBtwRuntime {
	return new StudioMainBtwRuntime(fake.session, {
		injectEnabled: () => true,
		sendInjection: async text => {
			fake.injected.push(text);
		},
	});
}

describe("main BTW runtime", () => {
	it("persists a completed answer, adopts its inject block, and branches through native history", async () => {
		const artifacts = await temporaryDirectory();
		const fake = btwSession(artifacts);
		const runtime = runtimeFor(fake);
		const completed = Promise.withResolvers<StudioBtwSnapshot>();
		const unsubscribe = runtime.onChange(snapshot => {
			if (snapshot.status !== "completed") return;
			unsubscribe();
			completed.resolve(snapshot);
		});

		const receipt = runtime.ask("What is running?");
		expect(receipt.status).toBe("running");
		const snapshot = await completed.promise;
		expect(snapshot.text).toContain("Status ok.");
		expect(snapshot.injection?.text).toBe("Steer the next turn");

		const history = await runtime.historyList();
		expect(history.topics.map(topic => topic.topicId)).toContain(receipt.ephemeralId);
		const topic = await runtime.historyRead(receipt.ephemeralId);
		expect(topic.turns[0]?.answer).toContain("Status ok.");

		expect(snapshot.injection).toBeDefined();
		await runtime.inject(snapshot.injection!.id);
		expect(fake.injected).toEqual(["Steer the next turn"]);

		const branched = await runtime.branch(receipt.branchToken);
		expect(branched).toEqual({ branched: true, newSessionId: "session-b", newLeafId: "leaf-b" });
		expect(fake.branch).toHaveBeenCalledTimes(1);
		runtime.dispose();
	});
});

describe("resource service", () => {
	function sessionFor(artifacts: string): AgentSession {
		return {
			sessionId: "session-a",
			settings: {},
			skills: [],
			getImageAttachments: () => [],
			sessionManager: {
				getSessionId: () => "session-a",
				getArtifactsDir: () => artifacts,
				getCwd: () => artifacts,
				getSessionFile: () => path.join(artifacts, "session.jsonl"),
			},
		} as unknown as AgentSession;
	}

	it("fences local saves by the opened version and paginates a versioned read", async () => {
		const artifacts = await temporaryDirectory();
		const localRoot = path.join(artifacts, "local");
		await fs.mkdir(localRoot);
		await fs.writeFile(path.join(localRoot, "note.txt"), "alpha\nbeta\n");
		const service = new StudioResourceService(sessionFor(artifacts));

		const opened = (await service.local({
			kind: "resource.local.open",
			sessionId: "session-a",
			uri: "local://note.txt",
		})) as { uri: string; version: string; text: string };
		expect(opened.text).toBe("alpha\nbeta\n");

		await expect(
			service.local({
				kind: "resource.local.save",
				sessionId: "session-a",
				uri: "local://note.txt",
				version: "0".repeat(64),
				text: "stale",
			}),
		).rejects.toMatchObject({ code: "STATE_VERSION_CONFLICT" });

		const saved = (await service.local({
			kind: "resource.local.save",
			sessionId: "session-a",
			uri: "local://note.txt",
			version: opened.version,
			text: "changed\n",
		})) as { saved: true; version: string };
		expect(saved.saved).toBe(true);
		expect(await fs.readFile(path.join(localRoot, "note.txt"), "utf8")).toBe("changed\n");

		await expect(
			service.local({
				kind: "resource.local.open",
				sessionId: "session-a",
				uri: "local://../escape.txt",
			}),
		).rejects.toThrow();

		const longText = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join("\n");
		await fs.writeFile(path.join(localRoot, "long.txt"), longText);
		const first = await service.read({
			kind: "resource.read",
			sessionId: "session-a",
			uri: "local://long.txt",
		});
		expect(first.total).toBe(150);
		expect(first.nextOffset).toBe(100);
		const second = await service.read({
			kind: "resource.read",
			sessionId: "session-a",
			uri: "local://long.txt",
			offset: 100,
			version: first.version,
		});
		expect(second.text).toContain("line 101");
		expect(second.nextOffset).toBeUndefined();

		await expect(
			service.read({
				kind: "resource.read",
				sessionId: "session-a",
				uri: "local://long.txt",
				version: "f".repeat(64),
			}),
		).rejects.toMatchObject({ code: "STATE_VERSION_CONFLICT" });
	});
});

describe("runtime utility service", () => {
	it("reports a missing native trace, honours the disabled gate, and releases the view", async () => {
		const artifacts = await temporaryDirectory();
		const session = {
			sessionId: "session-a",
			settings: {},
			skills: [],
			messages: [],
			activeToolExecutionUpdates: () => [],
			sessionManager: {
				getSessionId: () => "session-a",
				getArtifactsDir: () => artifacts,
				getCwd: () => artifacts,
				getSessionFile: () => undefined,
			},
		} as unknown as AgentSession;
		const service = new StudioRuntimeUtilityService(session, () => true);
		expect(await service.read({ kind: "shell.view.read", sessionId: "session-a", toolCallId: "missing" })).toEqual({
			available: false,
			reason: "This command has no recorded execution trace.",
		});
		expect(service.release({ kind: "shell.view.release", sessionId: "session-a", toolCallId: "missing" })).toEqual({
			released: true,
		});
		const disabled = new StudioRuntimeUtilityService(session, () => false);
		expect(await disabled.read({ kind: "shell.view.read", sessionId: "session-a", toolCallId: "missing" })).toEqual({
			available: false,
			reason: "Shell visualization is disabled.",
		});
	});

	it("refuses a recorded source outside the selected transcript bucket", async () => {
		const artifacts = await temporaryDirectory();
		const foreign = SessionManager.create(path.join(artifacts, "foreign"), path.join(artifacts, "foreign-sessions"));
		foreign.appendMessage({ role: "user", content: "foreign transcript", timestamp: 1 });
		await foreign.ensureOnDisk();
		await foreign.flush();
		const foreignId = foreign.getSessionId();
		await foreign.close();
		const session = {
			sessionId: "selected",
			messages: [],
			sessionManager: {
				getSessionId: () => "selected",
				getSessionDir: () => path.join(artifacts, "selected-sessions"),
				getCwd: () => path.join(artifacts, "selected"),
			},
		} as unknown as AgentSession;
		await expect(
			new StudioRuntimeUtilityService(session, () => true).read({
				kind: "shell.view.read",
				sessionId: "selected",
				sourceSessionId: foreignId,
				toolCallId: "private-trace",
			}),
		).rejects.toThrow("recorded shell session is unavailable");
	});
});

describe("session options service", () => {
	it("reports native speed state and fences a stale expected model", async () => {
		const session = {
			sessionId: "session-a",
			model: { provider: "custom", id: "test-model", api: "custom", name: "Test" },
			isSlowModeSupported: () => false,
			isSlowModeEnabled: () => false,
			getSlowModeScope: () => undefined,
			getUsageLimitState: () => undefined,
			isUltrafastModeEnabled: () => false,
			isFastModeEnabled: () => false,
			isFastModeActive: () => false,
			effectiveServiceTier: () => undefined,
		} as unknown as AgentSession;
		const service = new StudioSessionOptionsService(session);
		expect(service.speed()).toEqual({
			model: "custom/test-model",
			selected: "normal",
			supported: ["normal"],
			fastActive: false,
			slowEnabled: false,
		});
		await expect(
			service.execute({
				kind: "session.speed.set",
				sessionId: "session-a",
				expectedModel: "custom/other-model",
				speed: "normal",
			}),
		).rejects.toThrow("The model changed");
	});
});
