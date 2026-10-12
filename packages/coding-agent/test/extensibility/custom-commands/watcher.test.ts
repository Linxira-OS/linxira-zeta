import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir, withTimeout } from "@linxiraos/pi-utils";
import { CustomCommandWatcher } from "../../../src/extensibility/custom-commands/watcher";

/**
 * These tests exercise real `fs.watch` events against the running clock: the
 * debounce window they assert on is driven by the platform filesystem, so fake
 * timers cannot reproduce the trigger. Every wait below either awaits the reload
 * the implementation is expected to emit or is one debounce window of slack
 * used to prove that no further reload arrives.
 */
const DEBOUNCE_MS = 200;
/** One debounce window plus slack: long enough that a queued reload would have run. */
const QUIET_MS = DEBOUNCE_MS + 250;

function commandSource(description: string): string {
	return [
		"export default () => ({",
		'\tname: "watched",',
		`\tdescription: ${JSON.stringify(description)},`,
		"\texecute() {},",
		"});",
		"",
	].join("\n");
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** Reload counter that can also await the next reload. */
class ReloadCounter {
	#count = 0;
	#waiters: Array<() => void> = [];
	readonly onChange = (): void => {
		this.#count++;
		for (const wake of this.#waiters.splice(0)) wake();
	};
	get count(): number {
		return this.#count;
	}
	reset(): void {
		this.#count = 0;
	}
	async waitForReload(timeoutMs = 10_000): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#waiters.push(resolve);
		await withTimeout(promise, timeoutMs, `Timed out after ${timeoutMs}ms waiting for a command reload`);
	}
}

interface WatchedCommand {
	tempDir: TempDir;
	root: string;
	commandDir: string;
	commandPath: string;
}

async function createWatchedCommand(): Promise<WatchedCommand> {
	const tempDir = TempDir.createSync("@pi-cmd-watch-");
	const root = tempDir.path();
	const commandDir = path.join(root, "commands", "watched");
	await fs.mkdir(commandDir, { recursive: true });
	const commandPath = path.join(commandDir, "index.ts");
	await fs.writeFile(commandPath, commandSource("first"));
	return { tempDir, root, commandDir, commandPath };
}

/** Arm the watcher and consume the reload its arm-time catch-up queues. */
async function startWatcher(root: string, counter: ReloadCounter): Promise<CustomCommandWatcher> {
	const watcher = new CustomCommandWatcher({
		cwd: root,
		agentDir: root,
		debounceMs: DEBOUNCE_MS,
		onChange: counter.onChange,
	});
	await watcher.start();
	await counter.waitForReload();
	counter.reset();
	return watcher;
}

describe("CustomCommandWatcher", () => {
	it("collapses a burst of edits into a single reload", async () => {
		const { tempDir, root, commandPath } = await createWatchedCommand();
		const counter = new ReloadCounter();
		const watcher = await startWatcher(root, counter);
		try {
			await fs.writeFile(commandPath, commandSource("second"));
			await fs.writeFile(commandPath, commandSource("third"));
			await fs.writeFile(commandPath, commandSource("fourth"));
			await counter.waitForReload();
			await sleep(QUIET_MS);

			expect(counter.count).toBe(1);
		} finally {
			watcher.stop();
			await tempDir.remove();
		}
	});

	it("ignores writes to files other than the command's index entry", async () => {
		const { tempDir, root, commandDir, commandPath } = await createWatchedCommand();
		const counter = new ReloadCounter();
		const watcher = await startWatcher(root, counter);
		try {
			await fs.writeFile(path.join(commandDir, "helper.ts"), "export const helper = 1;\n");
			await sleep(QUIET_MS);
			expect(counter.count).toBe(0);

			await fs.writeFile(commandPath, commandSource("second"));
			await counter.waitForReload();

			expect(counter.count).toBe(1);
		} finally {
			watcher.stop();
			await tempDir.remove();
		}
	});

	it("reloads when a command directory appears after the watch is armed", async () => {
		const { tempDir, root } = await createWatchedCommand();
		const counter = new ReloadCounter();
		const watcher = await startWatcher(root, counter);
		try {
			const lateDir = path.join(root, "commands", "late");
			await fs.mkdir(lateDir, { recursive: true });
			await fs.writeFile(path.join(lateDir, "index.ts"), commandSource("late"));
			await counter.waitForReload();

			expect(counter.count).toBeGreaterThanOrEqual(1);
		} finally {
			watcher.stop();
			await tempDir.remove();
		}
	});

	it("drops a queued reload once stopped", async () => {
		const { tempDir, root, commandPath } = await createWatchedCommand();
		const counter = new ReloadCounter();
		const watcher = await startWatcher(root, counter);
		try {
			watcher.stop();
			await fs.writeFile(commandPath, commandSource("after stop"));
			await sleep(QUIET_MS);

			expect(counter.count).toBe(0);
		} finally {
			watcher.stop();
			await tempDir.remove();
		}
	});
});
