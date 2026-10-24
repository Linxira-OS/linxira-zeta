/**
 * `--backend` print runner: send prompts to a running `zetacode serve`
 * session and print its reply, instead of owning an AgentSession in-process.
 *
 * This is the explicit opt-in the CLI documents; plain `-p` keeps the local
 * path. The prompt/answer protocol is the same gateway RPC the web UI uses.
 */

import type { ImageContent } from "@linxiraos/pi-ai";
import { isRecord } from "@linxiraos/pi-utils";
import { BackendClient } from "./client";
import { BackendAttachError, resolveBackendTarget, type BackendAttachIntent } from "./attach-intent";
import { workspaceBranch } from "../session/workspace-branch";

export interface BackendPrintOptions {
	intent: BackendAttachIntent;
	cwd: string;
	messages: string[];
	images?: ImageContent[];
	mode: "text" | "json";
	printThoughts?: boolean;
	onNotice?: (line: string) => void;
	env?: Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	registryFile?: string;
}

/** Text payload of one assistant message, optionally including thinking blocks. */
export function assistantMessageText(message: unknown, includeThinking = false): string {
	if (!isRecord(message) || !Array.isArray(message.content)) return "";
	const parts: string[] = [];
	for (const block of message.content) {
		if (!isRecord(block) || typeof block.type !== "string") continue;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		if (includeThinking && block.type === "thinking" && typeof block.thinking === "string") {
			parts.push(block.thinking);
		}
	}
	return parts.join("\n");
}

/**
 * Route the prompt(s) through the backend and emit the selected output format.
 * Returns the process exit code (0 = at least one answer, 1 = backend missing
 * or the command failed).
 */
export async function runBackendPrintMode(options: BackendPrintOptions): Promise<number> {
	let target;
	try {
		target = await resolveBackendTarget(options.intent, {
			env: options.env,
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
			registryFile: options.registryFile,
			cwd: options.cwd,
		});
	} catch (error) {
		if (!(error instanceof BackendAttachError)) throw error;
		process.stderr.write(`Error: ${error.message}\n`);
		return 1;
	}
	if (!target) {
		process.stderr.write(
			options.intent.explicit
				? "Error: --backend requested but no running `zetacode serve` backend was reachable.\n"
				: "Error: backend mode is enabled but no default backend is running. Run `zetacode backend on`, or use `--standalone`.\n",
		);
		return 1;
	}

	const client = new BackendClient(target.backend.baseUrl, options.fetchImpl);
	const { sessionId } = await client.resolveSession({
		cwd: options.cwd,
		branch: workspaceBranch(options.cwd),
		sessionId: options.intent.sessionId,
		newSession: options.intent.newSession,
	});

	(options.onNotice ?? (() => undefined))(`Attached to backend session ${sessionId}`);
	const abort = new AbortController();
	let lastAssistantText = "";
	let sawAnswer = false;
	const connected = Promise.withResolvers<void>();
	let turnEnd: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	let streamFailure: Error | undefined;

	const settleTurn = (error?: Error): void => {
		const pending = turnEnd;
		turnEnd = undefined;
		if (!pending) return;
		if (error) pending.reject(error);
		else pending.resolve();
	};

	const stream = (async () => {
		for await (const event of client.events(sessionId, { signal: abort.signal })) {
			connected.resolve();
			if (options.mode === "json") {
				process.stdout.write(`${JSON.stringify(event)}\n`);
			}
			if (event.type === "message_end" && isRecord(event.message) && event.message.role === "assistant") {
				const text = assistantMessageText(event.message, options.printThoughts);
				if (text) lastAssistantText = text;
			}
			if (event.type === "agent_end") settleTurn();
		}
	})().catch(error => {
		if (abort.signal.aborted) return;
		streamFailure = error instanceof Error ? error : new Error(String(error));
		connected.reject(streamFailure);
		settleTurn(streamFailure);
	});

	try {
		await connected.promise;
	} catch (error) {
		process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
		abort.abort();
		await stream;
		return 1;
	}

	const prompts = [...options.messages];
	try {
		for (let index = 0; index < prompts.length; index++) {
			const text = prompts[index]!;
			const ended = Promise.withResolvers<void>();
			turnEnd = ended;
			await client.send(
				sessionId,
				{
					type: "prompt",
					message: text,
					...(index === 0 && options.images && options.images.length > 0 ? { images: options.images } : {}),
				},
				abort.signal,
			);
			await ended.promise;
			if (options.mode === "text" && lastAssistantText) {
				process.stdout.write(`${lastAssistantText}\n`);
				sawAnswer = true;
				lastAssistantText = "";
			}
		}
	} catch (error) {
		process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	} finally {
		abort.abort();
		await stream;
	}
	if (streamFailure) {
		process.stderr.write(`Error: ${streamFailure.message}\n`);
		return 1;
	}
	return sawAnswer || prompts.length === 0 ? 0 : 1;
}
