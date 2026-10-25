import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { computeDefaultSessionDir } from "../../src/session/session-paths";
import { recoverBackendReplicas } from "../../src/session/backend-replica-recovery";
import { FileSessionStorage } from "../../src/session/session-storage";

const BACKEND_ID = "01a17119-9a0c-759a-a36c-181b071052f1";
const REPLICA_ID = "01a17119-9af0-7671-8e01-96ea737fab4d";
const CWD = "/tmp/zeta-recovery-test";

interface Fixture {
	backendId?: string;
	replicaId?: string;
	cwd?: string;
	timestamp?: string;
	title?: string;
	messages: { id: string; timestamp: string; text: string }[];
}

function jsonl(fixture: Fixture): string {
	const backendId = fixture.backendId ?? BACKEND_ID;
	const replicaId = fixture.replicaId ?? REPLICA_ID;
	const timestamp = fixture.timestamp ?? "2026-10-25T03:00:00.000Z";
	const cwd = fixture.cwd ?? CWD;
	const lines: string[] = [];
	if (fixture.title) lines.push(JSON.stringify({ type: "title", title: fixture.title }));
	lines.push(
		JSON.stringify({
			type: "session",
			version: 1,
			id: replicaId,
			timestamp,
			cwd,
			client: "cli",
		}),
	);
	for (const message of fixture.messages) {
		lines.push(
			JSON.stringify({
				type: "message",
				id: message.id,
				timestamp: message.timestamp,
				message: { role: "user", content: message.text },
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}

async function writeReplica(dir: string, fixture: Fixture): Promise<string> {
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `${fixture.backendId ?? BACKEND_ID}-${fixture.replicaId ?? REPLICA_ID}.jsonl`);
	await fs.writeFile(file, jsonl(fixture));
	return file;
}

async function localTarget(sessionsRoot: string, backendId = BACKEND_ID): Promise<string> {
	const dir = computeDefaultSessionDir(CWD, new FileSessionStorage(), sessionsRoot);
	return path.join(dir, `2026-10-25T03-00-00-000Z_${backendId}.jsonl`);
}

async function localPath(sessionsRoot: string, backendId = BACKEND_ID): Promise<string> {
	const dir = computeDefaultSessionDir(CWD, new FileSessionStorage(), sessionsRoot);
	const files = await fs.readdir(dir);
	const match = files.find(name => name.endsWith(`_${backendId}.jsonl`));
	if (!match) throw new Error(`missing local session for ${backendId}`);
	return path.join(dir, match);
}

describe("recoverBackendReplicas", () => {
	let temp: TempDir | undefined;

	afterEach(() => {
		temp?.removeSync();
		temp = undefined;
	});

	function paths() {
		temp = TempDir.createSync("@zeta-replica-recovery-");
		return {
			replicaDir: temp.join("backend"),
			sessionsRoot: temp.join("sessions"),
		};
	}

	it("imports an orphan replica as a normal session with the backend id", async () => {
		const { replicaDir, sessionsRoot } = paths();
		await writeReplica(replicaDir, {
			title: "Recovered conversation",
			messages: [
				{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" },
				{ id: "m2", timestamp: "2026-10-25T03:05:02.000Z", text: "second" },
			],
		});

		const result = await recoverBackendReplicas({ replicaDir, sessionsRoot });

		expect(result).toEqual({ imported: 1, updated: 0, skipped: 0, failed: 0 });
		const target = await localPath(sessionsRoot);
		expect(path.basename(target)).toContain(BACKEND_ID);
		const lines = (await fs.readFile(target, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(lines.find(line => line.type === "session")?.id).toBe(BACKEND_ID);
		expect(lines.find(line => line.type === "title")?.title).toBe("Recovered conversation");
		expect(lines.filter(line => line.type === "message")).toHaveLength(2);
		const stat = await fs.stat(target);
		expect(stat.mtimeMs).toBeCloseTo(Date.parse("2026-10-25T03:05:02.000Z"), -2);
	});

	it("is idempotent when the local session already has every replica message", async () => {
		const { replicaDir, sessionsRoot } = paths();
		await writeReplica(replicaDir, {
			messages: [{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" }],
		});

		expect((await recoverBackendReplicas({ replicaDir, sessionsRoot })).imported).toBe(1);
		const second = await recoverBackendReplicas({ replicaDir, sessionsRoot });

		expect(second).toEqual({ imported: 0, updated: 0, skipped: 1, failed: 0 });
	});

	it("updates a local stub when the replica is a strict superset", async () => {
		const { replicaDir, sessionsRoot } = paths();
		const target = await localTarget(sessionsRoot);
		await fs.writeFile(
			target,
			jsonl({
				title: "Stub",
				messages: [{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" }],
			}),
		);
		await writeReplica(replicaDir, {
			messages: [
				{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" },
				{ id: "m2", timestamp: "2026-10-25T03:05:02.000Z", text: "second" },
			],
		});

		const result = await recoverBackendReplicas({ replicaDir, sessionsRoot });

		expect(result).toEqual({ imported: 0, updated: 1, skipped: 0, failed: 0 });
		const lines = (await fs.readFile(target, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(lines.filter(line => line.type === "message")).toHaveLength(2);
	});

	it("never overwrites a local message the replica does not contain", async () => {
		const { replicaDir, sessionsRoot } = paths();
		const target = await localTarget(sessionsRoot);
		const local = jsonl({
			messages: [
				{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" },
				{ id: "local-only", timestamp: "2026-10-25T04:00:00.000Z", text: "local work" },
			],
		});
		await fs.writeFile(target, local);
		await writeReplica(replicaDir, {
			messages: [{ id: "m1", timestamp: "2026-10-25T03:00:01.000Z", text: "first" }],
		});

		const result = await recoverBackendReplicas({ replicaDir, sessionsRoot });

		expect(result).toEqual({ imported: 0, updated: 0, skipped: 1, failed: 0 });
		expect(await fs.readFile(target, "utf8")).toBe(local);
	});

	it("skips empty and malformed replicas", async () => {
		const { replicaDir, sessionsRoot } = paths();
		await writeReplica(replicaDir, { messages: [] });
		await fs.writeFile(path.join(replicaDir, "not-a-session.jsonl"), "{}\n");

		const result = await recoverBackendReplicas({ replicaDir, sessionsRoot });

		expect(result).toEqual({ imported: 0, updated: 0, skipped: 2, failed: 0 });
	});
});
