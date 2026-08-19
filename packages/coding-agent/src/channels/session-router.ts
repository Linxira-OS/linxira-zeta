/**
 * SessionRouter — multi-workspace session registry for the coordinator agent.
 *
 * The coordinator session (default workspace, created by `zeta serve`) receives
 * every inbound channel message. When it calls `workspace_run`, the router
 * delivers a subtask to the target workspace's session via `deliverIrcMessage`
 * and waits for that session's final `turn_end` reply. Target sessions never
 * message the user directly — only the coordinator pushes via `channel_send`,
 * so a delegated task produces exactly one reply path back to the user.
 *
 * Only used in web/desktop mode. CLI sessions have no router and `workspace_run`
 * stays unavailable (isToolAllowed rejects it).
 */

import * as path from "node:path";
import { logger, Snowflake } from "@linxiraos/pi-utils";
import type { WebConfig } from "../config/web-config";
import type { IrcMessage } from "../irc/bus";
import { createAgentSession } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session-events";
import type { ChannelId } from "./channel";

/** Upper bound for a delegated `workspace_run` turn (no reply → timeout error). */
const RUN_TIMEOUT_MS = 10 * 60_000;

interface ActiveRun {
	resolve: (text: string) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface SessionHandle {
	session: AgentSession;
	unsubscribe: () => void;
}

export class SessionRouter {
	readonly #coordinator: AgentSession;
	readonly #webConfig: WebConfig;
	readonly #getLastInbound: () => { channelId: ChannelId; peer: string } | null;
	readonly #sendText: (channelId: ChannelId, to: string, text: string) => Promise<void>;

	/** Keyed by absolute directory. */
	readonly #sessions = new Map<string, SessionHandle>();
	/** Workspace name (basename) → absolute directory. */
	readonly #names = new Map<string, string>();
	#activeRun: ActiveRun | null = null;
	#stopping = false;

	constructor(options: {
		coordinator: AgentSession;
		webConfig: WebConfig;
		getLastInbound: () => { channelId: ChannelId; peer: string } | null;
		sendText: (channelId: ChannelId, to: string, text: string) => Promise<void>;
	}) {
		this.#coordinator = options.coordinator;
		this.#webConfig = options.webConfig;
		this.#getLastInbound = options.getLastInbound;
		this.#sendText = options.sendText;
	}

