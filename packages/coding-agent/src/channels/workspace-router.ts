/**
 * workspace command router — parses channel messages that control the
 * multi-workspace relay (plain-text grammar for ordinary IM chats).
 *
 * | sub-command | action |
 * |---|---|
 * | `@workspace help` | print usage |
 * | `@workspace list` | list workspaces (alias + path) and this chat's binding |
 * | `@workspace open <path> [alias]` | register an existing directory as a workspace |
 * | `@workspace create <path> [alias]` | mkdir -p the directory and register it |
 * | `@workspace close <alias>` | stop the workspace session and unregister it |
 * | `@workspace rename <old> <new>` | change a workspace alias |
 * | `@workspace use <alias>` | direct-mode: talk to that workspace now |
 * | `@workspace relay` | switch this chat back to the relay coordinator |
 * | `@workspace bind <alias>` | persist this chat → workspace binding |
 * | `@workspace unbind` | remove this chat's binding, back to relay |
 * | `@workspace bindings` | list every persisted binding for this platform |
 * | `*<alias>` | shorthand for `@workspace use <alias>` |
 * | `*relay` / `*back` / `*main` | shorthand for `@workspace relay` |
 *
 * Messages that don't match any control command are returned as-is via
 * the `fallback` callback so the caller can route them to the coordinator
 * (relay mode) or a bound workspace (direct mode).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@linxiraos/pi-utils";
import { COORDINATOR_ALIAS, type SessionRouter } from "./session-router";

export interface WorkspaceRouterDeps {
	/** The router that owns workspace sessions + bindings (null in CLI mode). */
	router: SessionRouter | null;
	/** Channel id of the current inbound (wechat | feishu | telegram). */
	channelId: string;
	/** Peer (chat id) of the current inbound. */
	peer: string;
	sendText(text: string): Promise<void>;
	/** Called when the message is NOT a control command. */
	fallback(body: string, peer: string): Promise<void>;
	/** Start a remote plan-mode request (`@plan <title>`) on the coordinator. */
	planRequest(title: string): Promise<void>;
	/** Running channel status for `!status` (zero AI). */
	channelStatus?: () => { id: string; running: boolean }[];
	/** Available models grouped by provider (stable order) for `!model`. */
	listModels?: () => Promise<{ provider: string; models: string[] }[]>;
	/** Switch the chat's current target session model (`!model <provider> <id>`). */
	setChatModel?: (
		provider: string,
		modelId: string,
	) => Promise<{ ok: true; provider: string; modelId: string } | { ok: false; error: string }>;
	/** Current model of the chat's target session (`!status`). */
	getChatModel?: () => Promise<{ provider: string; modelId: string } | null>;
}

const PREFIXES = ["@workspace", "!workspace"];
const PLAN_PREFIXES = ["@plan", "!plan"];
const HELLO_PREFIXES = ["!hello", "!helo"];
const SESSION_PREFIXES = ["!session", "@session"];
const LANG_PREFIXES = ["!lang", "@lang"];
const MODEL_PREFIXES = ["!model", "@model"];
const WORK_PREFIXES = ["!work", "@work"];
const DRAFT_PREFIXES = ["!draft", "@draft"];
const STATUS_PREFIXES = ["!status", "@status"];
const HELP_PREFIXES = ["!help", "@help"];

/** Full-width punctuation typed by Chinese IMEs maps to its ASCII control form. */
const FULL_WIDTH_MAP: Record<string, string> = {
	"！": "!",
	"＠": "@",
	"＊": "*",
	"：": ":",
	"　": " ",
};

/** Normalize full-width punctuation/space so IM grammar works regardless of IME. */
export function normalizeFullWidth(input: string): string {
	return input.replace(/[！＠＊：　]/g, ch => FULL_WIDTH_MAP[ch]);
}

const PLATFORM_LABEL: Record<string, string> = {
	wechat: "WeChat",
	feishu: "Feishu",
	telegram: "Telegram",
};

function resolvePath(p: string): string | null {
	if (path.isAbsolute(p)) return p;
	// In practice only absolute paths are expected for workspace dirs, but a
	// Windows drive-relative path without a leading slash may still be intended.
	const candidate = path.resolve(p);
	return candidate;
}

