import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getProjectTrackingDir } from "@linxiraos/pi-utils";
import type { SettingPath, SettingValue } from "../config/settings";
import { currentLanguage, LANGUAGE_TAGS, M, setLanguage, type ZetaLanguage } from "../i18n";
import type { TrackingStatus } from "../tools/tracking";
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
		description: M.cmdLanguage,
		icon: "globe",
		acpDescription: M.cmdSetTheCLIDisplayLanguage,
		acpInputHint: "[en|zh]",
		subcommands: [
			{ name: "en", description: M.cmdEnglish },
			{ name: "zh", description: M.languageZhLabel },
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
			runtime.settings.set("language" as SettingPath, tag as SettingValue<SettingPath>);
			setLanguage(tag);
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
			runtime.ctx.settings.set("language" as SettingPath, tag as SettingValue<SettingPath>);
			setLanguage(tag);
			runtime.ctx.showStatus(M.languageChangedFmt.replace("%s", tag));
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "tracking",
		description: M.cmdTracking,
		icon: "eye",
		acpDescription: M.cmdTrackingAcp,
		acpInputHint: "<status|plan|log|index|start>",
		subcommands: [
			{ name: "status", description: M.cmdTrackingStatus },
			{ name: "plan", description: M.cmdTrackingPlan },
			{ name: "log", description: M.cmdTrackingLog },
			{ name: "index", description: M.cmdTrackingIndex },
			{ name: "start", description: M.cmdTrackingStart },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			if (!runtime.settings.get("tracking.enabled")) {
				await runtime.output(
					"项目追踪默认关闭。用 /settings 打开 tools → Project Tracking（tracking.enabled）后，再用 /tracking 维护项目追踪文档。",
				);
				return commandConsumed();
			}
			await runtime.output(await buildTrackingReport(command, runtime.cwd));
			return commandConsumed();
		},
		handleTui: async (command, runtime) => {
			if (!runtime.ctx.settings.get("tracking.enabled")) {
				runtime.ctx.showStatus("项目追踪默认关闭。请先开启 tracking.enabled（/settings → tools）。");
				runtime.ctx.editor.setText("");
				return;
			}
			const cwd = runtime.ctx.sessionManager.getCwd();
			runtime.ctx.showStatus(await buildTrackingReport(command, cwd));
			runtime.ctx.editor.setText("");
		},
	},
];

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
	const actionsPath = path.join(dir, "actions.jsonl");
	const sessionsDir = path.join(dir, "sessions");
	const emptyHint = `（无追踪数据。用 /tracking start 开始维护项目追踪文档。）`;

	switch (arg) {
		case "start":
			return (
				"开始维护项目追踪文档：我会在里程碑、重要决策与阻塞解除后调用 tracking_update 工具，\n" +
				`把状态（status.json）、索引（INDEX.md）、操作日志（actions.jsonl）与计划（sessions/）写入 ${dir}。\n` +
				"追踪文档独立于记忆机制，跨会话保留，可在 Web UI 追踪面板查看。"
			);
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
			try {
				const lines = (await Bun.file(actionsPath).text()).trim().split("\n").filter(Boolean);
				if (lines.length === 0) return `操作日志为空: ${actionsPath}`;
				const rows = lines.slice(-10).map(line => {
					try {
						const entry = JSON.parse(line) as { timestamp?: string; action?: string; detail?: string };
						return `${entry.timestamp ?? "—"}  ${entry.action ?? ""}${entry.detail ? `（${entry.detail}）` : ""}`;
					} catch {
						return line;
					}
				});
				return `最近 ${rows.length} 条操作（共 ${lines.length} 条）:\n${rows.join("\n")}`;
			} catch {
				return `操作日志不存在: ${actionsPath}\n${emptyHint}`;
			}
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
