import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getProjectTrackingDir } from "@linxiraos/pi-utils";
import type { Settings } from "../config/settings";
import { cfgLanguage } from "../zeta-settings";
import { cfgSessionTimeInjectEvery, cfgTrackingEnabled } from "../tools/settings";
import { currentLanguage, LANGUAGE_TAGS, M, setLanguage, type ZetaLanguage } from "../i18n";
import indexTemplate from "../prompts/tracking/index-template.md" with { type: "text" };
import { TRACKING_TOGGLE_NOTICE_TYPE } from "../session/todo-tracker";
import { readTrackingActionRows } from "../tools/tracking-actions-log";
import type { TrackingStatus } from "../tools/tracking";
import {
	activeModeId,
	buildDynamicToolNotice,
	buildTimeStatusLine,
	DYNAMIC_TOOL_NOTICE_TYPE,
	formatMessage,
	isDynamicToolEnabled,
	toggleDynamicTool,
} from "../tools/dynamic-tools";
import { commandConsumed, usage } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandSpec } from "./types";

/**
 * Zeta-originated slash commands.
 *
 * Kept separate from the upstream builtin-*.ts files so upstream merges
 * cannot silently drop them: this module is re-exported from
 * `builtin-registry.ts` alongside the upstream command groups.
 */

export const BUILTIN_ZETA_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "language",
		description: () => M.cmdLanguage,
		icon: "globe",
		acpDescription: M.cmdSetTheCLIDisplayLanguage,
		acpInputHint: "[en|zh]",
		subcommands: [
			{ name: "en", description: () => M.cmdEnglish },
			{ name: "zh", description: () => M.languageZhLabel },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg) {
				const rows = [
					M.languageCurrentFmt.replace("%s", currentLanguage()),
					...LANGUAGE_TAGS.map(tag =>
						M.languageListRowFmt
							.replace("%s", tag)
							.replace("%s", tag === "en" ? M.languageEnLabel : M.languageZhLabel),
					),
				].join("\n");
				await runtime.output(rows);
				return commandConsumed();
			}
			if (!(LANGUAGE_TAGS as readonly string[]).includes(arg)) {
				return usage(M.languageUnknownFmt.replace("%s", arg), runtime);
			}
			const tag = arg as ZetaLanguage;
			runtime.settings.writeValue(cfgLanguage, tag, "global");
			setLanguage(tag);
			// Re-advertise the command list so clients that cache descriptions
			// (ACP's available_commands_update, RPC) pick up the new locale —
			// the same contract /mcp reload and /reload-plugins honour.
			await runtime.refreshCommands?.();
			await runtime.output(M.languageChangedFmt.replace("%s", tag));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const arg = command.args.trim().toLowerCase();
			if (!arg) {
				const rows = [
					M.languageCurrentFmt.replace("%s", currentLanguage()),
					...LANGUAGE_TAGS.map(tag =>
						M.languageListRowFmt
							.replace("%s", tag)
							.replace("%s", tag === "en" ? M.languageEnLabel : M.languageZhLabel),
					),
				].join("\n");
				runtime.ctx.showStatus(rows);
				runtime.ctx.editor.setText("");
				return;
			}
			if (!(LANGUAGE_TAGS as readonly string[]).includes(arg)) {
				runtime.ctx.showStatus(M.languageUnknownFmt.replace("%s", arg));
				runtime.ctx.editor.setText("");
				return;
			}
			const tag = arg as ZetaLanguage;
			runtime.ctx.settings.writeValue(cfgLanguage, tag, "global");
			setLanguage(tag);
			// Descriptions/snapshots for builtins re-resolve on the next
			// autocomplete rebuild; refresh immediately so the open editor
			// reflects the new locale without a restart.
			void runtime.ctx.refreshSlashCommandState();
			runtime.ctx.showStatus(M.languageChangedFmt.replace("%s", tag));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tracking",
		description: () => M.cmdTracking,
		icon: "eye",
		acpDescription: M.cmdTrackingAcp,
		acpInputHint: "<status|plan|log|index|start|on|off>",
		subcommands: [
			{ name: "status", description: () => M.cmdTrackingStatus },
			{ name: "on", description: () => M.cmdTrackingOn },
			{ name: "off", description: () => M.cmdTrackingOff },
			{ name: "plan", description: () => M.cmdTrackingPlan },
			{ name: "log", description: () => M.cmdTrackingLog },
			{ name: "index", description: () => M.cmdTrackingIndex },
			{ name: "start", description: () => M.cmdTrackingStart },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const { text, notice } = await resolveTrackingCommand(runtime.settings, command, runtime.cwd);
			if (notice) {
				await runtime.session.sendCustomMessage(
					{ customType: TRACKING_TOGGLE_NOTICE_TYPE, content: notice, display: false },
					{ deliverAs: "nextTurn" },
				);
			}
			await runtime.output(text);
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			const { text, notice } = await resolveTrackingCommand(
				runtime.ctx.settings,
				command,
				runtime.ctx.sessionManager.getCwd(),
			);
			if (notice) {
				await runtime.ctx.session.sendCustomMessage(
					{ customType: TRACKING_TOGGLE_NOTICE_TYPE, content: notice, display: false },
					{ deliverAs: "nextTurn" },
				);
			}
			runtime.ctx.showStatus(text);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tool",
		description: () => M.cmdTool,
		acpDescription: "Toggle a dynamic tool on or off",
		acpInputHint: "<name> on|off",
		inlineHint: "<name> on|off",
		allowArgs: true,
		handle: async (command, runtime) => {
			const result = toggleDynamicTool(runtime.settings, command.args);
			if ("error" in result) return usage(result.error, runtime);
			// The settings write re-gates the session's built-ins (cfgSessionToolGates
			// reconcile); the notice teaches the model what just appeared or vanished.
			if (result.changed) {
				await runtime.session.sendCustomMessage(
					{
						customType: DYNAMIC_TOOL_NOTICE_TYPE,
						content: buildDynamicToolNotice(result.name, result.enabled, activeModeId(runtime.session)),
						display: false,
					},
					{ deliverAs: "nextTurn" },
				);
			}
			await runtime.output(`${result.name}: ${result.enabled ? "on" : "off"}`);
			return commandConsumed();
		},
	},
	{
		name: "time",
		description: () => M.cmdTime,
		acpDescription: "Show or toggle the time injection feature",
		acpInputHint: "[status|on|off|interval <n>]",
		inlineHint: "[status|on|off|interval <n>]",
		subcommands: [
			{ name: "status", description: () => M.cmdTimeStatus },
			{ name: "on", description: () => M.cmdTimeOn },
			{ name: "off", description: () => M.cmdTimeOff },
			{ name: "interval", description: () => M.cmdTimeInterval },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const result = applyTimeCommand(runtime.settings, command.args);
			if ("error" in result) return usage(result.error, runtime);
			// on/off reuses the /tool toggle path: the same settings write and the
			// same model-visible notice, gated on an actual state change.
			if (result.changed) {
				await runtime.session.sendCustomMessage(
					{
						customType: DYNAMIC_TOOL_NOTICE_TYPE,
						content: buildDynamicToolNotice("time", result.enabled, activeModeId(runtime.session)),
						display: false,
					},
					{ deliverAs: "nextTurn" },
				);
			}
			await runtime.output(result.status);
			return commandConsumed();
		},
	},
];

