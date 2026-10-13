// Integration test — real timers are required (ts-no-test-timers exception): this drives the actual
// cross-process daemon broker running a real child process, and the bug is a missing idle-shutdown
// rearm in #settle. Fake timers cannot control the OS process-exit promise or the unix-socket RPC,
// and shutdown is observed by awaiting the broker's own run() promise — its resolution IS the signal
// (no polling, no fixed sleep). A regression leaves the broker alive, so the test's own timeout
// surfaces the failure.
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { startDaemonBrokerFromEnvironment } from "../../src/launch/broker";
import { createDaemonBrokerClient } from "../../src/launch/client";
import { DAEMON_IDLE_GRACE_ENV, DAEMON_PROJECT_DIR_ENV, DAEMON_RUNTIME_DIR_ENV } from "../../src/launch/protocol";

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

interface EmbeddedBroker {
	/** Settles once this in-process broker has shut down and released its lease. */
	finished: Promise<void>;
}

/**
 * Start the in-process broker and wait until it actually owns the scope.
 *
 * A client that connects before the broker has bound its endpoint does not wait:
 * it spawns a broker *process* for the same scope, and that process can claim the
 * scope in the broker-restart handoff. The test would then be driving — and
 * awaiting the shutdown of — a broker it does not own, while the scope's records
 * live in a detached process nothing here tracks. `onListening` is the broker's
 * own "accepting connections" signal, so a request issued after this resolves
 * always reaches the broker started here; a broker that loses the race resolves
 * `finished` instead and the test fails loudly rather than flaking.
 */
async function startBroker(projectDir: string, runtimeDir: string, idleGraceMs: number): Promise<EmbeddedBroker> {
	const previousProjectDir = process.env[DAEMON_PROJECT_DIR_ENV];
	const previousRuntimeDir = process.env[DAEMON_RUNTIME_DIR_ENV];
	const previousGrace = process.env[DAEMON_IDLE_GRACE_ENV];
	process.env[DAEMON_PROJECT_DIR_ENV] = projectDir;
	process.env[DAEMON_RUNTIME_DIR_ENV] = runtimeDir;
	process.env[DAEMON_IDLE_GRACE_ENV] = String(idleGraceMs);
	const listening = Promise.withResolvers<boolean>();
	const finished = startDaemonBrokerFromEnvironment({ onListening: () => listening.resolve(true) });
	restoreEnv(DAEMON_PROJECT_DIR_ENV, previousProjectDir);
	restoreEnv(DAEMON_RUNTIME_DIR_ENV, previousRuntimeDir);
	restoreEnv(DAEMON_IDLE_GRACE_ENV, previousGrace);
	const claimed = await Promise.race([listening.promise, finished.then(() => false)]);
	if (!claimed) throw new Error("In-process daemon broker did not claim its scope");
	return { finished };
}

describe("daemon broker idle shutdown", () => {
	it("shuts down after its last persistent daemon exits with no clients", async () => {
		using tempDir = TempDir.createSync("@omp-launch-idle-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fs.mkdir(projectDir);

		const previousTitle = process.title;
		// Create the client (writes broker.token) before starting the broker, which reads that token.
		// Creation is lazy: the connection is opened by the first request, after the claim below.
		const client = await createDaemonBrokerClient(projectDir, { runtimeDir, idleGraceMs: 100 });
		const broker = await startBroker(projectDir, runtimeDir, 100);
		try {
			// A persistent daemon that outlives the first idle-shutdown timer (100ms) and then
			// self-exits (~300ms). restart:"no" so its exit is terminal.
			const started = await client.request({
				op: "start",
				spec: {
					name: "persistent-temp",
					application: process.execPath,
					args: ["-e", "setTimeout(() => {}, 300)"],
					env: {},
					cwd: projectDir,
					pty: false,
					restart: "no",
					persist: true,
					detached: false,
				},
			});
			expect(started.op).toBe("start");

			// Disconnect the final client. The broker keeps the persistent daemon alive, so the
			// idle timer this arms fires while the daemon is still live and returns without rearming.
			client.close();

			// When the daemon self-exits, terminal settlement must rearm idle shutdown; the broker
			// then releases its lease and run() resolves. Awaiting the broker promise IS the shutdown
			// signal. Before the fix nothing rearmed, so this await never resolved and the test timed
			// out — the regression this guards.
			await broker.finished;
		} finally {
			process.title = previousTitle;
		}
	}, 30_000);

	// The process really dying is the assertion, and a client cannot be connected while
	// observing it (a connected client cancels the sweep). Real timers are unavoidable
	// for the same reason this file's header gives: the broker drives real child
	// processes, so the wait below polls a real PID death — it ends the instant the
	// process is gone, and the deadline only bounds failure.
	function isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	/** Child program that stays alive until terminated: no timer, no exit, no executor form. */
	const neverExits = ["-e", "await Promise.withResolvers().promise"];

	it("stops a non-persist daemon once the last client leaves, even while a persist daemon keeps the broker alive", async () => {
		using tempDir = TempDir.createSync("@omp-launch-idle-oneshot-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fs.mkdir(projectDir);

		const client = await createDaemonBrokerClient(projectDir, { runtimeDir, idleGraceMs: 100 });
		const broker = await startBroker(projectDir, runtimeDir, 100);
		try {
			// Keeps the broker up across the idle sweep: on its own that used to be reason
			// enough to keep every other daemon alive, so the project-shared browser
			// (`persist: false`, like `oneshot-temp` here) stayed in the background after
			// zeta exited and was visible only in the task manager.
			const holder = await client.request({
				op: "start",
				spec: {
					name: "persist-holder",
					application: process.execPath,
					args: neverExits,
					env: {},
					cwd: projectDir,
					pty: false,
					restart: "no",
					persist: true,
					detached: false,
				},
			});
			expect(holder.op).toBe("start");

			const oneshot = await client.request({
				op: "start",
				spec: {
					name: "oneshot-temp",
					application: process.execPath,
					args: neverExits,
					env: {},
					cwd: projectDir,
					pty: false,
					restart: "no",
					persist: false,
					detached: false,
				},
			});
			expect(oneshot.op).toBe("start");
			const pid = oneshot.op === "start" ? oneshot.daemon.pid : undefined;
			expect(typeof pid).toBe("number");

			client.close();

			// No client, no project presence => nothing can own a oneshot daemon.
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline && isAlive(pid as number)) await Bun.sleep(50);
			expect(isAlive(pid as number)).toBe(false);
		} finally {
			// Release the holder so nothing keeps the broker up, then await that broker's own
			// run() promise rather than a guessed duration. `startBroker` already proved this test
			// owns the scope, so this stop reaches the broker that registered `persist-holder`
			// instead of an unattached broker process that would answer `Unknown daemon`.
			const stopper = await createDaemonBrokerClient(projectDir, { runtimeDir, idleGraceMs: 100 });
			await stopper.request({ op: "stop", name: "persist-holder", timeoutMs: 2_000 });
			stopper.close();
			await broker.finished;
		}
	}, 30_000);
});
