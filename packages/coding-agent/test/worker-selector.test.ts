import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { runCli } from "../src/cli";
import * as computerWorkerEntry from "../src/tools/computer/worker-entry";

// The worker-host re-entry seam dispatches any `__zeta_worker_*` selector to
// `runWorkerEntrypoint`. An unrecognized selector must fail loudly rather than
// exit 0 with empty output, so a stale/mistyped selector cannot look healthy to
// a parent process or install smoke path (issue #5712).
describe("worker selector dispatch", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = 0;
	});

	it("fails with a nonzero exit and stderr error on an unknown selector", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await runCli(["__zeta_worker_does_not_exist"]);

		expect(process.exitCode).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Error: unknown worker selector: __zeta_worker_does_not_exist\n");
	});
	it("declares workerHostEntry in process entry before dispatching worker selector", async () => {
		const repoRoot = path.resolve(__dirname, "../../..");
		const proc = Bun.spawn({
			cmd: [
				process.execPath,
				"-e",
				`
				import { workerHostEntry } from "./packages/utils/src/worker-host.ts";
				await import("./packages/coding-agent/src/cli.ts");
				process.stdout.write("ENTRY=" + (workerHostEntry() ?? "null"));
				process.exit(0);
				`,
				"__omp_worker_does_not_exist",
			],
			cwd: repoRoot,
			env: { ...process.env, PI_COMPILED: "true" },
			stdout: "pipe",
			stderr: "ignore",
		});
		const stdout = await new Response(proc.stdout).text();
		expect(stdout).toContain("ENTRY=");
		expect(stdout).not.toBe("ENTRY=null");
	});

	it("leaves normal root flags untouched", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await runCli(["--version"]);

		expect(process.exitCode).toBe(0);
		expect(stdout).toHaveBeenCalled();
		expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("unknown worker selector"));
	});
});

describe("computer worker entry", () => {
	it("is side-effect-free to import outside a worker and exposes a named start function", () => {
		// Importing on the main thread (no parentPort) must not start the worker
		// core; the CLI host and bundled hosts call the exported hook explicitly.
		expect(computerWorkerEntry.startComputerWorker).toBeFunction();
	});
});
