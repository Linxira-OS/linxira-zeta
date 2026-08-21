/**
 * `zeta attach` — attach a lightweight REPL to the serve process's shared
 * session over the web-gateway protocol.
 *
 * The serve process hosts one coordinator session shared by the web UI's
 * default chat and every IM channel. This command resolves it through
 * `GET /api/agent/current`, prints its AgentState v2 snapshot (model, role,
 * active modes), streams SSE events live, and maps a small command set onto
 * the generic mode protocol (`mode_enter` / `mode_exit` / `set_model_role`).
 * It is a lightweight status + control client, not a full TUI.
 */

import { createInterface } from "node:readline/promises";
import { isRecord, readLines } from "@linxiraos/pi-utils";
import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { attachHelp as commandHelp } from "../cli/command-help";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:30142";

interface ModeStateSnapshot {
	plan?: { enabled: boolean; planFilePath?: string };
	goal?: { enabled: boolean; goal?: { objective?: string } };
	vibe?: { enabled: boolean };
}

interface AgentStateSnapshot {
	sessionId?: string;
	sessionName?: string;
	model?: { provider: string; modelId: string } | null;
	modelRole?: string | null;
	modes?: ModeStateSnapshot;
}

/** Resolve the serve process's shared coordinator session id. */
async function resolveSharedSessionId(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/api/agent/current`);
	if (res.status === 404) {
		throw new Error("no shared session; start `zeta serve` first");
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { sessionId?: string; error?: string };
	if (!body.sessionId) throw new Error(body.error ?? "no shared session");
	return body.sessionId;
}

/** Render the active mode banners from an AgentState v2 `modes` snapshot. */
function describeModes(modes: ModeStateSnapshot | undefined): string[] {
	const lines: string[] = [];
	if (modes?.plan?.enabled) {
		lines.push(`Plan mode enabled. Plan file: ${modes.plan.planFilePath ?? "local://PLAN.md"}`);
	}
	if (modes?.goal?.enabled) {
		lines.push(`Goal mode active: ${modes.goal.goal?.objective ?? ""}`);
	}
	if (modes?.vibe?.enabled) {
		lines.push("Vibe mode active");
	}
	return lines;
}

async function postCommand(baseUrl: string, sessionId: string, command: Record<string, unknown>): Promise<void> {
	const res = await fetch(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(command),
	});
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
}

/** Extract plain text from an assistant message's content (string or blocks). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
			parts.push(String(block.text ?? ""));
		}
	}
	return parts.join("\n");
}

/** Read `planFilePath` from an untyped mode-state payload, or the default. */
function planFilePathOf(raw: unknown): string {
	if (isRecord(raw) && typeof raw.planFilePath === "string" && raw.planFilePath !== "") {
		return raw.planFilePath;
	}
	return "local://PLAN.md";
}

/** Read the goal objective from an untyped mode-state payload, or "". */
function goalObjectiveOf(raw: unknown): string {
	if (isRecord(raw) && isRecord(raw.goal) && typeof raw.goal.objective === "string") {
		return raw.goal.objective;
	}
	return "";
}

const HELP_TEXT = `Commands:
  /plan [task]         Enter plan mode (optional first task)
  /exit-plan           Exit plan mode
  /goal <objective>    Enter goal mode
  /exit-goal           Exit goal mode
  /vibe                Enter vibe mode
  /exit-vibe           Exit vibe mode
  /set-role <role>     Switch to a configured model role (e.g. plan, smol)
  /help                Show this help
  /exit                Detach (Ctrl-C also works)
Anything else is sent as a follow-up message to the shared session.
`;

export default class Attach extends Command {
	static description = commandHelp.description;
	static args = {
		"session-id": Args.string({
			description: "Session id to attach to (default: the serve process's shared session)",
			required: false,
		}),
	};
	static flags = {
		url: Flags.string({
			description: `Web gateway base URL (default ${DEFAULT_GATEWAY_URL}; env ZETA_GATEWAY_URL overrides)`,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Attach);
		const baseUrl = (flags.url ?? process.env.ZETA_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
		const sessionId = args["session-id"] ?? (await resolveSharedSessionId(baseUrl));

		// Initial AgentState v2 snapshot.
		const stateRes = await fetch(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}`);
		if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
		const stateBody = (await stateRes.json()) as { state?: AgentStateSnapshot };
		const state = stateBody.state;
		process.stdout.write(`Attached to ${state?.sessionName || "shared session"} (${sessionId})\n`);
		if (state?.model) {
			const role = state.modelRole ? ` (${state.modelRole})` : "";
			process.stdout.write(`Model: ${state.model.provider}/${state.model.modelId}${role}\n`);
		}
		for (const line of describeModes(state?.modes)) {
			process.stdout.write(`${line}\n`);
		}

		const abort = new AbortController();
		void streamEvents(baseUrl, sessionId, abort.signal).catch(error => {
			process.stderr.write(`Event stream closed: ${error instanceof Error ? error.message : String(error)}\n`);
		});

		const rl = createInterface({ input: process.stdin, output: process.stdout });
		let exiting = false;
		const done = (): void => {
			exiting = true;
			abort.abort();
			rl.close();
		};
		const interrupt = (): void => {
			process.stdout.write("\nBye.\n");
			done();
		};
		process.on("SIGINT", interrupt);

		const handleLine = async (raw: string): Promise<void> => {
			const line = raw.trim();
			if (!line) return;
			try {
				if (line === "/exit" || line === "/quit") {
					process.stdout.write("Bye.\n");
					done();
					return;
				}
				if (line === "/help") {
					process.stdout.write(HELP_TEXT);
					return;
				}
				const [verb, ...rest] = line.split(/\s+/);
				const argText = rest.join(" ").trim();
				switch (verb) {
					case "/plan":
						await postCommand(baseUrl, sessionId, {
							type: "mode_enter",
							mode: "plan",
							...(argText ? { options: { initialPrompt: argText } } : {}),
						});
						break;
					case "/exit-plan":
						await postCommand(baseUrl, sessionId, { type: "mode_exit", mode: "plan" });
						break;
					case "/goal":
						if (!argText) {
							process.stdout.write("Usage: /goal <objective>\n");
							break;
						}
						await postCommand(baseUrl, sessionId, {
							type: "mode_enter",
							mode: "goal",
							options: { objective: argText },
						});
						break;
					case "/exit-goal":
						await postCommand(baseUrl, sessionId, { type: "mode_exit", mode: "goal" });
						break;
					case "/vibe":
						await postCommand(baseUrl, sessionId, { type: "mode_enter", mode: "vibe" });
						break;
					case "/exit-vibe":
						await postCommand(baseUrl, sessionId, { type: "mode_exit", mode: "vibe" });
						break;
					case "/set-role":
						if (!argText) {
							process.stdout.write("Usage: /set-role <role>\n");
							break;
						}
						await postCommand(baseUrl, sessionId, { type: "set_model_role", role: argText });
						break;
					default:
						await postCommand(baseUrl, sessionId, { type: "follow_up", text: line });
						break;
				}
			} catch (error) {
				process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
			}
		};

		try {
			if (process.stdin.isTTY) {
				// Interactive REPL: prompt per line, exit on Ctrl-C/Ctrl-D.
				while (!exiting) {
					let raw: string;
					try {
						raw = await rl.question("attach> ");
					} catch {
						break; // readline closed (stdin EOF)
					}
					await handleLine(raw);
				}
			} else {
				// Piped input: process every line in order, then detach.
				for await (const raw of rl) {
					if (exiting) break;
					await handleLine(raw);
				}
			}
		} finally {
			process.off("SIGINT", interrupt);
			abort.abort();
		}
	}
}

