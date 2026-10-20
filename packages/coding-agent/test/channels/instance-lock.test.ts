/**
 * Single-instance lock contention — the guard only works if a second process
 * can never win the same lock.
 *
 * The lock payload is published atomically (temp file + hard link), so a
 * reader never mistakes a half-written file for a stale lock. A lock that does
 * read as unparseable is retried briefly instead of being unlinked, because it
 * may be another process's in-flight publish.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireChannelLock,
	channelLockPath,
	type ChannelLockMetadata,
	readChannelLock,
} from "../../src/channels/instance-lock";

const CONTENDER = path.join(import.meta.dir, "..", "fixtures", "channel-lock-contender.ts");
const cleanups: string[] = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		const dir = cleanups.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

/** Read stdout up to the first newline (the child may still be holding the lock). */
async function readResultLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!buffer.includes("\n")) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	return buffer.split("\n")[0];
}

async function makeLockDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-lock-contention-"));
	cleanups.push(dir);
	const lockPath = channelLockPath(dir);
	await fs.mkdir(path.dirname(lockPath), { recursive: true });
	return lockPath;
}

interface ContenderResult {
	ok: boolean;
	pid: number;
	holderPid: number | null;
}

describe("channel lock contention", () => {
	test("a second process never wins a live lock", async () => {
		const lockPath = await makeLockDir();
		const releasePath = path.join(path.dirname(path.dirname(lockPath)), "release");
		const startContender = () =>
			Bun.spawn([process.execPath, CONTENDER], {
				env: { ...process.env, ZETA_TEST_LOCK_PATH: lockPath, ZETA_TEST_RELEASE_PATH: releasePath },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
		const report = async (proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<ContenderResult> =>
			JSON.parse(await readResultLine(proc.stdout)) as ContenderResult;

		// The first contender holds the lock until the parent releases it, so the
		// second one always observes a live holder (no startup race).
		const holder = startContender();
		const held = await report(holder);
		expect(held.ok).toBe(true);

		const contender = startContender();
		const refused = await report(contender);
		expect(refused.ok).toBe(false);
		expect(refused.holderPid).toBe(held.pid);

		await fs.writeFile(releasePath, "go", "utf8");
		expect(await holder.exited).toBe(0);
		expect(await contender.exited).toBe(0);
		expect(await readChannelLock(lockPath, { isAlive: () => false })).toBeNull();
	}, 30_000);

	test("concurrent acquires in one process: exactly one wins", async () => {
		const lockPath = await makeLockDir();
		const results = await Promise.all(
			[0, 1].map(() =>
				acquireChannelLock({
					lockPath,
					metadata: { pid: process.pid, host: "cli", cwd: path.dirname(lockPath), channels: [] },
				}),
			),
		);
		const winners = results.filter(result => result.ok);
		expect(winners).toHaveLength(1);
		if (winners[0].ok) await winners[0].lock.release();
		expect(await readChannelLock(lockPath)).toBeNull();
	});

	test("an unparseable lock is retried, not stolen from a publisher", async () => {
		const lockPath = await makeLockDir();
		// Simulate an older writer that creates the file first and fills it in:
		// for a few milliseconds the path reads as garbage.
		await fs.writeFile(lockPath, "", "utf8");
		const live: ChannelLockMetadata = {
			version: 1,
			instanceId: "live-holder",
			pid: process.pid,
			host: "serve",
			startedAt: new Date().toISOString(),
			cwd: path.dirname(lockPath),
			channels: [],
		};
		const publish = (async () => {
			// Real wall-clock delay on purpose: the contract under test is the
			// acquisition retry loop's own real-time window, which fake timers
			// cannot drive inside `acquireChannelLock`'s async I/O.
			await Bun.sleep(20);
			await fs.writeFile(lockPath, `${JSON.stringify(live, null, 2)}\n`, "utf8");
		})();

		const result = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "cli", cwd: path.dirname(lockPath), channels: [] },
		});
		await publish;

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.holder?.metadata.instanceId).toBe("live-holder");
	});

	test("a corrupt lock is replaced once the retries are exhausted", async () => {
		const lockPath = await makeLockDir();
		await fs.writeFile(lockPath, "not json at all", "utf8");
		const result = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "cli", cwd: path.dirname(lockPath), channels: [] },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.lock.metadata.pid).toBe(process.pid);
			await result.lock.release();
		}
	});

	test("update() never exposes a partially written payload", async () => {
		const lockPath = await makeLockDir();
		const acquired = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "cli", cwd: path.dirname(lockPath), channels: [] },
		});
		expect(acquired.ok).toBe(true);
		if (!acquired.ok) return;
		// Readers racing the update must observe either the old or the new
		// payload, never an unparseable file.
		const reads = (async () => {
			const seen: string[] = [];
			for (let i = 0; i < 20; i++) {
				const snapshot = await readChannelLock(lockPath);
				seen.push(snapshot?.malformed ? "malformed" : (snapshot?.metadata.instanceId ?? "missing"));
			}
			return seen;
		})();
		const [seen] = await Promise.all([reads, acquired.lock.update({ channels: ["wechat", "telegram"] })]);
		expect(seen).not.toContain("malformed");
		expect(seen).not.toContain("missing");
		const snapshot = await readChannelLock(lockPath);
		expect(snapshot?.metadata.channels).toEqual(["wechat", "telegram"]);
		await acquired.lock.release();
	});

	test("channels login refuses while another host holds the lock", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-login-lock-"));
		cleanups.push(agentDir);
		const lockPath = channelLockPath(agentDir);
		await fs.mkdir(path.dirname(lockPath), { recursive: true });
		const held = await acquireChannelLock({
			lockPath,
			metadata: { pid: process.pid, host: "serve", cwd: agentDir, channels: ["wechat"] },
		});
		expect(held.ok).toBe(true);

		const repoRoot = path.resolve(import.meta.dir, "../../../..");
		const proc = Bun.spawn(
			[
				process.execPath,
				path.join(repoRoot, "packages/coding-agent/src/cli.ts"),
				"channels",
				"login",
				"wechat",
				"--json",
			],
			{
				env: { ...process.env, ZETA_CODING_AGENT_DIR: agentDir },
				cwd: repoRoot,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
		if (held.ok) await held.lock.release();

		expect(exitCode).toBe(1);
		const report = JSON.parse(stdout.trim()) as { channel: string; state: string; error: string };
		expect(report.channel).toBe("wechat");
		expect(report.state).toBe("locked");
		expect(report.error).toContain(String(process.pid));
	}, 30_000);
});
