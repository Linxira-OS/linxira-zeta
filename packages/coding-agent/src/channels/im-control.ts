/**
 * im_control — natural-language control of the IM relay (workspaces, default-
 * space sessions, reply language, model).
 *
 * The coordinator (and every bot session) calls this through the `im_control`
 * tool when the user asks — in any language — to manage workspaces / sessions /
 * language / model. Every operation maps onto the existing `SessionRouter` /
 * `WebConfig` methods; there are zero model calls inside (all local state), so
 * the tool is fast by construction and its text result is relayed verbatim as
 * the final answer.
 */

import type { ChannelId } from "./channel";
import { COORDINATOR_ALIAS, type SessionRouter } from "./session-router";
import { resolveBotSession } from "./workspace-router";

export type ImControlOperation =
	| "list_workspaces"
	| "list_sessions"
	| "use_session"
	| "new_session"
	| "rename_session"
	| "delete_session"
	| "set_language"
	| "list_models"
	| "set_model"
	| "status";

export interface ImControlParams {
	operation: ImControlOperation;
	/** Session selector for use/rename/delete_session: bare id, `{n}` index, or `[id]`. */
	session?: string;
	/** Display name for new_session / rename_session. */
	name?: string;
	/** Reply language for set_language. */
	language?: "zh" | "en";
	/** Provider id from list_models, for set_model. */
	provider?: string;
	/** Model id from list_models, for set_model. */
	model?: string;
}

export interface ImControlResult {
	text: string;
	isError?: boolean;
}

/** Runtime sinks the controller needs (wired by zeta-server; shares `!model`). */
export interface ImControlDeps {
	listModels(): Promise<{ provider: string; models: string[] }[]>;
	setChatModel(
		channelId: ChannelId,
		peer: string,
		provider: string,
		modelId: string,
	): Promise<{ ok: true; provider: string; modelId: string } | { ok: false; error: string }>;
	getChatModel(channelId: ChannelId, peer: string): Promise<{ provider: string; modelId: string } | null>;
	getChannelStatus(): { id: string; running: boolean }[];
}

/** The chat that invoked the tool via a sessionKey bound at hook time. */
function resolveChat(router: SessionRouter, sessionKey: string): { channelId: ChannelId; peer: string } | null {
	return router.resolveImControlChat(sessionKey);
}

/**
 * Execute one IM control intent. `sessionKey` identifies the calling session
 * ("coordinator" or a bot-session id) so chat-scoped operations resolve the
 * right channel without guessing.
 */
