import { logger } from "@linxiraos/pi-utils";
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";
import type { SessionEntry } from "../session/session-entries";
import { tasteWriteScope } from "../taste/consolidate";
import { cfgTasteEnabled, cfgTasteExtractionMode } from "../taste/settings";
import { extractTasteWindow } from "../taste/window-extract";
import { resolveMemoryBackend } from "./resolve";
import { cfgMemoryBackend, cfgMemoryExtractionMode } from "./settings";
import type { MemoryLearningWindow } from "./window-types";
import { WindowLearningQueue } from "./window-queue";

export interface WindowLearningHandle {
	stop(): Promise<void>;
	flush(): Promise<void>;
}

export interface WindowLearningOptions {
	session: AgentSession;
	settings: Settings;
	modelRegistry: ModelRegistry;
	agentDir: string;
	/** SDK-resolved namespace: `im:` binding scopes or the canonical repository scope. */
	namespace: string;
	taskDepth: number;
}

function isLearningEnabled(settings: Settings, taskDepth: number): boolean {
	if (taskDepth > 0) return false;
	if (cfgMemoryBackend.get(settings) === "off") return false;
	const taste = cfgTasteEnabled.get(settings) && cfgTasteExtractionMode.get(settings) === "window";
	return taste || cfgMemoryExtractionMode.get(settings) === "window";
}

/**
 * `AgentSession.onCompactionCommit` and its notification type live in the
 * compaction lane's `session/compaction-contract` module. The narrow shape here
 * keeps this consumer buildable against the current branch; the service owns
 * the full contract, and this listener is registered through the real accessor.
 */
interface WindowCompactionSession extends AgentSession {
	onCompactionCommit(listener: (commit: {
		entry: { id: string };
		cutPoint: { discardedEntryIds: string[] };
	}) => void | Promise<void>): () => void;
}

/** Only user/assistant text: tool traffic and compaction entries are not conversational evidence. */
function textOf(entry: SessionEntry): MemoryLearningWindow["messages"][number] | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	const content = "content" in message ? message.content : undefined;
	let text = "";
	if (typeof content === "string") text = content;
	else if (Array.isArray(content)) {
		text = content
			.filter((block): block is { type: "text"; text: string } =>
				Boolean(block && typeof block === "object" && block.type === "text" && typeof block.text === "string"),
			)
			.map(block => block.text)
			.join("\n");
	}
	text = text.trim();
	if (!text) return undefined;
	return { role: message.role, content: text, timestamp: entry.timestamp };
}

function snapshot(entries: readonly SessionEntry[]): { messages: MemoryLearningWindow["messages"]; entryIds: string[] } {
	const messages: MemoryLearningWindow["messages"] = [];
	const entryIds: string[] = [];
	for (const entry of entries) {
		const message = textOf(entry);
		if (!message) continue;
		messages.push(message);
		entryIds.push(entry.id);
	}
	return { messages, entryIds };
}

/**
 * Window learning owns a durable journal, not a daemon. A commit listener only
 * copies discarded bytes and advances the idempotency cursor, then returns; model
 * work drains on the existing agent_end event, on stop, and on restart.
 */
export async function startWindowLearning(options: WindowLearningOptions): Promise<WindowLearningHandle> {
	const { session, settings } = options;
	if (options.taskDepth > 0 || cfgMemoryBackend.get(settings) === "off") {
		return { stop: async () => {}, flush: async () => {} };
	}
	const queue = new WindowLearningQueue(options.agentDir, options.namespace, session.sessionId);
	// `namespace` is the SDK-resolved value; taste scopes prefer it once the
	// namespace prerequisite lands, so no cwd/agent identity can leak across bindings.
	const scopeContext = {
		cwd: session.sessionManager.getCwd(),
		agentId: session.getAgentId(),
		namespace: options.namespace,
	};
	let stopped = false;
	let running: Promise<void> | undefined;

	const capture = async (id: string, entries: readonly SessionEntry[]) => {
		const captured = snapshot(entries);
		await queue.capture({
			id,
			entryIds: captured.entryIds,
			messages: captured.messages,
			memory: cfgMemoryExtractionMode.get(settings) === "window",
			taste: cfgTasteEnabled.get(settings) === true && cfgTasteExtractionMode.get(settings) === "window",
		});
	};

	const drain = async (): Promise<void> => {
		if (!running && (await queue.pending()).length === 0) return;
		if (!running) {
			running = (async () => {
				try {
					do {
						await queue.process(async (window, checkpoint) => {
							if (!window.messages.some(message => message.role === "user")) {
								window.memoryDone = true;
								window.tasteDone = true;
								await checkpoint();
								return;
							}
							const backend = await resolveMemoryBackend(settings);
							if (window.memory && !window.memoryDone) {
								if (!backend.learnWindow) throw new Error(`${backend.id} does not implement window learning`);
								await backend.learnWindow(
									{ agentDir: options.agentDir, cwd: session.sessionManager.getCwd(), session },
									window,
								);
								window.memoryDone = true;
								await checkpoint();
							}
							if (window.taste && !window.tasteDone) {
								if (cfgMemoryBackend.get(settings) !== "off" && cfgTasteEnabled.get(settings) && cfgTasteExtractionMode.get(settings) === "window") {
									await extractTasteWindow({
										window,
										settings,
										modelRegistry: options.modelRegistry,
										sessionId: session.sessionId,
										agentDir: options.agentDir,
										scope: tasteWriteScope(scopeContext, settings),
									});
								}
								window.tasteDone = true;
								await checkpoint();
							}
						});
					} while ((await queue.pending()).length > 0);
				} catch (error) {
					logger.warn("window learning: queued work failed; it remains persisted for retry", {
						error: error instanceof Error ? error.message : String(error),
					});
				} finally {
					running = undefined;
				}
			})();
		}
		return running ?? Promise.resolve();
	};

	// The service module supplies the full notification type; this accessor is the seam.
	const commitSession = session as WindowCompactionSession;
	const unsubscribeCommit = commitSession.onCompactionCommit(commit => {
		if (stopped || !isLearningEnabled(settings, options.taskDepth)) return;
		const discarded = commit.cutPoint.discardedEntryIds.flatMap(id => {
			const entry = session.sessionManager.getEntry(id);
			return entry ? [entry] : [];
		});
		return capture(commit.entry.id, discarded);
	});
	const unsubscribeEvents = session.subscribe(event => {
		if (event.type === "agent_end") void drain();
	});
	// Restart: replay every persisted window exactly once.
	void drain();
	return {
		flush: drain,
		async stop() {
			if (stopped) return;
			stopped = true;
			unsubscribeCommit();
			unsubscribeEvents();
			if (!isLearningEnabled(settings, options.taskDepth)) return;
			const branch = session.sessionManager.getBranch();
			const lastId = branch.at(-1)?.id ?? "empty";
			await capture(`stop:${session.sessionId}:${lastId}`, branch);
			await drain();
			if ((await queue.pending()).length > 0) await drain();
		},
	};
}