/**
 * Resolve a control command from an inbound message.
 * Returns `true` when the message was consumed (a control command), `false`
 * when it should fall through to normal routing.
 */
export async function routeWorkspaceCommand(body: string, _peer: string, deps: WorkspaceRouterDeps): Promise<boolean> {
	// Normalize full-width punctuation (`！`/`＠`/`＊`/全角空格) that Chinese IMEs
	// produce so command grammar never depends on the input method.
	const trimmed = normalizeFullWidth(body).trim();
	const lower = trimmed.toLowerCase();
	const router = deps.router;

	// `!help` — full command reference (zero AI).
	if (HELP_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix} `))) {
		await deps.sendText(HELP_TEXT);
		return true;
	}

	// `!status` — local state overview (zero AI).
	if (STATUS_PREFIXES.some(prefix => lower === prefix)) {
		await sendStatus(deps);
		return true;
	}

	// `!hello` / `!helo` — binding verification: reply with the platform name
	// so the user can confirm which bot they are talking to.
	for (const helloPrefix of HELLO_PREFIXES) {
		if (lower.startsWith(helloPrefix)) {
			const label = PLATFORM_LABEL[deps.channelId] ?? deps.channelId;
			await deps.sendText(
				`[${label}] Zeta bot is connected. ` +
					(router ? "Type !help for the command list." : "Type @plan <task> to start."),
			);
			return true;
		}
	}

	// `!session ...` — default-space bot session management (zero AI).
	if (SESSION_PREFIXES.some(prefix => lower.startsWith(`${prefix} `))) {
		await runSessionCommand(trimmed, deps);
		return true;
	}

	// `!lang <zh|en>` — set this chat's reply language (zero AI).
	if (LANG_PREFIXES.some(prefix => lower.startsWith(`${prefix} `))) {
		await runLangCommand(trimmed, deps);
		return true;
	}

	// `!model [<provider>-<model>]` — list / switch models by number (zero AI).
	if (
		MODEL_PREFIXES.some(prefix => lower.startsWith(`${prefix} `)) ||
		MODEL_PREFIXES.some(prefix => lower === prefix)
	) {
		await runModelCommand(trimmed, deps);
		return true;
	}

	// `!work [workspace:<alias>] <task>` — explicit AI task dispatch.
	if (WORK_PREFIXES.some(prefix => lower.startsWith(`${prefix} `)) || WORK_PREFIXES.some(prefix => lower === prefix)) {
		return runWorkCommand(trimmed, deps);
	}

	// `!draft <task>` — temporary default-space task (fresh draft session).
	if (DRAFT_PREFIXES.some(prefix => lower.startsWith(`${prefix} `))) {
		await runDraftCommand(trimmed, deps);
		return true;
	}

	// `@plan` / `!plan <title>` — remote plan-mode request.
	const planPrefix = PLAN_PREFIXES.find(p => lower.startsWith(p));
	if (planPrefix) {
		const title = trimmed.slice(planPrefix.length).trim();
		if (title) {
			await deps.planRequest(title);
		} else {
			await deps.sendText("Usage: @plan <task description>");
		}
		return true;
	}

	// `*<alias>` shortcuts: `*web` → use workspace "web"; `*relay`/`*back`/`*main` → relay.
	if (trimmed.startsWith("*")) {
		if (!router) return false;
		const target = trimmed.slice(1).trim().toLowerCase();
		if (!target) return false;
		if (target === "relay" || target === "back" || target === COORDINATOR_ALIAS) {
			await useRelay(deps);
			return true;
		}
		if (router.resolveDir(target)) {
			await switchToWorkspace(deps, target);
			return true;
		}
		return false; // unknown alias → normal message
	}

	const prefix = PREFIXES.find(p => lower.startsWith(p));
	if (!prefix) return false;

	const rest = trimmed.slice(prefix.length).trim();
	const parts = rest.split(/\s+/);
	const cmd = parts[0]?.toLowerCase();

	switch (cmd) {
		case "help":
		case "?":
			await deps.sendText(
				[
					"!hello                      — verify this bot is connected",
					"!workspace commands (or @workspace):",
					"  list                        — workspaces + this chat's binding",
					"  open <path> [alias]         — register a directory (alias defaults to folder name)",
					"  create <path> [alias]       — mkdir -p + register",
					"  close <alias>               — unregister + stop session",
					"  rename <old> <new>          — rename an alias",
					"  use <alias>                 — talk directly to that workspace",
					"  relay                       — switch back to the relay coordinator",
					"  bind <alias>                — persist this chat → workspace binding",
					"  unbind                      — remove this chat's binding",
					"  bindings                    — list bindings for this platform",
					"Shorthands: *<alias> (direct), *relay / *back / *main (relay)",
				].join("\n"),
			);
			return true;

		case "list": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const entries = router.list();
			const binding = await router.bindingFor(deps.channelId as never, deps.peer);
			if (entries.length === 0) {
				await deps.sendText(["工作区: 无", thisChatLine(binding)].join("\n"));
				return true;
			}
			const lines = ["工作区:"];
			for (const [index, entry] of entries.entries()) {
				lines.push(`{${index + 1}} [${entry.alias}] → ${entry.path}`);
				const sessions = await router.listWorkspaceSessions(entry.alias);
				if (sessions.length > 0) {
					sessions.forEach((session, sessionIndex) => {
						lines.push(`    {${index + 1}-${sessionIndex + 1}} [${session.title}]`);
					});
				}
			}
			lines.push(thisChatLine(binding));
			await deps.sendText(lines.join("\n"));
			return true;
		}

		case "open":
		case "create": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			// Paths may contain spaces: honor `"path" [alias]` quoting, and for
			// `open` fall back to treating the whole remainder as the path when
			// that names an existing directory. Unquoted `create <path> [alias]`
			// keeps token parsing (the path need not exist yet).
			const remainder = rest.slice(cmd.length).trim();
			let dir: string;
			let alias: string | undefined;
			const quoted = /^(["'])(.+?)\1(?:\s+(\S+))?$/.exec(remainder);
			if (quoted) {
				dir = quoted[2];
				alias = quoted[3]?.trim() || undefined;
			} else {
				const toks = remainder.split(/\s+/);
				dir = toks[0];
				alias = toks[1]?.trim() || undefined;
				if (cmd === "open" && toks.length > 2) {
					const joined = toks.join(" ");
					const isDir = await fs
						.stat(joined)
						.then(s => s.isDirectory())
						.catch(() => false);
					if (isDir) {
						dir = joined;
						alias = undefined;
					}
				}
			}
			if (!dir) {
				await deps.sendText(`Usage: @workspace ${cmd} <absolute-path> [alias]`);
				return true;
			}
			const resolved = resolvePath(dir);
			if (!resolved) {
				await deps.sendText(`Invalid path: ${dir}`);
				return true;
			}
			if (cmd === "create") {
				try {
					await fs.mkdir(resolved, { recursive: true });
				} catch (error) {
					logger.error("Failed to create workspace directory", { dir: resolved, error: String(error) });
					await deps.sendText(`Failed to create directory: ${resolved}`);
					return true;
				}
			} else {
				try {
					const stat = await fs.stat(resolved);
					if (!stat.isDirectory()) {
						await deps.sendText(`Not a directory: ${resolved}`);
						return true;
					}
				} catch (error) {
					if (isEnoent(error)) {
						await deps.sendText(`Directory does not exist: ${resolved} (use @workspace create to make it)`);
					} else {
						logger.error("Failed to stat workspace directory", { dir: resolved, error: String(error) });
						await deps.sendText(`Failed to access: ${resolved}`);
					}
					return true;
				}
			}
			const result = await router.open(resolved, alias);
			if (result.ok) {
				await deps.sendText(`Workspace [${result.alias}] → ${resolved}`);
			} else {
				await deps.sendText(`Failed to register workspace: ${result.error}`);
			}
			return true;
		}

		case "close": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const name = parts[1];
			if (!name) {
				await deps.sendText("Usage: @workspace close <alias>");
				return true;
			}
			const result = await router.close(name);
			if (result.ok) {
				await deps.sendText(`Workspace [${name}] closed.`);
			} else {
				await deps.sendText(result.error);
			}
			return true;
		}

		case "rename": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const oldName = parts[1];
			const newName = parts[2];
			if (!oldName || !newName) {
				await deps.sendText("Usage: @workspace rename <old-alias> <new-alias>");
				return true;
			}
			const result = await router.rename(oldName, newName);
			if (result.ok) {
				await deps.sendText(`Workspace renamed: [${oldName}] → [${result.alias}]`);
			} else {
				await deps.sendText(result.error);
			}
			return true;
		}

		case "use": {
			const alias = parts[1];
			if (!alias) {
				await deps.sendText("Usage: @workspace use <alias>");
				return true;
			}
			await switchToWorkspace(deps, alias);
			return true;
		}

		case "relay":
		case "back":
		case "main":
			await useRelay(deps);
			return true;

		case "bind": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const alias = parts[1];
			if (!alias) {
				await deps.sendText("Usage: @workspace bind <alias>");
				return true;
			}
			const result = await router.bindChat(deps.channelId as never, deps.peer, alias);
			if (result.ok) {
				await deps.sendText(
					`This chat is now bound to [${alias}] (direct mode). Use @workspace relay to switch back.`,
				);
			} else {
				await deps.sendText(result.error);
			}
			return true;
		}

		case "unbind": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const removed = await router.unbindChat(deps.channelId as never, deps.peer);
			await deps.sendText(
				removed
					? "Binding removed; this chat now goes through the relay coordinator."
					: "No binding for this chat.",
			);
			return true;
		}

		case "bindings": {
			if (!router) {
				await deps.sendText("No workspace router in this mode.");
				return true;
			}
			const bindings = router.bindingsForPlatform(deps.channelId as never);
			if (bindings.length === 0) {
				await deps.sendText(`No bindings for ${deps.channelId}.`);
			} else {
				await deps.sendText(
					[
						`Bindings for ${deps.channelId}:`,
						...bindings.map(b => `  chat ${b.chatId} → ${b.workspaceAlias} (${b.mode ?? "direct"})`),
					].join("\n"),
				);
			}
			return true;
		}

		default:
			// A bare `@workspace` / `!workspace` (empty command — e.g. an IM
			// client that ate the rest, or a Feishu mention artifact) should
			// show usage instead of an "unknown command" error.
			if (!cmd || cmd === "") {
				await deps.sendText(
					"Workspace relay: type !workspace help for the full command list, or !hello to verify the connection.",
				);
			} else {
				await deps.sendText(`Unknown @workspace command "${cmd}". Type @workspace help for usage.`);
			}
			return true;
	}
}

/** Switch this chat to direct mode with a workspace (runtime, not persisted). */
async function switchToWorkspace(deps: WorkspaceRouterDeps, alias: string): Promise<void> {
	if (!deps.router) {
		await deps.sendText("No workspace router in this mode.");
		return;
	}
	if (alias === COORDINATOR_ALIAS) {
		await useRelay(deps);
		return;
	}
	if (!deps.router.resolveDir(alias)) {
		await deps.sendText(`Unknown workspace [${alias}]. Use @workspace list to see available workspaces.`);
		return;
	}
	const result = await deps.router.setRuntimeBinding(deps.channelId as never, deps.peer, alias);
	if (result.ok) {
		// Direct workspace mode supersedes any default-space bot session pointer.
		await deps.router.clearActiveBotSession(deps.channelId as never, deps.peer);
		await deps.sendText(
			`Direct mode: this chat now talks to [${alias}]. Send @workspace relay (or *relay) to switch back.`,
		);
	} else {
		await deps.sendText(result.error);
	}
}

/** Switch this chat back to the relay coordinator. */
async function useRelay(deps: WorkspaceRouterDeps): Promise<void> {
	if (!deps.router) return;
	await deps.router.setRuntimeBinding(deps.channelId as never, deps.peer, COORDINATOR_ALIAS);
	await deps.sendText("Relay mode: messages now go through the coordinator (main).");
}

/** One-line summary of this chat's current routing target. */
function thisChatLine(binding: string | null): string {
	return binding && binding !== COORDINATOR_ALIAS
		? `This chat → [${binding}] (direct)`
		: "This chat → relay coordinator (main)";
}

const HELP_TEXT = [
	"Zeta bot commands (English grammar; Chinese full-width punctuation is auto-normalized):",
	"",
	"System commands (no tokens):",
	"  !hello / !helo            verify this bot is connected",
	"  !help                     this reference",
	"  !status                   channel / routing / workspace / language / model overview",
	"  !lang <zh|en>             set this chat's reply language",
	"  !session list             list default-space sessions ({n} [id])",
	"  !session new <name>       create a new default-space session",
	"  !session use {n}|[id]     switch this chat to a session",
	"  !session rename {n}|[id] <name>",
	"  !session delete {n}|[id]  delete a session (relay is protected)",
	"  !model                    list available models by number ({p-m})",
	"  !model {p-m}              switch this chat's model (e.g. !model {1-1})",
	"  !workspace ...            workspace management (list/open/create/close/rename/bind/unbind)",
	"  *<alias> / *relay         shortcut to a workspace / back to relay",
	"",
	"AI commands:",
	"  !work workspace:<alias> <task>   run a task in a specific workspace",
	"  !work <task>                     run a task in the current bound workspace (or relay)",
	"  !plan <task>                     start plan mode",
	"  !draft <task>                    temporary default-space task",
	"",
	"Plain messages: bound chats go direct; unbound chats go through the relay coordinator.",
].join("\n");

/** `!status` — local state only, never reaches a model. */
async function sendStatus(deps: WorkspaceRouterDeps): Promise<void> {
	const lines: string[] = [];
	const status = deps.channelStatus?.() ?? [];
	lines.push(
		status.length === 0
			? "渠道: 未启动"
			: `渠道: ${status.map(c => `${c.id} ${c.running ? "运行中" : "未运行"}`).join(" / ")}`,
	);

	const router = deps.router;
	if (router) {
		const binding = await router.bindingFor(deps.channelId as never, deps.peer);
		if (binding && binding !== COORDINATOR_ALIAS) {
			lines.push(`当前路由: 工作区 [${binding}] (直达)`);
		} else {
			const activeId = await router.activeBotSessionIdFor(deps.channelId as never, deps.peer);
			const active = activeId ? router.botSession(activeId) : undefined;
			lines.push(active ? `当前路由: bot 会话 [${active.name}]` : "当前路由: relay 协调者 (main)");
		}
		const workspaces = router.list();
		lines.push(
			workspaces.length === 0
				? "工作区: 无"
				: `工作区: ${workspaces.map((w, i) => `{${i + 1}} [${w.alias}]`).join(", ")}`,
		);
		const lang = await router.languageFor(deps.channelId as never, deps.peer);
		lines.push(`语言: ${lang === "zh" ? "中文 (zh)" : lang === "en" ? "English (en)" : "未设置"}`);
	}

	const model = deps.getChatModel ? await deps.getChatModel() : null;
	lines.push(model ? `模型: [${model.provider}] [${model.modelId}]` : "模型: 未设置");
	await deps.sendText(lines.join("\n"));
}

/** `!session ...` — default-space session management (zero AI). */
async function runSessionCommand(body: string, deps: WorkspaceRouterDeps): Promise<void> {
	const router = deps.router;
	if (!router) {
		await deps.sendText("No workspace router in this mode.");
		return;
	}
	const parts = body.split(/\s+/);
	const cmd = parts[1]?.toLowerCase();
	switch (cmd) {
		case "list": {
			const entries = router.listBotSessions();
			const activeId = await router.activeBotSessionIdFor(deps.channelId as never, deps.peer);
			if (entries.length === 0) {
				await deps.sendText("No default-space sessions. Try !session new <name>.");
				return;
			}
			const lines = entries.map((entry, index) => {
				const mark = entry.id === activeId ? " [当前]" : "";
				const chat = entry.chatId ? ` (${entry.platform ?? "?"}:${entry.chatId})` : "";
				return `{${index + 1}} [${entry.id}] — ${entry.name} [${entry.tag}]${chat}${mark}`;
			});
			await deps.sendText(["Bot 会话:", ...lines, "回复 !session use {n} 或 [id] 切换"].join("\n"));
			return;
		}
		case "new": {
			const name = parts.slice(2).join(" ");
			if (!name) {
				await deps.sendText("Usage: !session new <name>");
				return;
			}
			const result = await router.createBotSession(name, "draft");
			if (result.ok) {
				await deps.sendText(
					`会话 [${result.entry.name}] 已创建 (id [${result.entry.id}])。回复 !session use [${result.entry.id}] 切换。`,
				);
			} else {
				await deps.sendText(result.error);
			}
			return;
		}
		case "use": {
			const selector = parts[2];
			if (!selector) {
				await deps.sendText("Usage: !session use <id|n>");
				return;
			}
			const entry = resolveBotSession(router, selector);
			if (!entry) {
				await deps.sendText(`Unknown bot session "${selector}". Type !session list to see them.`);
				return;
			}
			const result = await router.setActiveBotSession(deps.channelId as never, deps.peer, entry.id);
			if (result.ok) {
				await deps.sendText(`Now talking to session [${entry.name}] (${entry.id}).`);
			} else {
				await deps.sendText(result.error);
			}
			return;
		}
		case "rename": {
			const selector = parts[2];
			const name = parts.slice(3).join(" ");
			if (!selector || !name) {
				await deps.sendText("Usage: !session rename <id|n> <name>");
				return;
			}
			const entry = resolveBotSession(router, selector);
			if (!entry) {
				await deps.sendText(`Unknown bot session "${selector}". Type !session list to see them.`);
				return;
			}
			const result = await router.renameBotSession(entry.id, name);
			if (result.ok) {
				await deps.sendText(`Session renamed to [${result.name}].`);
			} else {
				await deps.sendText(result.error);
			}
			return;
		}
		case "delete": {
			const selector = parts[2];
			if (!selector) {
				await deps.sendText("Usage: !session delete <id|n>");
				return;
			}
			const entry = resolveBotSession(router, selector);
			if (!entry) {
				await deps.sendText(`Unknown bot session "${selector}". Type !session list to see them.`);
				return;
			}
			const result = await router.deleteBotSession(entry.id);
			if (result.ok) {
				await deps.sendText(`Session [${entry.name}] deleted.`);
			} else {
				await deps.sendText(result.error);
			}
			return;
		}
		default:
			await deps.sendText(
				"Usage: !session list | new <name> | use {n}|[id] | rename {n}|[id] <name> | delete {n}|[id]",
			);
			return;
	}
}

/** Resolve a `!session` selector: `[id]` / `{n}` / bare id / 1-based list index. */
export function resolveBotSession(
	router: SessionRouter,
	selector: string,
): { id: string; name: string; tag: string; chatId?: string; platform?: string } | undefined {
	const entries = router.listBotSessions();
	// Strip `{…}` / `[…]` wrappers so `!session use {1}` / `[relay]` work as typed.
	const clean = selector.replace(/[{}[\]]/g, "");
	const byId = entries.find(entry => entry.id === clean);
	if (byId) return byId;
	const index = Number(clean);
	if (Number.isInteger(index) && index >= 1 && index <= entries.length) {
		return entries[index - 1];
	}
	return undefined;
}

/** `!lang <zh|en>` — per-chat reply language (zero AI). */
async function runLangCommand(body: string, deps: WorkspaceRouterDeps): Promise<void> {
	const router = deps.router;
	if (!router) {
		await deps.sendText("No workspace router in this mode.");
		return;
	}
	const parts = body.split(/\s+/);
	const lang = parts[1]?.toLowerCase();
	if (lang !== "zh" && lang !== "en") {
		await deps.sendText("Usage: !lang <zh|en>");
		return;
	}
	await router.setLanguage(deps.channelId as never, deps.peer, lang);
	await deps.sendText(lang === "zh" ? "本聊天回复语言已设为中文。" : "Reply language set to English for this chat.");
}

/** `!model [<provider>-<model>]` — list / switch models by stable numbering (zero AI). */
async function runModelCommand(body: string, deps: WorkspaceRouterDeps): Promise<void> {
	const parts = body.split(/\s+/);
	const selector = parts[1];
	if (!deps.listModels) {
		await deps.sendText("Model listing is unavailable in this mode.");
		return;
	}
	const groups = await deps.listModels();
	if (groups.length === 0) {
		await deps.sendText("No available models.");
		return;
	}
	if (!selector) {
		const lines = ["可用模型:"];
		groups.forEach((group, gi) => {
			lines.push(`{${gi + 1}} [${group.provider}]`);
			group.models.forEach((model, mi) => {
				lines.push(`    {${gi + 1}-${mi + 1}} [${model}]`);
			});
		});
		lines.push("回复 !model {p}-{m} 切换（编号以最新列表为准）");
		await deps.sendText(lines.join("\n"));
		return;
	}
	const match = /^\{?(\d+)\}?-\{?(\d+)\}?$/.exec(selector.trim());
	if (!match) {
		await deps.sendText(`Invalid model selector "${selector}". Use the number from !model, e.g. !model {1-1}.`);
		return;
	}
	const group = groups[Number(match[1]) - 1];
	const model = group?.models[Number(match[2]) - 1];
	if (!group || !model) {
		await deps.sendText(`Unknown model selector "${selector}". Type !model for the current list.`);
		return;
	}
	if (!deps.setChatModel) {
		await deps.sendText("Model switching is unavailable in this mode.");
		return;
	}
	const result = await deps.setChatModel(group.provider, model);
	if (result.ok) {
		await deps.sendText(`模型已切换: [${result.provider}] [${result.modelId}]`);
	} else {
		await deps.sendText(result.error);
	}
}

/**
 * `!work ...` — explicit AI task dispatch.
 * `!work workspace:<alias> <task>` routes directly to that workspace; `!work
 * <task>` falls through to normal routing (current binding, else relay).
 */
async function runWorkCommand(body: string, deps: WorkspaceRouterDeps): Promise<boolean> {
	const router = deps.router;
	const rest = body.replace(/^!work\s+/i, "").replace(/^@work\s+/i, "");
	if (!rest || rest === "!work" || rest === "@work") {
		await deps.sendText("Usage: !work workspace:<alias> <task>, or !work <task>");
		return true;
	}
	const workspaceMatch = /^workspace:(\S+)\s+([\s\S]+)$/.exec(rest);
	if (rest.startsWith("workspace:")) {
		if (!workspaceMatch) {
			await deps.sendText("Usage: !work workspace:<alias> <task>");
			return true;
		}
		if (!router) {
			await deps.sendText("No workspace router in this mode.");
			return true;
		}
		const alias = workspaceMatch[1];
		const task = workspaceMatch[2].trim();
		const result = await router.deliverDirect(alias, deps.channelId as never, deps.peer, task);
		if (!result.ok) {
			await deps.sendText(`${result.error} Type !workspace list to see available workspaces.`);
		}
		return true;
	}
	// No workspace: prefix — route through the normal binding/relay path.
	return false;
}

/** `!draft <task>` — run a one-off task in a fresh default-space draft session. */
async function runDraftCommand(body: string, deps: WorkspaceRouterDeps): Promise<void> {
	const router = deps.router;
	if (!router) {
		await deps.sendText("No workspace router in this mode.");
		return;
	}
	const task = body.replace(/^!draft\s+/i, "").replace(/^@draft\s+/i, "");
	if (!task) {
		await deps.sendText("Usage: !draft <task>");
		return;
	}
	const title = task.slice(0, 24).trim();
	const created = await router.createBotSession(title || "Draft", "draft");
	if (!created.ok) {
		await deps.sendText(created.error);
		return;
	}
	const switched = await router.setActiveBotSession(deps.channelId as never, deps.peer, created.entry.id);
	if (!switched.ok) {
		await deps.sendText(switched.error);
		return;
	}
	await deps.sendText(`临时会话 ${created.entry.id} 已就绪，开始处理任务…`);
	await router.deliverToBotSession(created.entry.id, deps.channelId as never, deps.peer, task);
}

export { resolvePath };