export async function runImControl(
	router: SessionRouter | null,
	sessionKey: string,
	params: ImControlParams,
	deps: ImControlDeps,
): Promise<ImControlResult> {
	if (!router) {
		return { text: "IM relay is not available in this mode (CLI).", isError: true };
	}
	const chat = resolveChat(router, sessionKey);
	if (!chat) {
		return { text: "No chat context for this session.", isError: true };
	}
	const { channelId, peer } = chat;

	switch (params.operation) {
		case "list_workspaces": {
			const entries = router.list();
			if (entries.length === 0) return { text: "工作区: 无" };
			const binding = await router.bindingFor(channelId, peer);
			const lines = ["工作区:"];
			for (const [index, entry] of entries.entries()) {
				lines.push(`{${index + 1}} [${entry.alias}] → ${entry.path}`);
				const sessions = await router.listWorkspaceSessions(entry.alias);
				sessions.forEach((session, sessionIndex) => {
					lines.push(`    {${index + 1}-${sessionIndex + 1}} [${session.title}]`);
				});
			}
			lines.push(
				binding && binding !== COORDINATOR_ALIAS
					? `This chat → [${binding}] (direct)`
					: "This chat → relay coordinator (main)",
			);
			return { text: lines.join("\n") };
		}
		case "list_sessions": {
			const entries = router.listBotSessions();
			const activeId = await router.activeBotSessionIdFor(channelId, peer);
			if (entries.length === 0) return { text: "没有默认空间会话。可以用 new_session 创建。" };
			const lines = entries.map((entry, index) => {
				const mark = entry.id === activeId ? " [当前]" : "";
				const chatLabel = entry.chatId ? ` (${entry.platform ?? "?"}:${entry.chatId})` : "";
				return `{${index + 1}} [${entry.id}] — ${entry.name} [${entry.tag}]${chatLabel}${mark}`;
			});
			return { text: ["Bot 会话:", ...lines, "回复 use_session {n} 或 [id] 切换"].join("\n") };
		}
		case "use_session": {
			if (!params.session) {
				return runImControl(router, sessionKey, { operation: "list_sessions" }, deps);
			}
			const entry = resolveBotSession(router, params.session);
			if (!entry) {
				return { text: `Unknown bot session "${params.session}". Type list_sessions to see them.`, isError: true };
			}
			const result = await router.setActiveBotSession(channelId, peer, entry.id);
			if (!result.ok) return { text: result.error, isError: true };
			return { text: `Now talking to session [${entry.name}] (${entry.id}).` };
		}
		case "new_session": {
			const name = params.name?.trim();
			if (!name) return { text: "需要提供会话名称（name），例如 new_session name=test。", isError: true };
			const result = await router.createBotSession(name, "draft");
			if (!result.ok) return { text: result.error, isError: true };
			return {
				text: `会话 [${result.entry.name}] 已创建 (id [${result.entry.id}])。回复 use_session [${result.entry.id}] 切换。`,
			};
		}
		case "rename_session": {
			const name = params.name?.trim();
			if (!params.session || !name) return { text: "需要 session 选择器与新的 name。", isError: true };
			const entry = resolveBotSession(router, params.session);
			if (!entry) return { text: `Unknown bot session "${params.session}".`, isError: true };
			const result = await router.renameBotSession(entry.id, name);
			if (!result.ok) return { text: result.error, isError: true };
			return { text: `Session renamed to [${result.name}].` };
		}
		case "delete_session": {
			if (!params.session) return { text: "需要 session 选择器。", isError: true };
			const entry = resolveBotSession(router, params.session);
			if (!entry) return { text: `Unknown bot session "${params.session}".`, isError: true };
			const result = await router.deleteBotSession(entry.id);
			if (!result.ok) return { text: result.error, isError: true };
			return { text: `Session [${entry.name}] deleted.` };
		}
		case "set_language": {
			const lang = params.language;
			if (lang !== "zh" && lang !== "en") return { text: 'Language must be "zh" or "en".', isError: true };
			await router.setLanguage(channelId, peer, lang);
			return { text: lang === "zh" ? "本聊天回复语言已设为中文。" : "Reply language set to English for this chat." };
		}
		case "list_models": {
			const groups = await deps.listModels();
			if (groups.length === 0) return { text: "No available models." };
			const lines = ["可用模型:"];
			groups.forEach((group, gi) => {
				lines.push(`{${gi + 1}} [${group.provider}]`);
				group.models.forEach((model, mi) => {
					lines.push(`    {${gi + 1}-${mi + 1}} [${model}]`);
				});
			});
			return { text: lines.join("\n") };
		}
		case "set_model": {
			if (!params.provider || !params.model) {
				return runImControl(router, sessionKey, { operation: "list_models" }, deps);
			}
			const result = await deps.setChatModel(channelId, peer, params.provider, params.model);
			if (!result.ok) return { text: result.error, isError: true };
			return { text: `模型已切换: [${result.provider}] [${result.modelId}]` };
		}
		case "status": {
			const lines: string[] = [];
			const status = deps.getChannelStatus();
			lines.push(
				status.length === 0
					? "渠道: 未启动"
					: `渠道: ${status.map(c => `${c.id} ${c.running ? "运行中" : "未运行"}`).join(" / ")}`,
			);
			const binding = await router.bindingFor(channelId, peer);
			if (binding && binding !== COORDINATOR_ALIAS) {
				lines.push(`当前路由: 工作区 [${binding}] (直达)`);
			} else {
				const activeId = await router.activeBotSessionIdFor(channelId, peer);
				const active = activeId ? router.botSession(activeId) : undefined;
				lines.push(active ? `当前路由: bot 会话 [${active.name}]` : "当前路由: relay 协调者 (main)");
			}
			const workspaces = router.list();
			lines.push(
				workspaces.length === 0
					? "工作区: 无"
					: `工作区: ${workspaces.map((w, i) => `{${i + 1}} [${w.alias}]`).join(", ")}`,
			);
			const lang = await router.languageFor(channelId, peer);
			lines.push(`语言: ${lang === "zh" ? "中文 (zh)" : lang === "en" ? "English (en)" : "未设置"}`);
			const model = await deps.getChatModel(channelId, peer);
			lines.push(model ? `模型: [${model.provider}] [${model.modelId}]` : "模型: 未设置");
			return { text: lines.join("\n") };
		}
	}
}