/** Operator text plus the optional model notice for one `/tracking` invocation. */
interface TrackingCommandOutcome {
	/** Text either surface renders (status line, report, or disabled hint). */
	text: string;
	/** Model-visible notice; present only when `tracking.enabled` actually flipped. */
	notice?: string;
}

/**
 * Resolve `/tracking <args>` into the text both surfaces render plus, on a real
 * flip of `tracking.enabled`, the model-visible notice to deliver. `on`/`off`
 * are handled before the enabled gate; all command logic lives here so the
 * text-mode and TUI handlers cannot drift.
 */
async function resolveTrackingCommand(
	settings: Settings,
	command: ParsedSlashCommand,
	cwd: string,
): Promise<TrackingCommandOutcome> {
	const arg = command.args.trim().toLowerCase();
	if (arg === "on" || arg === "off") {
		const enabled = arg === "on";
		if (cfgTrackingEnabled.get(settings) === enabled) {
			return { text: M.cmdTrackingUnchanged };
		}
		settings.writeValue(cfgTrackingEnabled, enabled, "global");
		const dir = getProjectTrackingDir(cwd);
		return enabled
			? { text: M.cmdTrackingEnabledFmt.replace("%s", dir), notice: M.cmdTrackingNoticeOn }
			: { text: M.cmdTrackingDisabledFmt.replace("%s", dir), notice: M.cmdTrackingNoticeOff };
	}
	if (!cfgTrackingEnabled.get(settings)) {
		return { text: M.cmdTrackingDisabledHint };
	}
	return { text: await buildTrackingReport(command, cwd) };
}

type TimeCommandResult = { error: string } | { status: string; enabled: boolean; changed: boolean };

/**
 * Apply `/time [status|on|off|interval <n>]` to `settings`. Toggling delegates
 * to `toggleDynamicTool` so `/time on|off` and `/tool time on|off` share one
 * implementation; the caller owns the model notice, which needs the session's
 * active mode.
 */
