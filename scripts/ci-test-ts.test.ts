import { describe, expect, test } from "bun:test";
import { ptree, TempDir } from "@linxiraos/pi-utils";
import { selectShard } from "./ci-test-ts";

describe("test runner watchdog", () => {
	// Parent fake timers cannot drive the real watchdog inside the isolated runner process.
	test("kills a stalled chunk, reports failure, and continues the queue", async () => {
		using dir = TempDir.createSync("@omp-test-runner-watchdog-");
		const started = dir.join("started");
		const completed = dir.join("completed");
		const continued = dir.join("continued");
		const stalledCommand = [
			process.execPath,
			"-e",
			`await Bun.write(${JSON.stringify(started)}, "started"); await Bun.sleep(60_000); await Bun.write(${JSON.stringify(completed)}, "completed");`,
		];
		const nextCommand = [process.execPath, "-e", `await Bun.write(${JSON.stringify(continued)}, "continued");`];
		const commands = [
			{ label: "stalled chunk", cwd: ".", command: stalledCommand },
			{ label: "following chunk", cwd: ".", command: nextCommand },
		];
		// The child mirrors its own stdout into `childLog` as it arrives: a timed-out
		// ptree.exec throws with only a message, so without this a wedged runner is
		// undiagnosable from the CI log. The budget covers the watchdog (1 s), the
		// process-tree diagnostics the kill path runs first (abandoned after their own
		// SNAPSHOT_BUDGET_MS) and the following chunk, with room for a loaded runner;
		// the chunk timeout stays at 1 s, so a watchdog that never fired still shows up
		// here as a timeout rather than as a silent pass.
		const childLog = dir.join("child.log");
		const source = [
			`import { appendFileSync } from "node:fs";`,
			`const write = process.stdout.write.bind(process.stdout);`,
			`process.stdout.write = (chunk, ...rest) => { try { appendFileSync(${JSON.stringify(childLog)}, chunk); } catch {} return write(chunk, ...rest); };`,
			`const { runTestCommandsInParallel } = await import(${JSON.stringify(import.meta.resolve("./ci-test-ts.ts"))});`,
			`await runTestCommandsInParallel(${JSON.stringify(commands)}, 1);`,
		].join("\n");
		let result: Awaited<ReturnType<typeof ptree.exec>> | undefined;
		let failure: unknown;
		try {
			result = await ptree.exec([process.execPath, "-e", source], {
				env: { ...Bun.env, OMP_TEST_CHUNK_TIMEOUT: "1", NO_COLOR: "1" },
				timeout: 20_000,
				detached: true,
				allowNonZero: true,
			});
		} catch (error) {
			failure = error;
		}
		if (failure !== undefined) {
			const log = await Bun.file(childLog)
				.text()
				.catch(() => "(no child output)");
			expect(
				false,
				`runner child did not exit: ${String(failure)}\n--- child output ---\n${log.slice(-4000)}`,
			).toBeTrue();
		}

		expect(result?.exitCode).toBe(1);
		expect(result?.stdout).toContain("[watchdog]");
		expect(await Bun.file(started).exists()).toBe(true);
		expect(await Bun.file(completed).exists()).toBe(false);
		expect(await Bun.file(continued).text()).toBe("continued");
	}, 25_000);
});

describe("chunk exit classification", () => {
	// A CLI command run in process sets `process.exitCode` to report a status, a test
	// asserts that value and does not always put it back, and the runner inherits it: the
	// coding-agent native bucket's test/cli chunk printed a complete, failure-free bun
	// summary and still exited 1 on three consecutive attempts. Retrying cannot help, so
	// bun's own summary decides — which these two cases pin from both sides.
	async function runOne(script: string): Promise<Awaited<ReturnType<typeof ptree.exec>>> {
		const commands = [{ label: "chunk under test", cwd: ".", command: [process.execPath, "-e", script] }];
		const source = [
			`const { runTestCommandsInParallel } = await import(${JSON.stringify(import.meta.resolve("./ci-test-ts.ts"))});`,
			`await runTestCommandsInParallel(${JSON.stringify(commands)}, 1);`,
		].join("\n");
		return ptree.exec([process.execPath, "-e", source], {
			env: { ...Bun.env, NO_COLOR: "1" },
			timeout: 20_000,
			detached: true,
			allowNonZero: true,
		});
	}

	test("a nonzero exit with a clean bun summary counts as passed", async () => {
		const result = await runOne(
			`console.log(" 66 pass\\n 2 skip\\n 0 fail\\n 216 expect() calls\\nRan 68 tests across 10 files. [8.7s]"); process.exit(1);`,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("clean summary");
		expect(result.stdout).toContain("1 chunks passed");
		expect(result.stdout).toContain("0 failed");
	});

	test("a reported failing test still fails the chunk", async () => {
		const result = await runOne(
			`console.log(" 1 pass\\n 1 fail\\nRan 2 tests across 1 file. [1.0s]"); process.exit(1);`,
		);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("1 failed");
	});
});

describe("OMP_TEST_SHARD", () => {
	test("shards partition every chunk exactly once, balanced to within one", () => {
		const chunks = Array.from({ length: 79 }, (_, i) => i);
		const shards = [1, 2, 3].map(i => selectShard(chunks, `${i}/3`));
		expect(shards.flat().sort((a, b) => a - b)).toEqual(chunks);
		const sizes = shards.map(s => s.length);
		expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
		expect(selectShard(chunks, "1/1")).toEqual(chunks);
		expect(selectShard(chunks, undefined)).toEqual(chunks);
	});

	test("rejects malformed specs instead of running an empty or partial shard", () => {
		for (const spec of ["0/2", "3/2", "1/0", "2", "a/b", "1/2/3"]) {
			expect(() => selectShard([1, 2, 3], spec)).toThrow("Invalid OMP_TEST_SHARD");
		}
	});

	test("rejects a shard that selects no chunks", () => {
		expect(() => selectShard([1], "2/2")).toThrow("selects no chunks");
		expect(() => selectShard([], "1/1")).toThrow("selects no chunks");
	});
});
