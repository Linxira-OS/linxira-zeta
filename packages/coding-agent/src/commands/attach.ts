/**
 * `zetacode attach` — attach a full session view to the serve process's shared
 * session over the web-gateway protocol.
 *
 * The serve process hosts one coordinator session shared by the web UI's
 * default chat and every IM channel. This command resolves it through
 * `GET /api/agent/current`, renders the initial session transcript
 * (`GET /api/sessions/:id` — tree/leafId/context), then streams SSE events
 * live: `message_update` streams in-flight assistant output, `message_end`
 * finalizes, `session_entry` merges durable writes from other clients
 * (web, desktop, the agent itself) so every end shows the same session.
 * A small command set maps onto the generic mode protocol (`mode_enter` /
 * `mode_exit` / `set_model_role`); anything else is a follow-up message.
 */

import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { isRecord, readLines, VERSION, ZETA_GATEWAY_PORT } from "@linxiraos/pi-utils";
import { BackendClient, discoverBackends, sortSessionsNewestFirst } from "../backend/client";
import { workspaceBranch } from "../session/workspace-branch";
import {
	backendAttachRefusalHint,
	isBackendAttachLocalCommand,
	isBackendAttachRefusedCommand,
	isBackendAttachTuiOnlyBuiltin,
} from "../backend/attach-commands";
import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { attachHelp as commandHelp } from "../cli/command-help";
import { M } from "../i18n";

const DEFAULT_GATEWAY_URL = `http://127.0.0.1:${ZETA_GATEWAY_PORT}`;

/** Minimal shape of the gateway session DTO the renderer needs. */
interface SessionContextMessage {
	role?: string;
	content?: unknown;
}

