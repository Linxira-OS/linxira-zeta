import { $which, isRecord } from "@linxiraos/pi-utils";
import { REJECT_PROMPT_COMMAND } from "../exec/non-interactive-env";
import { ToolAbortError, throwIfAborted } from "../tools/tool-errors";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";

/** Captured result of a completed `tea` invocation. */
export interface TeaCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Options shaping `tea` failure messages and output handling. */
export interface TeaCommandOptions {
	/** Caller passed an explicit repo; suppresses "run inside a checkout" hints. */
	repoProvided?: boolean;
	/** Trim captured output (default true). */
	trimOutput?: boolean;
}

/** Deadline for `tea` subprocesses spawned by the coding agent. */
export const TEA_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

const TEA_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
const TEA_TRUNCATED_MARKER = "\n[tea subprocess output truncated after 8 MiB]\n";
const TEA_NON_INTERACTIVE_ENV = {
	...process.env,
	GIT_ASKPASS: "true",
	GIT_EDITOR: "true",
	GIT_TERMINAL_PROMPT: "0",
	LC_ALL: undefined,
	LC_MESSAGES: "C",
	SSH_ASKPASS: REJECT_PROMPT_COMMAND,
};

async function readCappedText(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let captured = 0;
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (captured < TEA_OUTPUT_LIMIT_BYTES) {
				const take = Math.min(value.byteLength, TEA_OUTPUT_LIMIT_BYTES - captured);
				if (take > 0) chunks.push(value.subarray(0, take));
				captured += take;
			}
		}
	} finally {
		reader.releaseLock();
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return total > TEA_OUTPUT_LIMIT_BYTES ? `${text}${TEA_TRUNCATED_MARKER}` : text;
}

function formatTeaFailure(
	args: readonly string[],
	stdout: string,
	stderr: string,
	options?: TeaCommandOptions,
): string {
	const message = (stderr || stdout).trim();
	if (message.includes("tea login") || message.toLowerCase().includes("no gitea login")) {
		return "Gitea CLI not authenticated. Run `tea login`.";
	}
	if (
		!options?.repoProvided &&
		(message.includes("not a git repository") ||
			message.includes("no git remotes found") ||
			message.includes("TARGET_DIR"))
	) {
		return "Gitea repository context is unavailable. Pass `repo` explicitly or run the tool inside a Gitea checkout.";
	}
	if (message) return message;
	return `Gitea CLI command failed: tea ${args.join(" ")}`;
}

/** Project a Gitea API error payload into a human-readable message list. */
function describeGiteaApiError(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (!isRecord(value)) return undefined;
	if (typeof value.message === "string") return value.message.trim() || undefined;
	return undefined;
}

function parseGiteaApiErrorMessages(stdout: string): string[] {
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return [];
	}
	if (!isRecord(payload)) return [];

	const messages = new Set<string>();
	const summary = describeGiteaApiError(payload.message);
	if (summary) messages.add(summary);
	if (Array.isArray(payload.errors)) {
		for (const error of payload.errors) {
			const message = describeGiteaApiError(error);
			if (message) messages.add(message);
		}
	}
	return [...messages];
}

function formatTeaJsonFailure(
	args: readonly string[],
	stdout: string,
	stderr: string,
	options?: TeaCommandOptions,
): string {
	const rawMessage = (stderr || stdout).trim();
	const fallback = formatTeaFailure(args, stdout, stderr, options);
	if (fallback !== rawMessage) return fallback;
	const details = parseGiteaApiErrorMessages(stdout).filter(message => !fallback.includes(message));
	if (details.length === 0) return fallback;
	return `${fallback}\nGitea details:\n${details.map(message => `- ${message}`).join("\n")}`;
}

/** The sanctioned `tea` CLI runner: non-interactive env, bounded capture, deadline. */
export const gitea = {
	/** Check if the `tea` CLI is installed. */
	available(): boolean {
		return Boolean($which("tea"));
	},

	/** Run a raw `tea` CLI command. Does not throw on non-zero exit. */
	async run(
		cwd: string,
		args: string[],
		signal?: AbortSignal,
		options?: TeaCommandOptions,
	): Promise<TeaCommandResult> {
		throwIfAborted(signal);
		if (!$which("tea")) {
			throw new ToolError("Gitea CLI (tea) is not installed. Install it from https://gitea.com/gitea/tea.");
		}
		const timeoutSignal = AbortSignal.timeout(TEA_COMMAND_TIMEOUT_MS);
		const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		try {
			const child = Bun.spawn(["tea", ...args], {
				cwd,
				env: TEA_NON_INTERACTIVE_ENV,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				windowsHide: true,
				signal: combinedSignal,
			});
			if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) {
				throw new ToolError("Failed to capture Gitea CLI output.");
			}
			const [stdout, stderr, exitCode] = await Promise.all([
				readCappedText(child.stdout),
				readCappedText(child.stderr),
				child.exited,
			]);
			throwIfAborted(signal);
			const trim = options?.trimOutput !== false;
			return {
				exitCode: exitCode ?? 0,
				stdout: trim ? stdout.trim() : stdout,
				stderr: trim ? stderr.trim() : stderr,
			};
		} catch (error) {
			if (signal?.aborted) throw new ToolAbortError();
			if (timeoutSignal.aborted) throw new ToolError(`Gitea CLI command timed out: tea ${args.join(" ")}`);
			throw error;
		}
	},

	/** Run `tea` and parse stdout as JSON. Throws on non-zero exit or invalid JSON. */
	async json<T>(cwd: string, args: string[], signal?: AbortSignal, options?: TeaCommandOptions): Promise<T> {
		const result = await gitea.run(cwd, args, signal, options);
		if (result.exitCode !== 0) {
			throw new ToolError(formatTeaJsonFailure(args, result.stdout, result.stderr, options));
		}
		if (!result.stdout) throw new ToolError("Gitea CLI returned empty output.");
		try {
			return JSON.parse(result.stdout) as T;
		} catch {
			throw new ToolError("Gitea CLI returned invalid JSON output.");
		}
	},

	/** Run `tea` and return stdout as text. Throws on non-zero exit. */
	async text(cwd: string, args: string[], signal?: AbortSignal, options?: TeaCommandOptions): Promise<string> {
		const result = await gitea.run(cwd, args, signal, options);
		if (result.exitCode !== 0) throw new ToolError(formatTeaFailure(args, result.stdout, result.stderr, options));
		return result.stdout;
	},
};
