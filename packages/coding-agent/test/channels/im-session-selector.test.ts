/**
 * Stable `!session` selector read model: one candidate snapshot feeds the IM
 * list and the Team IM page. Workspace bases and per-workspace numbers follow
 * registry/creation order and never move when the 3-day display window changes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import type { BotSessionEntry } from "../../src/config/web-config";
import { WebConfig } from "../../src/config/web-config";
import {
	buildImSessionList,
	createImSessionSelectorState,
	type ImSessionListSnapshot,
} from "../../src/channels/im-session-selector";
import type { SessionRouter } from "../../src/channels/session-router";

const T0 = "2026-11-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60_000;
const dirs: string[] = [];

afterEach(async () => {
	for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `zeta-selector-${prefix}-`));
	dirs.push(dir);
	return dir;
}

interface MessageSpec {
	role: "user" | "assistant";
	text: string;
}

async function writeSession(
	file: string,
	options: {
		id: string;
		createdAt?: string;
		title?: string;
		messages?: MessageSpec[];
	},
): Promise<void> {
	const createdAt = options.createdAt ?? T0;
	const header = {
		type: "session",
		version: 3,
		id: options.id,
		cwd: "/repo",
		timestamp: createdAt,
		...(options.title ? { title: options.title } : {}),
	};
	const lines = [JSON.stringify(header)];
	for (const [index, message] of (options.messages ?? []).entries()) {
		lines.push(
			JSON.stringify({
				type: "message",
				id: `${options.id}-m${index}`,
				parentId: index > 0 ? `${options.id}-m${index - 1}` : null,
				timestamp: createdAt,
				message: {
					role: message.role,
					content: message.role === "assistant" ? [{ type: "text", text: message.text }] : message.text,
					...(message.role === "assistant" ? { provider: "p", model: "m" } : {}),
					timestamp: 0,
				},
			}),
		);
	}
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

async function setAge(file: string, ageMs: number): Promise<void> {
	const at = new Date(Date.now() - ageMs);
	await fs.utimes(file, at, at);
}

function entry(
	dir: string,
	id: string,
	options: Partial<BotSessionEntry> & { name?: string; createdAt?: string } = {},
): BotSessionEntry {
	return {
		id,
		name: options.name ?? id,
		tag: options.tag ?? "bot",
		sessionFile: options.sessionFile ?? path.join(dir, `${id}.jsonl`),
		cwd: options.cwd ?? dir,
		workspaceAlias: options.workspaceAlias ?? "main",
		createdAt: options.createdAt ?? T0,
		...(options.platform ? { platform: options.platform } : {}),
		...(options.agentProfileId ? { agentProfileId: options.agentProfileId } : {}),
		...(options.target ? { target: options.target } : {}),
	};
}

async function makeConfig(workspaceDir: string): Promise<WebConfig> {
	const dir = await tempDir("config");
	const file = path.join(dir, "web.yml");
	await Bun.write(
		file,
		YAML.stringify({
			channels: { instances: [] },
			imAgents: [
				{
					id: "pm",
					label: "PM",
					persona: { mode: "workspace" },
					location: { kind: "team-pm", team: "t", pm: "p" },
					tools: { preset: "team-pm", builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
				{
					id: "normal",
					label: "Normal",
					persona: { mode: "workspace" },
					location: { kind: "workspace", workspace: "main" },
					tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
					memory: {},
				},
			],
			remote: { workspaces: [{ alias: "other", path: workspaceDir }] },
		}),
	);
	return WebConfig.load(file);
}

function stubRouter(entries: BotSessionEntry[]): SessionRouter {
	return { listBotSessions: () => entries } as unknown as SessionRouter;
}

function byId(snapshot: ImSessionListSnapshot, id: string): ImSessionListSnapshot["candidates"][number] | undefined {
	return snapshot.candidates.find(candidate => candidate.canonicalSessionId === id);
}

describe("IM session selector read model", () => {
	test("workspace bases and session numbers stay stable across the 3-day window", async () => {
		const dir = await tempDir("stable");
		const config = await makeConfig(dir);
		const state = createImSessionSelectorState();
		const entries = [
			entry(dir, "s1", { createdAt: "2026-11-01T00:01:00.000Z", name: "one" }),
			entry(dir, "s2", { createdAt: "2026-11-01T00:02:00.000Z", name: "two" }),
			entry(dir, "s3", { createdAt: "2026-11-01T00:03:00.000Z", name: "three" }),
			entry(dir, "s4", {
				createdAt: "2026-11-01T00:04:00.000Z",
				name: "other-ws",
				workspaceAlias: "other",
			}),
			entry(dir, "s5", {
				createdAt: "2026-11-01T00:05:00.000Z",
				name: "old",
				workspaceAlias: "main",
			}),
		];
		for (const item of entries) {
			await writeSession(item.sessionFile, { id: item.id, title: item.name, messages: [{ role: "user", text: "hi" }] });
		}
		await setAge(entries[0]!.sessionFile, 5 * 60 * 60_000);
		await setAge(entries[1]!.sessionFile, 3 * 60 * 60_000);
		await setAge(entries[2]!.sessionFile, 1 * 60 * 60_000);
		await setAge(entries[3]!.sessionFile, 2 * 60 * 60_000);
		await setAge(entries[4]!.sessionFile, 4 * DAY_MS);

		let snapshot = await buildImSessionList(stubRouter(entries), config, state);
		expect(byId(snapshot, "s1")?.selector).toBe("01-00001");
		expect(byId(snapshot, "s2")?.selector).toBe("01-00002");
		expect(byId(snapshot, "s3")?.selector).toBe("01-00003");
		expect(byId(snapshot, "s4")?.selector).toBe("02-00001");
		expect(byId(snapshot, "s5")).toBeUndefined();

		// Sliding out of the window removes a row but never renumbers the rest.
		await setAge(entries[2]!.sessionFile, 4 * DAY_MS);
		snapshot = await buildImSessionList(stubRouter(entries), config, state);
		expect(byId(snapshot, "s3")).toBeUndefined();
		expect(byId(snapshot, "s1")?.selector).toBe("01-00001");
		expect(byId(snapshot, "s2")?.selector).toBe("01-00002");
		expect(byId(snapshot, "s4")?.selector).toBe("02-00001");

		// A new session takes the next number; skipped numbers are never reused.
		const s6 = entry(dir, "s6", { createdAt: "2026-11-01T00:10:00.000Z", name: "six" });
		entries.push(s6);
		await writeSession(s6.sessionFile, { id: "s6", title: "six", messages: [{ role: "user", text: "hi" }] });
		snapshot = await buildImSessionList(stubRouter(entries), config, state);
		expect(byId(snapshot, "s6")?.selector).toBe("01-00005");
		expect(snapshot.bySelector.get("01-00005")?.canonicalSessionId).toBe("s6");
	});

	test("PM sessions are hidden by default but keep their number when explicitly included", async () => {
		const dir = await tempDir("pm");
		const config = await makeConfig(dir);
		const state = createImSessionSelectorState();
		const entries = [
			entry(dir, "n1", { createdAt: "2026-11-01T00:01:00.000Z", name: "normal one", agentProfileId: "normal" }),
			entry(dir, "n2", { createdAt: "2026-11-01T00:02:00.000Z", name: "normal two", agentProfileId: "normal" }),
			entry(dir, "pm1", { createdAt: "2026-11-01T00:03:00.000Z", name: "pm chat", agentProfileId: "pm" }),
			entry(dir, "pm2", {
				createdAt: "2026-11-01T00:04:00.000Z",
				name: "team pm target",
				target: { kind: "team-pm", team: "t", pm: "p" },
			}),
		];
		for (const item of entries) {
			await writeSession(item.sessionFile, { id: item.id, title: item.name, messages: [{ role: "user", text: "hi" }] });
			await setAge(item.sessionFile, 60 * 60_000);
		}

		let snapshot = await buildImSessionList(stubRouter(entries), config, state);
		expect([...snapshot.candidates.map(candidate => candidate.canonicalSessionId)].sort()).toEqual(["n1", "n2"]);
		expect(snapshot.candidates.every(candidate => !candidate.isPm)).toBe(true);

		snapshot = await buildImSessionList(stubRouter(entries), config, state, { includePm: true });
		expect(byId(snapshot, "pm1")?.selector).toBe("01-00003");
		expect(byId(snapshot, "pm2")?.selector).toBe("01-00004");
		expect(byId(snapshot, "pm1")?.isPm).toBe(true);
		expect(byId(snapshot, "pm2")?.isPm).toBe(true);
		expect(byId(snapshot, "n1")?.selector).toBe("01-00001");
	});

	test("task summary provenance and labels never borrow the first message", async () => {
		const dir = await tempDir("summary");
		const config = await makeConfig(dir);
		const state = createImSessionSelectorState();
		const entries = [
			entry(dir, "completed", {
				createdAt: "2026-11-01T00:01:00.000Z",
				name: "completed-id",
				sessionFile: path.join(dir, "completed.jsonl"),
			}),
			entry(dir, "open", {
				createdAt: "2026-11-01T00:02:00.000Z",
				name: "Named open task",
				sessionFile: path.join(dir, "open.jsonl"),
			}),
			entry(dir, "unnamed", {
				createdAt: "2026-11-01T00:03:00.000Z",
				name: "unnamed",
				platform: "telegram",
				sessionFile: path.join(dir, "unnamed.jsonl"),
			}),
			entry(dir, "empty", {
				createdAt: "2026-11-01T00:04:00.000Z",
				name: "empty-id",
				sessionFile: path.join(dir, "empty.jsonl"),
			}),
		];
		await writeSession(entries[0]!.sessionFile, {
			id: "completed",
			title: "Release fix",
			messages: [
				{ role: "user", text: "add the missing route" },
				{ role: "assistant", text: "Route added and tests pass." },
			],
		});
		await writeSession(entries[1]!.sessionFile, {
			id: "open",
			messages: [{ role: "user", text: "still working on this" }],
		});
		await writeSession(entries[2]!.sessionFile, {
			id: "unnamed",
			messages: [{ role: "user", text: "FIRST MESSAGE MUST NOT BE THE LABEL" }],
		});
		await writeSession(entries[3]!.sessionFile, { id: "empty" });
		for (const item of entries) await setAge(item.sessionFile, 60 * 60_000);

		const snapshot = await buildImSessionList(stubRouter(entries), config, state);
		const completed = byId(snapshot, "completed");
		expect(completed?.label).toBe("Release fix");
		expect(completed?.status).toBe("completed");
		expect(completed?.latestTaskSummary).toBe("Route added and tests pass.");
		expect(completed?.taskSummary).toMatchObject({
			status: "completed",
			source: "completed_turn",
			intent: "add the missing route",
			result: "Route added and tests pass.",
		});

		const open = byId(snapshot, "open");
		expect(open?.label).toBe("Named open task");
		expect(open?.status).toBe("incomplete");
		expect(open?.latestTaskSummary).toBeUndefined();
		expect(open?.taskSummary).toMatchObject({ status: "incomplete", source: "open_turn", intent: "still working on this" });

		const unnamed = byId(snapshot, "unnamed");
		expect(unnamed?.label).toBe("main · Telegram 会话");
		expect(unnamed?.label).not.toContain("FIRST MESSAGE");

		const empty = byId(snapshot, "empty");
		expect(empty?.status).toBe("unknown");
		expect(empty?.latestTaskSummary).toBeUndefined();
		expect(empty?.taskSummary).toBeUndefined();
	});
});