	/** Registered workspace names. */
	list(): string[] {
		return [...this.#names.keys()];
	}

	/** Open (or re-open) a directory as a workspace session; persists the path in web.yml. */
	async open(dir: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
		const existing = this.#sessions.get(dir);
		if (existing) return { ok: true, name: path.basename(dir) };
		try {
			const { session } = await createAgentSession({
				cwd: dir,
				disableExtensionDiscovery: true,
			});
			const unsubscribe = session.subscribe(event => this.#onTargetEvent(dir, event));
			this.#sessions.set(dir, { session, unsubscribe });
			this.#names.set(path.basename(dir), dir);
			const workspaces = this.#webConfig.getData().remote.workspaces ?? [];
			if (!workspaces.includes(dir)) {
				await this.#webConfig.setWorkspaces([...workspaces, dir]);
			}
			logger.info("Workspace session opened", { dir });
			return { ok: true, name: path.basename(dir) };
		} catch (error) {
			logger.error("Failed to open workspace session", {
				dir,
				error: error instanceof Error ? error.message : String(error),
			});
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Stop and remove a workspace session by name. */
	async close(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const dir = this.#names.get(name);
		if (!dir) return { ok: false, error: `Unknown workspace "${name}"` };
		const handle = this.#sessions.get(dir);
		if (!handle) return { ok: false, error: `Workspace "${name}" has no session` };
		handle.unsubscribe();
		this.#sessions.delete(dir);
		this.#names.delete(name);
		try {
			await handle.session.dispose();
		} catch (error) {
			logger.warn("Workspace session dispose failed", {
				dir,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		const workspaces = (this.#webConfig.getData().remote.workspaces ?? []).filter(w => w !== dir);
		await this.#webConfig.setWorkspaces(workspaces);
		logger.info("Workspace session closed", { dir });
		return { ok: true };
	}

	/**
	 * Deliver a subtask to a workspace session and wait for its final reply.
	 * `workspace` is an absolute path or a registered name.
	 */
	async run(workspace: string, task: string): Promise<{ reply: string }> {
		const dir = this.#resolveDir(workspace);
		const handle = dir ? this.#sessions.get(dir) : undefined;
		if (!handle || !dir) {
			return { reply: `workspace_run: unknown workspace "${workspace}"` };
		}
		const agentId = handle.session.getAgentId();
		const coordinatorId = this.#coordinator.getAgentId() ?? "coordinator";
		if (!agentId) {
			return { reply: `workspace_run: target session "${workspace}" has no agent id` };
		}
		if (this.#activeRun) {
			return { reply: "workspace_run: another delegation is already in flight; wait for it to finish" };
		}

		const msg: IrcMessage = {
			id: Snowflake.next(),
			from: coordinatorId,
			to: agentId,
			body: task,
			ts: Date.now(),
		};

		const { promise, resolve } = Promise.withResolvers<string>();
		const timer = setTimeout(() => {
			if (this.#activeRun?.resolve === resolve) {
				this.#activeRun = null;
				resolve(`[${path.basename(dir)}] (no reply within ${RUN_TIMEOUT_MS / 60_000} minutes)`);
			}
		}, RUN_TIMEOUT_MS);
		this.#activeRun = { resolve, timer };

		try {
			await handle.session.deliverIrcMessage(msg, { expectsReply: true });
		} catch (error) {
			clearTimeout(timer);
			this.#activeRun = null;
			const detail = error instanceof Error ? error.message : String(error);
			return { reply: `workspace_run: delegation to "${workspace}" failed: ${detail}` };
		}

		const text = await promise;
		return { reply: `[${path.basename(dir)}] ${text}` };
	}

	/** Resolve `channel_send` opts to a concrete channel + peer; null when unavailable. */
	resolvePush(opts: { to?: string; channel?: string }): { channelId: ChannelId; to: string } | null {
		const inbound = this.#getLastInbound();
		const channelId = (opts.channel as ChannelId | undefined) ?? inbound?.channelId ?? null;
		const to = opts.to ?? inbound?.peer ?? null;
		if (!channelId || !to) return null;
		return { channelId, to };
	}

	/** Push text through the channel runtime (channel_send tool sink). */
	async push(opts: { text: string; to?: string; channel?: string }): Promise<void> {
		const target = this.resolvePush(opts);
		if (!target) throw new Error("No channel or peer bound to this session");
		await this.#sendText(target.channelId, target.to, opts.text);
	}

	/** Dispose every target session and drop listeners. */
	async stopAll(): Promise<void> {
		if (this.#stopping) return;
		this.#stopping = true;
		if (this.#activeRun) {
			clearTimeout(this.#activeRun.timer);
			this.#activeRun = null;
		}
		for (const handle of this.#sessions.values()) {
			handle.unsubscribe();
		}
		this.#sessions.clear();
		this.#names.clear();
	}

	#resolveDir(workspace: string): string | undefined {
		if (path.isAbsolute(workspace)) return workspace;
		return this.#names.get(workspace);
	}

	#onTargetEvent(dir: string, event: AgentSessionEvent): void {
		if (event.type !== "turn_end" || !this.#activeRun) return;
		if (!this.#sessions.has(dir)) return;
		const run = this.#activeRun;
		this.#activeRun = null;
		clearTimeout(run.timer);
		const message = event.message;
		const text =
			message && message.role === "assistant" && Array.isArray(message.content)
				? message.content
						.filter((content): content is { type: "text"; text: string } => content.type === "text")
						.map(content => content.text)
						.join("")
						.trim()
				: "";
		run.resolve(text || "(no text reply)");
	}
}