/** Stream the session's SSE event channel and print mode/message changes. */
async function streamEvents(baseUrl: string, sessionId: string, signal: AbortSignal): Promise<void> {
	const res = await fetch(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}/events`, { signal });
	if (!res.ok || !res.body) throw new Error(`event stream HTTP ${res.status}`);
	const decoder = new TextDecoder();
	for await (const chunk of readLines(res.body)) {
		if (signal.aborted) break;
		const trimmed = decoder.decode(chunk).trim();
		if (!trimmed.startsWith("data:")) continue;
		const payload = trimmed.slice(5).trim();
		if (!payload) continue; // SSE heartbeat
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(payload) as Record<string, unknown>;
		} catch {
			continue;
		}
		switch (event.type) {
			case "mode_changed": {
				const mode = event.mode;
				if (mode !== "plan" && mode !== "goal" && mode !== "vibe") break;
				const raw = event.state;
				if (isRecord(raw) && raw.enabled === true) {
					if (mode === "plan") {
						process.stdout.write(`Plan mode enabled. Plan file: ${planFilePathOf(raw)}\n`);
					} else if (mode === "goal") {
						process.stdout.write(`Goal mode active: ${goalObjectiveOf(raw)}\n`);
					} else {
						process.stdout.write("Vibe mode active\n");
					}
				} else if (mode === "plan") {
					process.stdout.write("Plan mode disabled.\n");
				} else if (mode === "goal") {
					process.stdout.write("Goal mode disabled.\n");
				} else {
					process.stdout.write("Vibe mode disabled.\n");
				}
				break;
			}
			case "message_end": {
				const message = event.message;
				if (isRecord(message) && message.role === "assistant") {
					const text = extractText(message.content);
					if (text) process.stdout.write(`\n${text}\n`);
				}
				break;
			}
			default:
				break;
		}
	}
}