function applyTimeCommand(settings: Settings, args: string): TimeCommandResult {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const verb = (tokens[0] ?? "status").toLowerCase();
	const rest = tokens.slice(1);
	if (verb === "status" && rest.length === 0) {
		return { status: buildTimeStatusLine(settings), enabled: isDynamicToolEnabled(settings, "time"), changed: false };
	}
	if ((verb === "on" || verb === "off") && rest.length === 0) {
		const toggled = toggleDynamicTool(settings, `time ${verb}`);
		if ("error" in toggled) return { error: toggled.error };
		return { status: buildTimeStatusLine(settings), enabled: toggled.enabled, changed: toggled.changed };
	}
	if (verb === "interval" && rest.length === 1) {
		const raw = rest[0] as string;
		const value = Number(raw);
		if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1) {
			return { error: formatMessage(M.timeIntervalInvalidFmt, raw) };
		}
		settings.writeValue(cfgSessionTimeInjectEvery, value, "global");
		return { status: buildTimeStatusLine(settings), enabled: isDynamicToolEnabled(settings, "time"), changed: false };
	}
	return { error: M.timeUsage };
}

/**
 * Read the project tracking documents (<project>/.zeta/tracking) and render a
 * human-readable report. `start` prints the guidance that prompts the agent to
 * begin maintaining the tracking documents via the `tracking_update` tool.
 */
async function buildTrackingReport(command: ParsedSlashCommand, cwd: string): Promise<string> {
	const arg = command.args.trim().toLowerCase();
	const dir = getProjectTrackingDir(cwd);
	const statusPath = path.join(dir, "status.json");
	const indexPath = path.join(dir, "INDEX.md");
	const sessionsDir = path.join(dir, "sessions");

	const emptyHint = `（无追踪数据。用 /tracking start 开始维护项目追踪文档。）`;

	switch (arg) {
		case "start": {
			let seededNote: string;
			try {
				await fs.access(indexPath);
				seededNote = `索引已存在: ${indexPath}`;
			} catch {
				await Bun.write(indexPath, `${indexTemplate.replace("{{PROJECT}}", "Project Tracking")}\n`);
				seededNote = `已按三读者模板生成索引: ${indexPath}（人 / agent / 协作者）`;
			}
			return (
				"开始维护项目追踪文档：我会在里程碑、重要决策、阶段完成与阻塞解除后调用 tracking_update 工具，\n" +
				`把状态（status.json）、索引（INDEX.md）、操作日志（actions.<日期>.jsonl.log，5 MB × 3 份轮转）、阶段（sync_todo）与计划（sessions/）写入 ${dir}。\n` +
				"追踪文档独立于记忆机制，跨会话保留，可在 Web UI 追踪面板查看。三读者定位：人 / agent / 协作者。\n" +
				"追踪只记过程状态（阶段 / 阻塞 / 计划镜像），绝不存学到的知识事实——事实请用记忆工具；动态状态先写入追踪文档，再由读者读取文档。\n" +
				seededNote
			);
		}
		case "status": {
			try {
				const parsed = JSON.parse(await Bun.file(statusPath).text()) as TrackingStatus;
				return [
					`阶段: ${parsed.phase || "（未设置）"}`,
					`进度: ${parsed.progress || "（未设置）"}`,
					`阻塞: ${parsed.blockers?.length ? parsed.blockers.join("；") : "无"}`,
					`决策: ${parsed.decisions?.length ? parsed.decisions.join("；") : "无"}`,
					`更新: ${parsed.lastUpdated || "—"}`,
				].join("\n");
			} catch {
				return `状态文件不存在: ${statusPath}\n${emptyHint}`;
			}
		}
		case "index": {
			try {
				return await Bun.file(indexPath).text();
			} catch {
				return `索引文件不存在: ${indexPath}\n${emptyHint}`;
			}
		}
		case "log": {
			const lines = await readTrackingActionRows(dir);
			if (lines.length === 0) return `操作日志为空: ${dir}\n${emptyHint}`;
			const rows = lines.slice(-10).map(line => {
				try {
					const entry = JSON.parse(line) as { timestamp?: string; action?: string; detail?: string };
					return `${entry.timestamp ?? "—"}  ${entry.action ?? ""}${entry.detail ? `（${entry.detail}）` : ""}`;
				} catch {
					return line;
				}
			});
			return `最近 ${rows.length} 条操作（共 ${lines.length} 条）:\n${rows.join("\n")}`;
		}
		case "plan": {
			try {
				const entries = await fs.readdir(sessionsDir).catch(() => [] as string[]);
				const plans = entries.filter((name: string) => name.endsWith(".md"));
				if (plans.length === 0) return `暂无追踪计划（${sessionsDir}）`;
				return `追踪计划（${plans.length}）:\n${plans.map((name: string) => `  - ${name}`).join("\n")}`;
			} catch {
				return `计划目录不存在: ${sessionsDir}\n${emptyHint}`;
			}
		}
		default:
			return `用法: /tracking <status|plan|log|index|start>`;
	}
}