interface SessionPayload {
	leafId?: string;
	context?: { messages?: SessionContextMessage[] };
}

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
		throw new Error("no shared session; start `zetacode serve` first");
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
		lines.push(M.imPlanModeEnabledFmt.replace("%s", modes.plan.planFilePath ?? "local://PLAN.md"));
	}
	if (modes?.goal?.enabled) {
		lines.push(M.imAttachGoalModeActiveFmt.replace("%s", modes.goal.goal?.objective ?? ""));
	}
	if (modes?.vibe?.enabled) {
		lines.push(M.imAttachVibeModeActive);
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

/** Render one context message to the transcript (user/assistant text). */
function renderContextMessage(msg: SessionContextMessage): void {
	const role = msg.role;
	const text = extractText(msg.content);
	if (!text) return;
	if (role === "user") {
		process.stdout.write(`\n[you] ${text.split("\n")[0]}\n`);
	} else if (role === "assistant") {
		process.stdout.write(`\n[zeta] ${text}\n`);
	}
}

/** Fetch and render the full session transcript (initial attach view). */
async function loadSessionTranscript(baseUrl: string, sessionId: string): Promise<void> {
	try {
		const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
		if (!res.ok) return; // standalone/session-not-on-disk: live view only
		const body = (await res.json()) as SessionPayload;
		const messages = body.context?.messages ?? [];
		for (const msg of messages) renderContextMessage(msg);
		if (messages.length > 0) {
			process.stdout.write(`\n— ${messages.length} message(s) in the shared session —\n`);
		}
	} catch {
		// transcript is best-effort; live stream still works
	}
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
Slash commands run on the backend; plain text is sent as a follow-up message.
Client-only commands (dashboards, pickers, theme) need the full TUI:
  zetacode --attach --attach-session <id>
`;

/** Print every backend session, across repositories, newest first. */
async function printSessionList(client: BackendClient): Promise<void> {
	const { sessions, runningSessionIds } = await client.listSessions({ archived: false });
	const running = new Set(runningSessionIds ?? []);
	if (sessions.length === 0) {
		process.stdout.write("No sessions.\n");
		return;
	}
	for (const session of sortSessionsNewestFirst(sessions)) {
		const marks = [running.has(session.id) ? "running" : "", session.temp ? "temp" : ""].filter(Boolean);
		const suffix = marks.length > 0 ? `  [${marks.join(", ")}]` : "";
		const name = session.name?.trim() || session.firstMessage?.split("\n")[0]?.trim() || "(untitled)";
		const branch = session.branch ?? session.worktreeBranch;
		const workspace = branch ? `${session.cwd || "?"} @ ${branch}` : session.cwd || "?";
		process.stdout.write(
			`${session.id}  ${workspace}  ${session.modified ?? session.created ?? ""}  ${name}${suffix}\n`,
		);
	}
}

/**
 * One backend, chosen explicitly. The plain `attach` client shares discovery
 * with the full TUI: defaulting to 43143 while several instances run would
 * silently attach to whichever one owns that port.
 */
async function resolveAttachBaseUrl(flagsUrl: string | undefined): Promise<string> {
	const explicit = flagsUrl ?? process.env.ZETA_GATEWAY_URL;
	if (explicit) return explicit.replace(/\/+$/, "");
	const all = await discoverBackends();
	const live = all.filter(backend => backend.identity.version === VERSION);
	if (live.length === 0 && all.length > 0) {
		throw new Error(
			`The reachable backend runs zeta ${all[0]!.identity.version}, this client is ${VERSION}; ` +
				"start a matching `zetacode serve` or upgrade the client.",
		);
	}
	if (live.length > 1) {
		throw new Error(
			`${live.length} zeta backends are live:\n` +
				live.map(backend => `  - pid ${backend.identity.pid} at ${backend.baseUrl}`).join("\n") +
				"\nPass --url <url> to choose one.",
		);
	}
	return (live[0]?.baseUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
}

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
		list: Flags.boolean({ description: "List backend sessions across all repositories and exit" }),
		new: Flags.boolean({
			description: "Create a fresh session in the current (or --cwd) directory and attach to it",
		}),
		cwd: Flags.string({ description: "Working directory for --new (default: current directory)" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Attach);
		const baseUrl = await resolveAttachBaseUrl(flags.url);
		const client = new BackendClient(baseUrl);
		if (flags.list) {
			await printSessionList(client);
			return;
		}
		let sessionId = args["session-id"];
		if (!sessionId && flags.new) {
			const cwd = path.resolve(flags.cwd ?? process.cwd());
			sessionId = await client.createSession(cwd, workspaceBranch(cwd));
		}
		sessionId ??= await resolveSharedSessionId(baseUrl);

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

		// Full transcript view: render what's already persisted, then the live
		// SSE stream keeps every end in step from this point on.
		await loadSessionTranscript(baseUrl, sessionId);

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
					case "/restart": {
						if (argText && argText !== "backend") {
							process.stdout.write("Usage: /restart [backend]\n");
							break;
						}
						// The plain client has no host process to restart; ask the
						// gateway's serve host and stop this stream cleanly.
						const res = await fetch(`${baseUrl}/api/server/restart`, { method: "POST" });
						const body = (await res.json().catch(() => ({}))) as { accepted?: boolean; reason?: string };
						if (!res.ok || body.accepted !== true) {
							throw new Error(body.reason ?? `restart refused (HTTP ${res.status})`);
						}
						process.stdout.write("Backend restarting; re-run `zetacode attach` after it is back.\n");
						done();
						break;
					}
					default:
						if (line.startsWith("/")) {
							const verb = line.slice(1).split(/\s+/, 1)[0] ?? "";
							if (verb === "new" || verb === "resume") {
								process.stderr.write(
									`/${verb} starts another attach here: zetacode attach --new, or zetacode attach <id>\n`,
								);
								break;
							}
							if (isBackendAttachRefusedCommand(verb)) {
								process.stderr.write(
									`/${verb} is not available while attached: ${backendAttachRefusalHint(verb)}\n`,
								);
								break;
							}
							if (isBackendAttachLocalCommand(verb)) {
								process.stderr.write(
									`/${verb} is a client-side command; run it in the full TUI (zetacode --attach)\n`,
								);
								break;
							}
							if (isBackendAttachTuiOnlyBuiltin(verb)) {
								process.stderr.write(`/${verb} needs the full TUI: zetacode --attach\n`);
								break;
							}
							// Backend-capable builtins (and custom commands) execute with the
							// backend's own session; a follow-up would be injected as text and
							// never dispatched.
							await postCommand(baseUrl, sessionId, { type: "prompt", message: line });
							break;
						}
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

/** Stream the session's SSE event channel and print transcript/mode updates. */
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
						process.stdout.write(`${M.imPlanModeEnabledFmt.replace("%s", planFilePathOf(raw))}\n`);
					} else if (mode === "goal") {
						process.stdout.write(`${M.imAttachGoalModeActiveFmt.replace("%s", goalObjectiveOf(raw))}\n`);
					} else {
						process.stdout.write(`${M.imAttachVibeModeActive}\n`);
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
					if (text) process.stdout.write(`\n[zeta] ${text}\n`);
				}
				break;
			}
			case "session_entry": {
				// A durable write landed from another end (web, desktop, the
				// agent's own custom entries). Assistant turns already stream
				// through message_end; surface incoming user turns so attach
				// users see cross-client activity.
				const entry = event.entry;
				if (
					isRecord(entry) &&
					entry.type === "message" &&
					isRecord(entry.message) &&
					entry.message.role === "user"
				) {
					const text = extractText(entry.message.content);
					if (text) process.stdout.write(`\n[you] ${text.split("\n")[0]}\n`);
				}
				break;
			}
			default:
				break;
		}
	}
}
