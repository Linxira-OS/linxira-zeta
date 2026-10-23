/**
 * Descriptors zeta holds for its own lifetime — session/advisor transcripts and
 * the rotating log — must not reach the commands the bash tool runs.
 *
 * The bash tool executes through the natives brush shell, which `fork`/`exec`s
 * external commands and therefore hands every inheritable descriptor to them
 * (the same property pinned by `config-value-fd-inheritance.test.ts`). Bun's
 * `fs.open*` omitted `O_CLOEXEC` where libuv adds it (Bun 1.4.3 started adding
 * it; older Bun still satisfies the `bun@>=1.4` pin), so before #13224 a
 * command — or any daemon it started — held a writable handle to the session
 * it was launched from for its whole life.
 *
 * Oracle: list the child's descriptor table. `sh -c` is required — a bare `ls`
 * resolves to an in-process builtin, whose `$$` is zeta itself. A deliberately
 * inheritable control descriptor (the exact `fs.openSync(path, "a")` shape the
 * pre-fix writer used) runs in the same child so the assertions cannot pass
 * vacuously. /proc makes this Linux-only; the helper's flag handling is
 * covered on every platform by `packages/utils/test/fs-open.test.ts`.
 *
 * The control must be made inheritable *explicitly* rather than leaning on the
 * runtime's default. bun 1.4.3 sets `O_CLOEXEC` inside `fs.open*` — the
 * runtime-side half of the same #13224 fix — so there a bare `fs.openSync`-ed
 * descriptor never reaches the child (`/proc/self/fdinfo/<fd>` reports
 * `FD_CLOEXEC` clear on 1.4.2, set on 1.4.3), while 1.4.0/1.4.2 hand it over.
 * {@link duplicateInheritable} duplicates the descriptor instead: `dup(2)`
 * never carries `FD_CLOEXEC`, so the control exists on either runtime and the
 * assertions below keep their full discriminating power. `package.json` still
 * pins bun exactly (`scripts/check-ci-surface.ts`'s `bun-pin-exact`) so the
 * runtime CI uses stays a deliberate, reviewable choice.
 */
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { Shell } from "@linxiraos/pi-natives";
import { RotatingFileSink } from "@linxiraos/pi-utils/logger/rotating-file";
import { removeWithRetries } from "@linxiraos/pi-utils";
import { FileSessionStorage } from "../src/session/session-storage";

const ROOTS: string[] = [];

/**
 * Build the oracle's positive control: open `filePath`, then `dup(2)` it so the
 * descriptor survives the `fork`/`exec` the brush shell performs. A duplicate
 * never carries `FD_CLOEXEC` whatever the runtime left on the original (see the
 * header), which is what keeps the control independent of bun's `fs.open*`
 * defaults. The raw handle is released here; the caller owns the duplicate.
 *
 * Only `dup` goes through `bun:ffi`: `fcntl` is variadic and its third argument
 * would be read from the stack on arm64-darwin, so the repo keeps to dup/dup2
 * for descriptor work (`packages/utils/src/stderr-guard.ts`).
 */
function openInheritableControl(filePath: string): number {
	const raw = fs.openSync(filePath, "a");
	try {
		for (const soname of ["libc.so.6", "libc.so"]) {
			try {
				const libc = dlopen(soname, { dup: { args: [FFIType.i32], returns: FFIType.i32 } });
				try {
					return libc.symbols.dup(raw);
				} finally {
					libc.close();
				}
			} catch {
				// bun:ffi unavailable or this soname missing; try the next candidate.
			}
		}
	} finally {
		fs.closeSync(raw);
	}
	throw new Error("libc `dup` unavailable: the fd-inheritance control cannot be built");
}

afterAll(async () => {
	for (const root of ROOTS) await removeWithRetries(root).catch(() => {});
});

test.skipIf(process.platform !== "linux")("bash tool children never inherit session or log descriptors", async () => {
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), "zeta-session-fd-"));
	ROOTS.push(root);
	const transcript = path.join(root, "session.jsonl");
	const logsDir = path.join(root, "logs");
	await fsp.mkdir(logsDir, { recursive: true });
	const logSink = new RotatingFileSink({
		directory: logsDir,
		filenamePrefix: "zeta",
		filenameSuffix: String(process.pid),
		maxBytes: 1 << 20,
		maxFiles: 2,
	});
	logSink.write("entry");

	const control = path.join(root, "control.jsonl");
	const controlFd = openInheritableControl(control);

	const script = `import { Shell } from "@oh-my-pi/pi-natives";
import { RotatingFileSink } from "@oh-my-pi/pi-utils/logger/rotating-file";
import * as fsp from "node:fs/promises";
import { FileSessionStorage } from ${JSON.stringify(sessionStorageUrl)};

const writer = new FileSessionStorage().openWriter(${JSON.stringify(transcript)});
await writer.append('{"type":"session_start"}\\n');
await fsp.mkdir(${JSON.stringify(logsDir)}, { recursive: true });
const logSink = new RotatingFileSink({
	directory: ${JSON.stringify(logsDir)},
	filenamePrefix: "omp",
	filenameSuffix: String(process.pid),
	maxBytes: 1 << 20,
	maxFiles: 2,
});
logSink.write("entry");

let output = "";
try {
	await new Shell().run({ command: "sh -c 'ls -l /proc/$$/fd'", cwd: ${JSON.stringify(root)} }, (_err, chunk) => {
		output += chunk;
	});
} finally {
	logSink.close();
	await writer.close();
}
process.stdout.write(output);
`;

	const controlFd = fs.openSync(control, "a");
	let stdout: string;
	let stderr: string;
	let exitCode: number;
	try {
		const proc = Bun.spawn({
			cmd: [process.execPath, "--eval", script],
			cwd: path.join(import.meta.dir, ".."),
			stdio: ["ignore", "pipe", "pipe", controlFd],
			timeout: 30_000,
		});
		[stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
	} finally {
		fs.closeSync(controlFd);
	}

	const inherited = output.split("\n").filter(line => line.includes(root));
	expect(inherited.join("\n"), "control: an inheritable descriptor must reach the child").toContain(control);
	expect(inherited.join("\n")).not.toContain(transcript);
	expect(inherited.join("\n")).not.toMatch(/zeta\.[\d-]+\.\d+\.log/);
});
