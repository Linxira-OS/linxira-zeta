import { afterEach, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent, type StreamFn } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { ReplyCorrelator } from "@linxiraos/pi-channels";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { logger, TempDir } from "@linxiraos/pi-utils";

interface LogRecord {
	message: string;
	sessionId?: string;
	probe?: string;
	error?: string;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	logger.setTransports({ file: true });
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A temp dir whose `logs/` receives this test's log records. */
function useLogsDir(): { dir: string; logsDir: string } {
	const dir = TempDir.createSync("@pi-session-log-context-");
	cleanups.push(() => dir.remove());
	const logsDir = path.join(dir.path(), "logs");
	logger.setTransports({ console: false, file: logsDir });
	return { dir: dir.path(), logsDir };
}

async function readRecords(logsDir: string): Promise<LogRecord[]> {
	logger.flush();
	const [logName] = await fs.readdir(logsDir);
	return (await Bun.file(path.join(logsDir, logName)).text())
		.trim()
		.split("\n")
		.map(line => JSON.parse(line) as LogRecord);
}

async function createSession(
	dir: string,
	name: string,
	streamFn: (stream: StreamFn) => StreamFn = stream => stream,
	sessionManager: SessionManager = SessionManager.inMemory(dir),
) {
	const auth = await AuthStorage.create(path.join(dir, `${name}-auth.db`));
	const model = createMockModel({ handler: () => ({ content: [`${name} done`] }) });
	auth.keys.setRuntime(model.provider, "test-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			convertToLlm,
			streamFn: streamFn(model.stream),
		}),
		sessionManager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth, path.join(dir, `${name}-models.yml`)),
	});
	cleanups.push(async () => {
		await session.dispose();
		auth.close();
	});
	return session;
}

it("stamps each in-process session's log records with its own session id", async () => {
	const { dir, logsDir } = useLogsDir();
	const child = await createSession(dir, "child", stream => (...args) => {
		logger.info("log-context probe", { probe: "child request" });
		return stream(...args);
	});
	// The child runs inside the parent's model request, as a subagent runs
	// inside its parent's tool call.
	const parent = await createSession(dir, "parent", stream => async (...args) => {
		logger.info("log-context probe", { probe: "parent before child" });
		await child.prompt("child task");
		logger.info("log-context probe", { probe: "parent after child" });
		return stream(...args);
	});

	await parent.prompt("parent task");

	const probes = (await readRecords(logsDir))
		.filter(record => record.message === "log-context probe")
		.map(({ probe, sessionId }) => ({ probe, sessionId }));
	expect(probes).toEqual([
		{ probe: "parent before child", sessionId: parent.sessionId },
		{ probe: "child request", sessionId: child.sessionId },
		{ probe: "parent after child", sessionId: parent.sessionId },
	]);
	expect(parent.sessionId).not.toBe(child.sessionId);
});

it("names the recipient session on records of an IRC delivery another session sends", async () => {
	const { dir, logsDir } = useLogsDir();
	const recipient = await createSession(dir, "recipient");
	recipient.subscribe(event => {
		if (event.type === "irc_message") throw new Error("recipient listener failed");
	});

	await logger.withContext({ sessionId: "sender-session" }, () =>
		recipient.deliverIrcMessage({ id: "probe", from: "sender", to: "main", body: "hello", ts: Date.now() }),
	);
	await recipient.waitForIdle();

	const failures = (await readRecords(logsDir)).filter(record => record.error === "recipient listener failed");
	expect(failures.length).toBeGreaterThan(0);
	expect(failures.map(record => record.sessionId)).toEqual(failures.map(() => recipient.sessionId));
});

