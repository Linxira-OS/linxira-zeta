/**
 * `GET /api/im/conversations` + `POST /api/im/conversations/attach`.
 *
 * The chooser must read the existing session registry/list and attach by the
 * canonical native header id without copying or rewriting the transcript.
 * Binding writes may then share that id from different instances/chats only
 * while target/profile/model agree.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { WebConfig } from "../../src/config/web-config";
import { SessionManager } from "../../src/session/session-manager";
import { closeSessionIndex } from "../../src/session/session-index";
import { sessions } from "../../src/server/web-gateway/agents";
import type { AgentSessionWrapper } from "../../src/server/web-gateway/agents";
import { webGatewayFetch } from "../../src/server/web-gateway";

const PROFILE = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "alpha" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: {},
};
const ANALYST = { ...PROFILE, id: "analyst", label: "Analyst" };

let agentDir: string;
let projectDir: string;
let unregisteredDir: string;
let nativeId: string;
let nativePath: string;
let nativeBytes: string;
let unregisteredId: string;
let unregisteredPath: string;
const originalAgentDir = process.env.ZETA_CODING_AGENT_DIR;

function gateway(path: string, init?: RequestInit): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), "127.0.0.1");
}

async function body(response: Response): Promise<Record<string, unknown>> {
	const value: unknown = await response.json();
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
	return value as Record<string, unknown>;
}

function putBindings(bindings: unknown[]): Promise<Response> {
	return gateway("/api/im/bindings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ bindings }),
	});
}

function binding(
	id: string,
	instanceId: string,
	platform: string,
	chatId: string,
	profileId: string,
	sessionId: string,
) {
	return {
		id,
		instanceId,
		platform,
		chatId,
		agentProfileId: profileId,
		sessionId,
		target: { kind: "workspace", workspace: "alpha" },
		role: "answer",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-im-conversations-"));
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	process.env.ZETA_DEFAULT_WORKSPACE = join(agentDir, "default-workspace");
	refreshDirsFromEnv();
	WebConfig.resetShared();
	projectDir = await mkdtemp(join(tmpdir(), "zeta-im-project-"));
	unregisteredDir = await mkdtemp(join(tmpdir(), "zeta-im-other-"));
	await writeFile(
		join(agentDir, "web.yml"),
		JSON.stringify({
			channels: {
				instances: [
					{
						id: "wechat",
						platform: "wechat",
						label: "WeChat",
						enabled: true,
						agentProfile: PROFILE.id,
						allow: { peers: ["peer-a"] },
						credentials: {},
					},
					{
						id: "telegram",
						platform: "telegram",
						label: "Telegram",
						enabled: true,
						agentProfile: PROFILE.id,
						allow: { peers: ["peer-b"] },
						credentials: {},
					},
				],
			},
			imAgents: [PROFILE, ANALYST],
			remote: {},
		}),
	);
	const config = await WebConfig.shared();
	await config.setWorkspaceEntry("alpha", projectDir);

	const native = SessionManager.create(projectDir);
	native.appendMessage({ role: "user", content: "release review", timestamp: Date.now() });
	await native.setSessionName("Release review", "user");
	nativeId = native.getSessionId();
	nativePath = native.getSessionFile()!;
	await native.ensureOnDisk();
	await native.flush();
	await native.close();
	nativeBytes = await readFile(nativePath, "utf8");

	const other = SessionManager.create(unregisteredDir);
	other.appendMessage({ role: "user", content: "private scratch", timestamp: Date.now() });
	await other.setSessionName("Scratch", "user");
	unregisteredId = other.getSessionId();
	unregisteredPath = other.getSessionFile()!;
	await other.ensureOnDisk();
	await other.flush();
	await other.close();
});

afterAll(async () => {
	WebConfig.resetShared();
	closeSessionIndex();
	const removeDir = (dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
	await removeDir(agentDir);
	await removeDir(projectDir);
	await removeDir(unregisteredDir);
	if (originalAgentDir) process.env.ZETA_CODING_AGENT_DIR = originalAgentDir;
	else delete process.env.ZETA_CODING_AGENT_DIR;
	delete process.env.ZETA_DEFAULT_WORKSPACE;
	refreshDirsFromEnv();
	WebConfig.resetShared();
});

describe("IM conversation chooser and attach", () => {
	test("lists native names, attaches the existing header id, and never rewrites the transcript", async () => {
		const listed = await body(await gateway("/api/im/conversations"));
		const conversations = listed["conversations"];
		expect(Array.isArray(conversations)).toBe(true);
		const row = (conversations as Array<Record<string, unknown>>).find(item => item.id === nativeId);
		expect(row).toMatchObject({
			id: nativeId,
			name: "Release review",
			kind: "native",
			attached: false,
			workspaceAlias: "alpha",
			available: true,
			nativeSessionId: nativeId,
		});
		expect(JSON.stringify(row)).not.toContain(nativePath);

		const attached = await body(
			await gateway("/api/im/conversations/attach", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: nativeId }),
			}),
		);
		expect(attached["conversation"]).toMatchObject({
			id: nativeId,
			name: "Release review",
			attached: true,
			nativeSessionId: nativeId,
		});
		expect(await readFile(nativePath, "utf8")).toBe(nativeBytes);
		const config = await WebConfig.shared();
		expect(config.getBotSession(nativeId)).toMatchObject({
			id: nativeId,
			sessionFile: nativePath,
			nativeSessionId: nativeId,
			reusesExistingTranscript: true,
		});
		// Idempotent: a second attach resolves the same row, not a copy.
		const again = await body(
			await gateway("/api/im/conversations/attach", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: nativeId }),
			}),
		);
		expect((again["conversation"] as Record<string, unknown>)["id"]).toBe(nativeId);
		expect(config.getBotSessions().filter(entry => entry.sessionFile === nativePath)).toHaveLength(1);
		expect(await readFile(nativePath, "utf8")).toBe(nativeBytes);
	});

	test("two instances/chats share one conversation, while a conflicting profile is rejected", async () => {
		const initial = binding("b_0123456789abcdef", "wechat", "wechat", "peer-a", PROFILE.id, nativeId);
		const second = binding("b_fedcba9876543210", "telegram", "telegram", "peer-b", PROFILE.id, nativeId);
		const accepted = await putBindings([initial, second]);
		expect(accepted.status).toBe(200);

		const rowsPayload = await body(await gateway("/api/im/bindings"));
		const rows = rowsPayload["bindings"] as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(2);
		expect(rows.every(row => row.sessionId === nativeId)).toBe(true);
		expect(rows.every(row => row.conversationName === "Release review")).toBe(true);
		expect(rows.every(row => row.conversationShared === true)).toBe(true);
		expect(rows.every(row => row.conversationEntrances === 2)).toBe(true);
		expect(rows.every(row => row.nativeSessionId === nativeId)).toBe(true);

		const conflicting = await putBindings([initial, { ...second, agentProfileId: ANALYST.id }]);
		expect(conflicting.status).toBe(400);
		expect(await readFile(nativePath, "utf8")).toBe(nativeBytes);
	});

	test("a live non-IM resident wrapper is refused instead of starting a second writer", async () => {
		const live = {
			isAlive: () => true,
			getSession: () => ({ sessionManager: { getOrigin: () => undefined } }),
		} as unknown as AgentSessionWrapper;
		sessions.set(unregisteredId, live);
		try {
			const response = await gateway("/api/im/conversations/attach", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: unregisteredId }),
			});
			expect(response.status).toBe(409);
			expect((await body(response))["reason"]).toBe("session-running");
			expect((await WebConfig.shared()).getBotSession(unregisteredId)).toBeUndefined();
		} finally {
			sessions.delete(unregisteredId);
		}
	});

	test("an unregistered workspace is an explicit prerequisite, not an import", async () => {
		const response = await gateway("/api/im/conversations/attach", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId: unregisteredId }),
		});
		expect(response.status).toBe(409);
		const payload = await body(response);
		expect(payload["reason"]).toBe("workspace-not-registered");
		const config = await WebConfig.shared();
		expect(config.getBotSessions().some(entry => entry.sessionFile === unregisteredPath)).toBe(false);
	});
});
