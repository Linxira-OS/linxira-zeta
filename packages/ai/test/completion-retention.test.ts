import { describe, expect, test } from "bun:test";
import * as path from "node:path";

describe("completion event retention", () => {
	for (const completion of ["complete", "completeSimple"]) {
		for (const outcome of ["success", "failure"]) {
			test(
				`${completion} releases events before ${outcome} settles the response`,
				async () => {
					const child = Bun.spawn(
						[
							process.execPath,
							path.join(import.meta.dir, "fixtures/completion-retention.ts"),
							completion,
							outcome,
						],
						{ stdout: "pipe", stderr: "pipe" },
					);
					// Windows cold Bun spawn under the gate's parallel chunk load can exceed 10 s;
					// keep the tight Linux guard and give Windows a load-tolerant one.
					const timeout = setTimeout(() => child.kill(), process.platform === "win32" ? 30_000 : 10_000);
					try {
						const [stdout, stderr, exitCode] = await Promise.all([
							new Response(child.stdout).text(),
							new Response(child.stderr).text(),
							child.exited,
						]);
						expect({ exitCode, stderr, stdout }).toEqual({ exitCode: 0, stderr: "", stdout: "verified\n" });
					} finally {
						clearTimeout(timeout);
						child.kill();
						await child.exited;
					}
				},
				process.platform === "win32" ? 60_000 : 15_000,
			);
		}
	}
});