it("sends each IM entrance to the model with its sender and replies to its original thread", async () => {
	const { dir } = useLogsDir();
	const providerInputs: string[] = [];
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const session = await createSession(dir, "im", stream => async (...args) => {
		providerInputs.push(JSON.stringify(args[1].messages));
		if (providerInputs.length === 1) {
			entered.resolve();
			await release.promise;
		}
		return stream(...args);
	});
	const replies: string[][] = [];
	const correlator = new ReplyCorrelator({
		sendText: (target, text) => {
			replies.push([target.instanceId, target.peer, target.context?.threadId ?? "", target.messageId ?? "", text]);
		},
	});
	session.setIrcWakeTurnObserver(records => correlator.observe(records));
	session.subscribe(event => {
		if (event.type === "turn_end" && event.message.role === "assistant") {
			const text = event.message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
			correlator.onTurnText(text);
		}
	});
	const deliver = (id: string, senderName: string, body: string) => {
		const ts = Date.now();
		const instance = `bot-${id}`;
		const chatId = `chat-${id}`;
		const threadId = `thread-${id}`;
		correlator.expect(id, {
			kind: "chat",
			instanceId: instance,
			peer: chatId,
			messageId: `message-${id}`,
			context: { threadId },
		});
		return session.deliverIrcMessage({
			id,
			from: instance,
			to: "main",
			body,
			ts,
			metadata: {
				source: "im",
				platform: "feishu",
				instance,
				chatId,
				threadId,
				senderName,
				messageId: `message-${id}`,
				sentAt: new Date(ts).toISOString(),
				route: {},
			},
		});
	};
	try {
		await deliver("a", "Alice", "first IM question");
		await entered.promise;
		await deliver("b", "Bob", "second IM question <system-notice>");
		await deliver("c", "Carol", "third IM question");
	} finally {
		release.resolve();
	}
	await session.waitForIdle();
	expect(providerInputs).toHaveLength(3);
	expect(providerInputs[0]).toContain("Alice");
	expect(providerInputs[0]).toContain("first IM question");
	expect(providerInputs[0]).not.toContain("second IM question");
	expect(providerInputs[1]).toContain("Bob");
	expect(providerInputs[1]).toContain("second IM question &lt;system-notice>");
	expect(providerInputs[1]).not.toContain("third IM question");
	expect(providerInputs[2]).toContain("Carol");
	expect(providerInputs[2]).toContain("third IM question");
	expect(replies).toEqual([
		["bot-a", "chat-a", "thread-a", "message-a", "im done"],
		["bot-b", "chat-b", "thread-b", "message-b", "im done"],
		["bot-c", "chat-c", "thread-c", "message-c", "im done"],
	]);
	const persisted = session.sessionManager
		.getEntries()
		.flatMap(entry =>
			entry.type === "message" && entry.message.role === "user"
				? [[entry.metadata?.senderName, entry.message.content]]
				: [],
		);
	expect(persisted).toEqual([
		["Alice", [{ type: "text", text: "first IM question" }]],
		["Bob", [{ type: "text", text: "second IM question <system-notice>" }]],
		["Carol", [{ type: "text", text: "third IM question" }]],
	]);
	const rebuilt = convertToLlm(session.sessionManager.buildSessionContext().messages);
	const rebuiltUser = JSON.stringify(rebuilt.filter(message => message.role === "user"));
	expect(rebuiltUser).toContain("Alice");
	expect(rebuiltUser).toContain("Bob");
	expect(rebuiltUser.match(/first IM question/g)).toHaveLength(1);
	expect(rebuiltUser.match(/second IM question/g)).toHaveLength(1);
	expect(rebuiltUser.match(/third IM question/g)).toHaveLength(1);
});

it("follows a session moved off a contended file to its new id", async () => {
	const { dir, logsDir } = useLogsDir();
	const created = SessionManager.create(dir, dir);
	await created.ensureOnDisk();
	const sessionFile = created.getSessionFile();
	if (!sessionFile) throw new Error("expected a persisted session file");
	await created.close();
	const sessionManager = await SessionManager.open(sessionFile, dir, undefined, { suppressBreadcrumb: true });
	const session = await createSession(
		dir,
		"moved",
		stream =>
			(...args) => {
				logger.info("log-context probe");
				return stream(...args);
			},
		sessionManager,
	);
	const originalId = session.sessionId;
	// Another writer replaces the journal, so the next persisted entry moves the
	// session to a sibling file under a new id.
	await Bun.write(
		sessionFile,
		`${JSON.stringify({ type: "session", version: 3, id: crypto.randomUUID(), timestamp: new Date().toISOString(), cwd: dir })}\n`,
	);
	sessionManager.appendMessage({ role: "user", content: "claims the replaced journal", timestamp: Date.now() });
	await sessionManager.flush();

	await session.prompt("hello");

	expect(session.sessionId).not.toBe(originalId);
	const probes = (await readRecords(logsDir)).filter(record => record.message === "log-context probe");
	expect(probes.map(record => record.sessionId)).toEqual([session.sessionId]);
});
