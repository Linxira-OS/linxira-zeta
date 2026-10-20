/**
 * Child-process contender for `channels/instance-lock`.
 *
 * Acquires the lock at `ZETA_TEST_LOCK_PATH`, prints one JSON line describing
 * the result, then — when `ZETA_TEST_RELEASE_PATH` is set — holds the lock
 * until the parent creates that file. The handshake keeps the contention test
 * deterministic: the parent starts the second contender only after the first
 * one definitely holds the lock, instead of racing process startup.
 */
import * as fs from "node:fs/promises";
import { acquireChannelLock } from "../../src/channels/instance-lock";

const lockPath = process.env.ZETA_TEST_LOCK_PATH;
if (!lockPath) throw new Error("ZETA_TEST_LOCK_PATH is required");

const result = await acquireChannelLock({
	lockPath,
	metadata: { pid: process.pid, host: "cli", cwd: process.cwd(), channels: [] },
});
process.stdout.write(
	`${JSON.stringify({
		ok: result.ok,
		pid: process.pid,
		holderPid: result.ok ? null : (result.holder?.metadata.pid ?? null),
	})}\n`,
);
if (result.ok) {
	const releasePath = process.env.ZETA_TEST_RELEASE_PATH;
	if (releasePath) {
		// Cross-process signal: the only portable handshake is a file the parent
		// creates once the sibling contender has reported its refusal.
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline && !(await fs.stat(releasePath).catch(() => null))) {
			await Bun.sleep(20);
		}
	}
	await result.lock.release();
}
