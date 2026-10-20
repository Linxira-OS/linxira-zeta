/**
 * Helpers for the mesh integration tests: spawn `mesh-node-child.ts` as a real
 * second process and read its tagged stdout lines.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const CHILD = path.join(import.meta.dir, "..", "fixtures", "mesh-node-child.ts");

export interface MeshChild {
	proc: ReturnType<typeof Bun.spawn>;
	workspaceId: string;
	address: string;
	pid: number;
	/** Send one driver line to the child. */
	command(line: string): Promise<void>;
	/** Wait for a tagged line (`SEND`, `WAIT`, `DELIVERED`, …). */
	next<T = unknown>(tag: string, timeoutMs?: number): Promise<T>;
	/** Ask the child to shut down cleanly and wait for `STOPPED`. */
	stop(): Promise<void>;
	/** Hard-kill the child (crash-recovery tests). */
	kill(): void;
	/** Everything the child wrote to stderr so far (diagnostics). */
	stderr(): string;
}

interface TaggedLine {
	tag: string;
	value: unknown;
}

/** Tagged NDJSON reader with tag-selective take(). */
class ChildOutput {
	readonly #lines: TaggedLine[] = [];
	readonly #waiters: { tag: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
	#closed = false;
	#error: string | undefined;
	#onClose: (() => void) | undefined;
	/** Diagnostics supplier attached by the spawn helper. */
	stderrText: () => string = () => "";

	onClose(callback: () => void): void {
		this.#onClose = callback;
	}

	push(raw: string): void {
		const line = raw.trim();
		if (!line) return;
		if (line.startsWith("ERROR")) {
			this.#error = line.slice("ERROR ".length);
			for (const waiter of this.#waiters.splice(0)) {
				waiter.reject(new Error(`mesh child error: ${this.#error}`));
			}
			return;
		}
		const space = line.indexOf(" ");
		const tag = space === -1 ? line : line.slice(0, space);
		let value: unknown = null;
		if (space !== -1) {
			try {
				value = JSON.parse(line.slice(space + 1));
			} catch {
				value = line.slice(space + 1);
			}
		}
		const index = this.#waiters.findIndex(waiter => waiter.tag === tag);
		if (index !== -1) {
			const [waiter] = this.#waiters.splice(index, 1);
			waiter!.resolve(value);
			return;
		}
		this.#lines.push({ tag, value });
	}

	close(): void {
		this.#closed = true;
		this.#onClose?.();
	}

	async take<T>(tag: string, timeoutMs: number): Promise<T> {
		const index = this.#lines.findIndex(line => line.tag === tag);
		if (index !== -1) {
			const [line] = this.#lines.splice(index, 1);
			return line!.value as T;
		}
		if (this.#error) throw new Error(`mesh child error: ${this.#error}`);
		if (this.#closed) throw new Error(`mesh child closed before "${tag}"`);
		return await new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				const indexOf = this.#waiters.findIndex(waiter => waiter.resolve === settle);
				if (indexOf !== -1) this.#waiters.splice(indexOf, 1);
				const stderr = this.stderrText().trim();
				reject(new Error(`timed out waiting for "${tag}"${stderr ? `; stderr: ${stderr}` : ""}`));
			}, timeoutMs);
			const settle = (value: unknown): void => {
				clearTimeout(timer);
				resolve(value as T);
			};
			this.#waiters.push({ tag, resolve: settle, reject });
		});
	}
}

export interface SpawnMeshChildOptions {
	workspaceRoot: string;
	meshRoot: string;
	alias?: string;
	workspaceId?: string;
	reply?: boolean;
	deliverLog?: string;
	/** Extra env for the child (tests isolate HOME-free paths explicitly). */
	env?: Record<string, string>;
}

/** Start one mesh child and wait for its READY line. */
export async function spawnMeshChild(options: SpawnMeshChildOptions): Promise<MeshChild> {
	await fs.mkdir(options.workspaceRoot, { recursive: true });
	await fs.mkdir(options.meshRoot, { recursive: true });
	const args = [CHILD, "--root", options.workspaceRoot, "--mesh", options.meshRoot];
	if (options.alias) args.push("--alias", options.alias);
	if (options.workspaceId) args.push("--id", options.workspaceId);
	if (options.reply) args.push("--reply");
	if (options.deliverLog) args.push("--deliver-log", options.deliverLog);
	const proc = Bun.spawn([process.execPath, ...args], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...options.env },
	});
	const output = new ChildOutput();
	let stderrText = "";
	proc.exited.then(() => output.close()).catch(() => {});
	void (async () => {
		const decoder = new TextDecoder();
		let buffer = "";
		const reader = proc.stdout.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newline = buffer.indexOf("\n");
				while (newline !== -1) {
					output.push(buffer.slice(0, newline));
					buffer = buffer.slice(newline + 1);
					newline = buffer.indexOf("\n");
				}
			}
		} catch {
			// The process exited; waiters fail through output.close().
		}
	})();
	void (async () => {
		const decoder = new TextDecoder();
		const reader = proc.stderr.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				stderrText += decoder.decode(value, { stream: true });
			}
		} catch {
			// ignore
		}
	})();

	output.stderrText = () => stderrText;
	const ready = await output.take<{ workspaceId: string; address: string; pid: number }>("READY", 30_000);
	let stopped = false;
	let sequence = 0;
	return {
		proc,
		workspaceId: ready.workspaceId,
		address: ready.address,
		pid: ready.pid,
		command: async line => {
			// The fixture acknowledges every line (`GOT`) and deduplicates by the
			// sequence number, so retrying a lost pipe write is safe: a line that
			// did arrive is acknowledged but never executed twice.
			const id = ++sequence;
			for (let attempt = 0; attempt < 6; attempt++) {
				if (proc.exitCode !== null) throw new Error("mesh child already exited");
				try {
					proc.stdin.write(`#${id} ${line}\n`);
					proc.stdin.flush();
				} catch {
					// The child exited between the check and the write.
				}
				const got = await output.take<{ sequence?: number; line: string }>("GOT", 1_500).catch(() => undefined);
				if (got?.sequence === id) return;
			}
			throw new Error(`mesh child never acknowledged "${line}"`);
		},
		next: (tag, timeoutMs = 30_000) => output.take(tag, timeoutMs),
		stop: async () => {
			// Tests and afterEach hooks both clean up; only the first call may wait
			// for the (single) STOPPED line.
			if (stopped) return;
			stopped = true;
			// A crashed/timed-out child is already gone; writing to its stdin
			// throws EPIPE (sometimes asynchronously), so check first and never
			// let cleanup surface a rejection.
			if (proc.exitCode === null) {
				try {
					proc.stdin.write("stop\n");
					proc.stdin.flush();
				} catch {
					// already gone
				}
			}
			await output.take("STOPPED", 2_000).catch(() => {});
			await Promise.race([proc.exited, Bun.sleep(2_000)]).catch(() => {});
		},
		kill: () => {
			proc.kill("SIGKILL");
		},
		stderr: () => stderrText,
	};
}

/** Fresh temp dir inside the OS temp root. */
export async function tempDir(prefix: string): Promise<string> {
	return await fs.mkdtemp(path.join(os.tmpdir(), `zeta-${prefix}-`));
}
