/**
 * Web Gateway npx wrapper.
 *
 * Semantic port of `web-ui/lib/npx.ts`: cross-platform `npx <args>` invocation
 * without a shell, so user-controlled arguments are never interpreted as
 * shell syntax.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execPath } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Locate `npx-cli.js` shipped with the running Node.js installation.
 *
 * On Windows the `npx` on PATH is actually `npx.cmd`, which Node.js (since
 * 20.12 due to CVE-2024-27980) refuses to spawn from `execFile`/`spawn`
 * without `shell: true`. Going through a shell reintroduces quoting bugs for
 * user-supplied args. Instead we find the real `npx-cli.js` and invoke it
 * directly via the current `node` binary, which works identically on every
 * platform and needs no shell.
 */
function findNpxCli(): string | null {
	const nodeDir = dirname(execPath);
	const candidates = [
		// Windows MSI installer layout: node.exe and node_modules share a dir
		join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
		// Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
		join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
	];
	for (const p of candidates) {
		try {
			if (existsSync(p)) return p;
		} catch {
			// ignore
		}
	}
	return null;
}

/** An argv pair `execFile` can spawn without a shell. */
export interface NpxInvocation {
	readonly command: string;
	readonly commandArgs: string[];
}

/**
 * Resolve the `npx <args>` equivalent for the current runtime.
 *
 * - **Bun**: `bun x <args>` — Bun's package runner, built into the running Bun
 *   binary. This mirrors `npx` argument-for-argument and, like the Node path,
 *   never needs a shell. Bun ships no `npx-cli.js`, so {@link findNpxCli} can
 *   never match there: `process.execPath` is the Bun binary, whose
 *   `node_modules/npm` layout does not exist.
 * - **Node**: the `npx-cli.js` shipped with the running Node (see
 *   {@link findNpxCli}), falling back to a bare `npx` on `PATH`.
 */
export function resolveNpxInvocation(args: string[]): NpxInvocation {
	// `Bun` is a Bun-only global; its presence means we are the Bun runtime.
	if (typeof Bun !== "undefined") {
		return { command: execPath, commandArgs: ["x", ...args] };
	}
	const npxCli = findNpxCli();
	return npxCli ? { command: execPath, commandArgs: [npxCli, ...args] } : { command: "npx", commandArgs: args };
}

export interface RunNpxOptions {
	timeout?: number;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

export interface RunNpxResult {
	stdout: string;
	stderr: string;
}

export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
	const { command, commandArgs } = resolveNpxInvocation(args);
	return execFileAsync(command, commandArgs, {
		timeout: opts.timeout,
		cwd: opts.cwd,
		env: opts.env,
	});
}
