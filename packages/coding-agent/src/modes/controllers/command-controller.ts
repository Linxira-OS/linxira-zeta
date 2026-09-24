import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CompactionCancelledError, type CompactionOutcome } from "@linxiraos/pi-agent-core/compaction";
import {
	getEnvApiKey,
	getProviderDetails,
	type ProviderDetails,
	resolveUsedFraction,
	type UsageLimit,
	type UsageReport,
} from "@linxiraos/pi-ai";
import { Loader, Markdown, padding, Spacer, Text, visibleWidth } from "@linxiraos/pi-tui";
import { formatDuration, logger, Snowflake, sanitizeText } from "@linxiraos/pi-utils";
import { M } from "../../i18n";
import { shouldEnableAppendOnlyContext } from "../../config/append-only-context-mode";
import { type BashResult, isPersistentShellCdCommand } from "../../exec/bash-executor";
import { type LoadedCustomShare, loadCustomShare } from "../../export/custom-share";
import { parseExportArgs } from "../../export/html/args";
import { shareSession } from "../../export/share";
import type { CompactOptions } from "../../extensibility/extensions/types";
import {
	diffMentalModelContent,
	type HindsightApi,
	type HindsightSessionState,
	loadHindsightConfig,
	reloadMentalModelsForSession,
	resolveSeedsForScope,
	seedAlreadyExists,
	summarizeMentalModel,
} from "../../hindsight";
import { memoryStatsUnavailableMessage, resolveMemoryBackend } from "../../memory-backend";
import { BashExecutionComponent, bashPtyViewport } from "@linxiraos/pi-tui/chat/bash-execution";
import { BorderedLoader } from "@linxiraos/pi-tui/overlays/bordered-loader";
import { DynamicBorder } from "@linxiraos/pi-tui/chrome/dynamic-border";
import { EvalExecutionComponent } from "@linxiraos/pi-tui/chat/eval-execution";
import { MoveOverlay, type MoveOverlayResult } from "@linxiraos/pi-tui/overlays/move-overlay";
import { moveDirectorySource } from "../move-directory-source";
import { TranscriptBlock } from "@linxiraos/pi-tui/chrome/transcript-container";
import { getMarkdownTheme, getSymbolTheme, theme, type Theme } from "@linxiraos/pi-tui/theme";

import type { InteractiveModeContext } from "../../modes/types";
import { renderContextUsage } from "@linxiraos/pi-tui/status-line/context-usage";
import { computeSessionContextBreakdown } from "../../session/context-usage-runtime";
import { buildHotkeysMarkdown } from "@linxiraos/pi-tui/hotkeys-markdown";
import { buildToolsMarkdown } from "@linxiraos/pi-tui/prompt/tools-markdown";
import type { AsyncJobSnapshotItem } from "../../session/agent-session";
import type { AuthStorage, OAuthAccountIdentity } from "../../session/auth-storage";
import type { CompactMode } from "../../session/compact-modes";
import type { NewSessionOptions } from "../../session/session-entries";
import {
	cleanSourceCheckoutIfConfigured,
	createSessionWorktree,
	defaultSessionWorktreeBranch,
	formatSessionWorktreeSummary,
	type SessionWorktree,
} from "../../session/session-worktree";
import { formatShakeSummary, type ShakeMode, type ShakeResult } from "../../session/shake-types";
import { formatActiveAccountLabel, limitMatchesActiveAccount } from "../../slash-commands/helpers/active-oauth-account";
import { formatProviderName } from "@linxiraos/pi-tui/chrome/format";
import { formatCompactQuota } from "@linxiraos/pi-tui/overlays/advisor-config";
import { outputMeta } from "../../tools/output-meta";
import { resolveToCwd, stripOuterDoubleQuotes } from "../../tools/path-utils";
import { replaceTabs, truncateToWidth } from "@linxiraos/pi-tui/render/render-utils";
import {
	getChangelogPath,
	parseChangelog,
	RECENT_CHANGELOG_ENTRY_LIMIT,
	renderChangelogEntries,
} from "../../utils/changelog";
import { copyToClipboard } from "../../utils/clipboard";
import { openPath } from "../../utils/open";
import { setSessionTerminalTitle } from "../../utils/title-generator";
import {
	collapseSharedUsageReports,
	formatLimitTitle,
	summarizeUsageResetCredits,
} from "@linxiraos/pi-tui/overlays/usage-display";
import { formatRemainingOnlyTotal, isUsedOnlyAbsoluteAmount } from "@linxiraos/pi-tui/prompt/usage-amounts";

function formatCreditValue(value: number): string {
	return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function showMarkdownPanel(ctx: InteractiveModeContext, title: string, markdown: string): void {
	const block = new TranscriptBlock();
	block.addChild(new DynamicBorder());
	block.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
	block.addChild(new Spacer(1));
	block.addChild(new Markdown(markdown.trim(), 1, 1, getMarkdownTheme()));
	block.addChild(new DynamicBorder());
	ctx.presentCommandOutput(block);
}

export class CommandController {
	constructor(private readonly ctx: InteractiveModeContext) {}

	async #restoreAfterMoveFailure(
		previousState: Parameters<InteractiveModeContext["sessionManager"]["rollbackMove"]>[0],
		initialError?: unknown,
	): Promise<void> {
		if (initialError !== undefined) {
			this.ctx.showError(
				M.ccFailedToSwitchWorkspaceFmt.replace(
					"%s",
					initialError instanceof Error ? initialError.message : String(initialError),
				),
			);
		}

		try {
			await this.ctx.sessionManager.rollbackMove(previousState);
		} catch (rollbackError) {
			const actual = this.ctx.sessionManager.getCwd();
			let realigned = false;
			try {
				realigned = await this.ctx.applyCwdChange(actual);
			} catch {}
			if (!realigned) {
				this.ctx.showError(
					M.ccFailedToRollbackMoveRealignFmt
						.replace("%s", rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
						.replace("%s", actual),
				);
				await this.ctx.shutdown();
				return;
			}
			this.ctx.showError(
				M.ccFailedToRollbackMoveFmt
					.replace("%s", rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
					.replace("%s", actual),
			);
			return;
		}

		let sourceRestored = false;
		try {
			sourceRestored = await this.ctx.applyCwdChange(previousState.cwd);
		} catch {}
		if (sourceRestored) return;

		const actual = this.ctx.sessionManager.getCwd();
		let realigned = false;
		try {
			realigned = await this.ctx.applyCwdChange(actual);
		} catch {}
		if (!realigned) {
			this.ctx.showError(M.ccFailedToRestoreSourceWorkspaceFmt.replace("%s", actual));
			await this.ctx.shutdown();
			return;
		}
		this.ctx.showError(M.ccFailedToRestoreSourceWorkspaceFmt.replace("%s", actual));
	}

	openInBrowser(urlOrPath: string): void {
		openPath(urlOrPath);
	}

	async handleExportCommand(text: string): Promise<void> {
		try {
			const { outputPath, useUserThemes } = parseExportArgs(text.slice("/export".length));
			if (outputPath === "--copy" || outputPath === "clipboard" || outputPath === "copy") {
				this.ctx.showWarning(M.ccUseDumpHint);
				return;
			}

			const filePath = await this.ctx.session.exportToHtml(outputPath, useUserThemes);
			this.ctx.showStatus(M.ccSessionExportedToFmt.replace("%s", filePath));
			this.openInBrowser(filePath);
		} catch (error: unknown) {
			this.ctx.showError(
				M.ccFailedToExportFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
			);
		}
	}
	async handleTraceCommand(): Promise<void> {
		const sessionFile = this.ctx.session.sessionFile;
		if (!sessionFile) {
			this.ctx.showWarning(M.ccNoSessionFileYet);
			return;
		}
		try {
			// Lazy: the stats dashboard (server + sqlite) loads on demand only,
			// matching src/cli/stats-cli.ts, to keep CLI startup fast.
			const { formatStatsDashboardUrl, startServer } = await import("@linxiraos/pi-stats");
			const { hostname, port } = await startServer();
			const url = `${formatStatsDashboardUrl(hostname, port)}/#/traces?s=${encodeURIComponent(sessionFile)}`;
			this.openInBrowser(url);
			this.ctx.showStatus(M.ccTraceFmt.replace("%s", url));
		} catch (error: unknown) {
			this.ctx.showError(
				M.ccFailedToOpenTraceFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
			);
		}
	}

	async handleDumpCommand(): Promise<void> {
		try {
			const formatted = this.ctx.session.formatSessionAsText();
			if (!formatted) {
				this.ctx.showError(M.ccNoMessagesToDump);
				return;
			}
			// Build the LLM request JSON sidecar first so its path (and a
			// raw-context warning) can be appended to the copied transcript.
			let sidecarPath: string | undefined;
			let sidecarError: string | undefined;
			try {
				sidecarPath = await this.ctx.session.dumpLlmRequestToTmpDir();
			} catch (error: unknown) {
				sidecarError = error instanceof Error ? error.message : "Unknown error";
			}
			const doc = sidecarPath
				? `${formatted}\n\n---\n${M.ccLlmRequestJsonFmt.replace("%s", sidecarPath)}\n${M.ccDumpSidecarNote}`
				: formatted;
			await copyToClipboard(doc);
			const statusParts = [M.ccSessionCopiedToClipboard];
			if (sidecarPath) statusParts.push(M.ccLlmRequestJsonFmt.replace("%s", sidecarPath));
			if (sidecarError) statusParts.push(M.ccLlmRequestJsonUnavailableFmt.replace("%s", sidecarError));
			this.ctx.showStatus(statusParts.join("\n"));
		} catch (error: unknown) {
			this.ctx.showError(
				M.ccFailedToCopySessionFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
			);
		}
	}

	handleAdvisorDumpCommand(isRaw = false) {
		try {
			const advisorHistory = this.ctx.session.formatAdvisorHistoryAsText({ compact: !isRaw });
			if (advisorHistory === null) {
				this.ctx.showError(M.ccAdvisorNotActive);
				return;
			}
			if (!advisorHistory) {
				this.ctx.showError(M.ccAdvisorNoHistory);
				return;
			}
			copyToClipboard(advisorHistory);
			this.ctx.showStatus(M.ccAdvisorHistoryCopied);
		} catch (error: unknown) {
			this.ctx.showError(
				`Failed to copy advisor history: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	async handleDebugTranscriptCommand(): Promise<void> {
		try {
			const width = Math.max(1, this.ctx.ui.terminal.columns);
			const renderedLines = this.ctx.chatContainer.render(width).map(line => replaceTabs(Bun.stripANSI(line)));
			const rendered = renderedLines.join("\n").trimEnd();
			if (!rendered) {
				this.ctx.showError(M.ccNoMessagesToDump);
				return;
			}
			const tmpPath = path.join(os.tmpdir(), `${Snowflake.next()}-tmp.txt`);
			await Bun.write(tmpPath, `${rendered}\n`);
			this.ctx.showStatus(M.ccDebugTranscriptFmt.replace("%s", tmpPath));
		} catch (error: unknown) {
			this.ctx.showError(
				`Failed to write debug transcript: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	async handleShareCommand(): Promise<void> {
		let customShare: LoadedCustomShare | null;
		try {
			customShare = await loadCustomShare();
		} catch (err) {
			this.ctx.showError(err instanceof Error ? err.message : String(err));
			return;
		}
		const loader = new BorderedLoader(this.ctx.ui, theme, M.ccSharingSession);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(loader);
		this.ctx.ui.setFocus(loader);
		this.ctx.ui.requestRender();

		const restoreEditor = () => {
			loader.dispose();
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
		};
		loader.onAbort = () => {
			restoreEditor();
			this.ctx.showStatus(M.ccShareCancelled);
		};

		// Custom share scripts keep their legacy contract: they receive a path
		// to a standalone HTML export. No fallback to the default flow on error.
		if (customShare) {
			const tmpFile = path.join(os.tmpdir(), `${Snowflake.next()}.html`);
			try {
				await this.ctx.session.exportToHtml(tmpFile);
				const result = await customShare.fn(tmpFile);
				if (loader.signal.aborted) return;
				restoreEditor();

				if (typeof result === "string") {
					this.ctx.showStatus(M.ccShareUrlFmt.replace("%s", result));
					this.openInBrowser(result);
				} else if (result) {
					const parts: string[] = [];
					if (result.url) parts.push(`Share URL: ${result.url}`);
					if (result.message) parts.push(result.message);
					if (parts.length > 0) this.ctx.showStatus(parts.join("\n"));
					if (result.url) this.openInBrowser(result.url);
				} else {
					this.ctx.showStatus(M.ccSessionShared);
				}
			} catch (err) {
				if (!loader.signal.aborted) {
					restoreEditor();
					this.ctx.showError(
						M.ccCustomShareFailedFmt.replace("%s", err instanceof Error ? err.message : String(err)),
					);
				}
			} finally {
				await fs.rm(tmpFile, { force: true }).catch(() => {});
			}
			return;
		}

		// Default: encrypted snapshot to a secret gist (preferred) or the share
		// server; the key rides in the link fragment and never leaves the client.
		try {
			const result = await shareSession(this.ctx.session.sessionManager, {
				serverUrl: this.ctx.settings.get("share.serverUrl"),
				store: this.ctx.settings.get("share.store"),
				state: this.ctx.session.state,
				obfuscator: this.ctx.settings.get("share.redactSecrets") ? this.ctx.session.obfuscator : undefined,
			});
			if (loader.signal.aborted) return;
			restoreEditor();

			const lines = [M.ccShareUrlFmt.replace("%s", result.url)];
			if (result.gistUrl) lines.push(M.ccGistFmt.replace("%s", result.gistUrl));
			if (result.truncated) lines.push(M.ccShareTrimmedNote);
			this.ctx.showStatus(lines.join("\n"));
			this.openInBrowser(result.url);
		} catch (error: unknown) {
			if (!loader.signal.aborted) {
				restoreEditor();
				this.ctx.showError(
					M.ccFailedToShareSessionFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
				);
			}
		}
	}

	async handleSessionCommand(): Promise<void> {
		const stats = this.ctx.session.getSessionStats();
		const premiumRequests =
			"premiumRequests" in stats && typeof stats.premiumRequests === "number"
				? stats.premiumRequests
				: this.ctx.session.sessionManager.getUsageStatistics().premiumRequests;
		const normalizedPremiumRequests = Math.round((premiumRequests + Number.EPSILON) * 100) / 100;

		let info = "";
		info += `${theme.fg("dim", M.ccLabelFile)} ${stats.sessionFile ?? M.ccInMemory}\n`;
		info += `${theme.fg("dim", M.ccLabelId)} ${stats.sessionId}\n`;
		info += `\n${theme.bold(M.ccProviderTitle)}\n`;
		const model = this.ctx.session.model;
		if (!model) {
			info += `${theme.fg("dim", M.ccNoModelSelected)}\n`;
		} else {
			const authMode = resolveProviderAuthMode(this.ctx.session.modelRegistry.authStorage, model.provider);
			const openaiWebsocketSetting = this.ctx.settings.get("providers.openaiWebsockets") ?? "auto";
			const preferOpenAICodexWebsockets =
				openaiWebsocketSetting === "on" ? true : openaiWebsocketSetting === "off" ? false : undefined;
			const credentialSource = this.ctx.session.modelRegistry.authStorage.describeCredentialSource(
				model.provider,
				stats.sessionId,
			);
			const providerDetails = getProviderDetails({
				model,
				sessionId: stats.sessionId,
				authMode,
				credentialSource,
				preferWebsockets: preferOpenAICodexWebsockets,
				providerSessionState: this.ctx.session.providerSessionState,
			});
			info += renderProviderSection(providerDetails, theme);
			if (stats.routedModels !== undefined) {
				const routed = Object.entries(stats.routedModels)
					.sort(([aId, aCount], [bId, bCount]) => bCount - aCount || aId.localeCompare(bId))
					.map(
						([id, count]) => `${replaceTabs(sanitizeText(id))}${count > 1 ? theme.fg("dim", ` ×${count}`) : ""}`,
					);
				info += `${theme.fg("dim", M.ccLabelServed)} ${routed.join(", ")}\n`;
			}
		}
		info += `\n`;
		info += `${theme.bold(M.ccMessagesTitle)}\n`;
		info += `${theme.fg("dim", M.ccLabelUser)} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", M.ccLabelAssistant)} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", M.ccLabelToolCalls)} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", M.ccLabelToolResults)} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", M.ccLabelTotal)} ${stats.totalMessages}\n\n`;
		// Append-only context
		{
			const setting = this.ctx.settings.get("provider.appendOnlyContext") ?? "auto";
			const model = this.ctx.session.model;
			const mode = shouldEnableAppendOnlyContext(setting, model);
			const activeLabel = mode ? theme.fg("success", M.ccActive) : theme.fg("dim", M.ccInactive);
			const settingLabel = setting === "auto" ? `${setting} (${model?.provider ?? "?"})` : setting;
			info += `${theme.fg("dim", M.ccLabelAppendOnly)} ${activeLabel} (${M.ccSettingLabel} ${settingLabel})\n`;
		}
		info += `${theme.bold(M.ccTokensTitle)}\n`;
		info += `${theme.fg("dim", M.ccLabelInput)} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", M.ccLabelOutput)} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", M.ccLabelCacheRead)} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", M.ccLabelCacheWrite)} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", M.ccLabelTotal)} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0 || normalizedPremiumRequests > 0 || stats.credits !== undefined) {
			info += `\n${theme.bold(M.ccCostTitle)}\n`;
			if (stats.cost > 0) {
				info += `${theme.fg("dim", M.ccLabelTotal)} ${stats.cost.toFixed(4)}\n`;
			}
			if (normalizedPremiumRequests > 0) {
				info += `${theme.fg("dim", M.ccLabelPremiumRequests)} ${normalizedPremiumRequests.toLocaleString()}\n`;
			}
			if (stats.credits !== undefined) {
				info += `${theme.fg("dim", M.ccLabelCredits)} ${formatCreditValue(stats.credits.cost)}\n`;
				info += `${theme.fg("dim", M.ccLabelCommittedCredits)} ${formatCreditValue(stats.credits.committedCost)}\n`;
				info += `${theme.fg("dim", M.ccLabelCommittedAcu)} ${formatCreditValue(stats.credits.acuCost)}\n`;
			}
		}

		if (this.ctx.lspServers && this.ctx.lspServers.length > 0) {
			info += `\n${theme.bold(M.ccLspServersTitle)}\n`;
			for (const server of this.ctx.lspServers) {
				const statusColor =
					server.status === "ready"
						? "success"
						: server.status === "available"
							? "dim"
							: server.status === "connecting"
								? "warning"
								: "error";
				const statusText =
					server.status === "error" && server.error ? `${server.status}: ${server.error}` : server.status;
				info += `${theme.fg("dim", `${server.name}:`)} ${theme.fg(statusColor, statusText)} ${theme.fg("dim", `(${server.fileTypes.join(", ")})`)}\n`;
			}
		}

		if (this.ctx.mcpManager) {
			const mcpServers = this.ctx.mcpManager.getConnectedServers();
			info += `\n${theme.bold(M.ccMcpServersTitle)}\n`;
			if (mcpServers.length === 0) {
				info += `${theme.fg("dim", M.ccNoneConnected)}\n`;
			} else {
				for (const name of mcpServers) {
					const conn = this.ctx.mcpManager.getConnection(name);
					const toolCount = conn?.tools?.length ?? 0;
					info += `${theme.fg("dim", `${name}:`)} ${theme.fg("success", M.ccConnected)} ${theme.fg("dim", M.ccToolsCountFmt.replace("%s", String(toolCount)))}\n`;
				}
			}
		}

		this.ctx.showSessionInfo(info);
	}

	static readonly #advisorStatusGlyph: Record<string, string> = {
		running: "●",
		paused: "○",
		no_model: "○",
		quota_exhausted: "✕",
		error: "✕",
	};

	static #advisorStatusLabel(status: string): string {
		switch (status) {
			case "running":
				return M.ccAdvisorStatusRunning;
			case "paused":
				return M.ccAdvisorStatusPaused;
			case "no_model":
				return M.ccAdvisorStatusNoModel;
			case "quota_exhausted":
				return M.ccAdvisorStatusQuotaExhausted;
			case "error":
				return M.ccAdvisorStatusError;
			default:
				return status;
		}
	}

	async handleAdvisorStatusCommand(): Promise<void> {
		const stats = this.ctx.session.getAdvisorStats();
		if (!stats.configured) {
			this.ctx.presentCommandOutput([new Spacer(1), new Text(M.ccAdvisorDisabled, 1, 0)]);
			return;
		}
		// Fetch live quota data (cached 5 min by the auth-gateway) so we can show
		// real usage windows/reset timers per advisor provider. Non-fatal when absent.
		const usageProvider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
		let usageReports: UsageReport[] | null = null;
		if (usageProvider.fetchUsageReports) {
			try {
				usageReports = await usageProvider.fetchUsageReports();
			} catch {
				// Network/auth failure is non-fatal — just skip the quota line.
			}
		}
		// Resolve the active OAuth identity for each advisor's provider so quota
		// filtering matches the credential actually in use (not sibling accounts).
		const resolveActiveAdvisorAccount = (provider: string, sessionId?: string): OAuthAccountIdentity | undefined =>
			this.ctx.session.modelRegistry.authStorage.getOAuthAccountIdentity(
				provider,
				sessionId ?? this.ctx.session.sessionId,
			);
		const nowMs = Date.now();
		// Roster view: show every configured advisor with its status, even when
		// none are live (all paused/no-model). The old code returned a generic
		// message that hid the per-advisor state the user needs to act on.
		if (stats.advisors.length > 1 || (stats.configured && !stats.active)) {
			let info = `${theme.bold(M.ccAdvisorStatusTitle)} ${M.ccAdvisorCountFmt.replace("%s", String(stats.advisors.length))}\n`;
			for (const a of stats.advisors) {
				const glyph = CommandController.#advisorStatusGlyph[a.status] ?? "?";
				const label = CommandController.#advisorStatusLabel(a.status);
				const color =
					a.status === "running"
						? "success"
						: a.status === "quota_exhausted" || a.status === "error"
							? "error"
							: "dim";
				info += `\n${theme.fg(color, glyph)} ${theme.bold(a.name)} ${theme.fg("dim", `[${label}]`)}\n`;
				if (a.model) {
					info += `${theme.fg("dim", M.ccLabelModel)} ${a.model.provider}/${a.model.id}\n`;
				}
				if (a.model && usageReports) {
					const identity = resolveActiveAdvisorAccount(a.model.provider, a.sessionId);
					const quota = formatCompactQuota(
						a.model.provider,
						collapseSharedUsageReports(usageReports),
						nowMs,
						(report, limit) => !identity || limitMatchesActiveAccount(report, limit, identity),
					);
					if (quota) info += `${theme.fg("dim", quota)}\n`;
				}
				if (a.status === "running" || a.status === "quota_exhausted") {
					const ctx =
						a.contextWindow > 0
							? `${a.contextTokens.toLocaleString()} / ${a.contextWindow.toLocaleString()} (${Math.round((a.contextTokens / a.contextWindow) * 100)}%)`
							: `${a.contextTokens.toLocaleString()}`;
					info += `${theme.fg("dim", M.ccLabelContext)} ${ctx}\n`;
					info += `${theme.fg("dim", M.ccLabelMessages)} ${a.messages.total.toLocaleString()}\n`;
					info += `${theme.fg("dim", M.ccLabelSpend)} ${a.tokens.input.toLocaleString()} in / ${a.tokens.output.toLocaleString()} out`;
					if (a.cost > 0) info += `, $${a.cost.toFixed(4)}`;
					info += "\n";
				}
			}
			if (stats.active) {
				info += `\n${theme.bold(M.ccTotalsTitle)}\n`;
				info += `${theme.fg("dim", M.ccLabelTokens)} ${stats.tokens.total.toLocaleString()}\n`;
				if (stats.cost > 0) info += `${theme.fg("dim", M.ccLabelCost)} $${stats.cost.toFixed(4)}\n`;
			}
			this.ctx.presentCommandOutput([new Spacer(1), new Text(info, 1, 0)]);
			return;
		}
		// Single active advisor — detailed view.
		const model = stats.model;
		let info = `${theme.bold(M.ccAdvisorStatusTitle)}\n\n`;
		if (stats.advisors.length === 1) {
			const a = stats.advisors[0];
			const glyph = CommandController.#advisorStatusGlyph[a.status] ?? "?";
			const label = CommandController.#advisorStatusLabel(a.status);
			info += `${theme.fg(a.status === "running" ? "success" : "error", glyph)} ${a.name} ${theme.fg("dim", `[${label}]`)}\n\n`;
		}
		if (model) {
			info += `${theme.bold(M.ccProviderTitle)}\n`;
			info += `${theme.fg("dim", M.ccLabelModel)} ${model.provider}/${model.id}\n`;
		}
		if (model && usageReports) {
			const identity = resolveActiveAdvisorAccount(model.provider, stats.advisors[0]?.sessionId);
			const quota = formatCompactQuota(
				model.provider,
				collapseSharedUsageReports(usageReports),
				nowMs,
				(report, limit) => !identity || limitMatchesActiveAccount(report, limit, identity),
			);
			if (quota) {
				info += `\n${theme.bold(M.ccQuotaTitle)}\n`;
				info += `${theme.fg("dim", quota)}\n`;
			}
		}
		info += `\n${theme.bold(M.ccMessagesTitle)}\n`;
		info += `${theme.fg("dim", M.ccLabelUser)} ${stats.messages.user.toLocaleString()}\n`;
		info += `${theme.fg("dim", M.ccLabelAssistant)} ${stats.messages.assistant.toLocaleString()}\n`;
		info += `${theme.fg("dim", M.ccLabelTotal)} ${stats.messages.total.toLocaleString()}\n`;
		info += `\n${theme.bold(M.ccContextTitle)}\n`;
		if (stats.contextWindow > 0) {
			const percent = Math.round((stats.contextTokens / stats.contextWindow) * 100);
			info += `${theme.fg("dim", M.ccLabelTokens)} ${stats.contextTokens.toLocaleString()} / ${stats.contextWindow.toLocaleString()} (${percent}%)\n`;
		} else {
			info += `${theme.fg("dim", M.ccLabelTokens)} ${stats.contextTokens.toLocaleString()}\n`;
		}
		info += `\n${theme.bold(M.ccSpendTitle)}\n`;
		info += `${theme.fg("dim", M.ccLabelInput)} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", M.ccLabelOutput)} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", M.ccLabelCacheRead)} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.cost > 0) info += `${theme.fg("dim", M.ccLabelCost)} $${stats.cost.toFixed(4)}\n`;
		this.ctx.presentCommandOutput([new Spacer(1), new Text(info, 1, 0)]);
	}

	async handleJobsCommand(): Promise<void> {
		const snapshot = this.ctx.session.getAsyncJobSnapshot({ recentLimit: 5 });
		if (!snapshot) {
			this.ctx.showWarning(M.ccBgJobsUnavailable);
			return;
		}

		const now = Date.now();
		const lineWidth = Math.max(24, (this.ctx.ui.terminal.columns ?? 100) - 24);
		let info = `${theme.bold(M.ccBgJobsTitle)}\n\n`;
		info += `${theme.fg("dim", M.ccLabelRunning)} ${snapshot.running.length}\n`;

		if (snapshot.running.length === 0 && snapshot.recent.length === 0) {
			info += `\n${theme.fg("dim", M.ccNoAsyncJobsYet)}\n`;
			this.ctx.presentCommandOutput([new Spacer(1), new Text(info, 1, 0)]);
			return;
		}

		if (snapshot.running.length > 0) {
			info += `\n${theme.bold(M.ccRunningJobsTitle)}\n`;
			for (const job of snapshot.running) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		if (snapshot.recent.length > 0) {
			info += `\n${theme.bold(M.ccRecentJobsTitle)}\n`;
			for (const job of snapshot.recent) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		this.ctx.presentCommandOutput([new Spacer(1), new Text(info.trimEnd(), 1, 0)]);
	}

	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			const provider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning(M.ccUsageNotConfigured);
				return;
			}
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				this.ctx.showError(
					M.ccFailedToFetchUsageFmt.replace("%s", error instanceof Error ? error.message : String(error)),
				);
				return;
			}
		}

		if (!usageReports || usageReports.length === 0) {
			this.ctx.showWarning(M.ccNoUsageData);
			return;
		}

		this.ctx.showUsageDashboard(usageReports);
	}

	async handleChangelogCommand(showFull = false): Promise<void> {
		const changelogPath = getChangelogPath();
		const allEntries = await parseChangelog(changelogPath);
		const entriesToShow = showFull ? allEntries : allEntries.slice(0, RECENT_CHANGELOG_ENTRY_LIMIT);
		const changelogMarkdown =
			entriesToShow.length > 0 ? renderChangelogEntries(entriesToShow).markdown : M.ccNoChangelogEntries;
		const title = showFull ? M.ccFullChangelog : M.ccRecentChanges;
		const hint = showFull
			? ""
			: `\n\n${theme.fg("dim", M.ccChangelogHintUse)} ${theme.bold("/changelog full")} ${theme.fg("dim", M.ccChangelogHintTail)}`;

		const block = new TranscriptBlock();
		block.addChild(new DynamicBorder());
		block.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
		block.addChild(new Spacer(1));
		block.addChild(new Markdown(changelogMarkdown + hint, 1, 1, getMarkdownTheme()));
		block.addChild(new DynamicBorder());
		this.ctx.presentCommandOutput(block);
	}

	handleHotkeysCommand(): void {
		const hotkeys = buildHotkeysMarkdown({ keybindings: this.ctx.keybindings });
		showMarkdownPanel(this.ctx, M.ccKeyboardShortcuts, hotkeys);
	}

	handleToolsCommand(): void {
		const tools = buildToolsMarkdown({
			tools: this.ctx.session.agent.state.tools,
			xdevTools: this.ctx.session.getXdevToolEntries(),
		});
		showMarkdownPanel(this.ctx, M.ccAvailableTools, tools);
	}

	handleContextCommand(): void {
		const breakdown = computeSessionContextBreakdown(this.ctx.session, { snapcompactSavings: true });
		if (breakdown.contextWindow <= 0) {
			this.ctx.showWarning(M.ccContextUsageUnavailable);
			return;
		}
		const output = renderContextUsage(breakdown, theme);
		const block = new TranscriptBlock();
		block.addChild(new DynamicBorder());
		block.addChild(new Text(theme.bold(theme.fg("accent", M.ccContextUsageTitle)), 1, 0));
		block.addChild(new Spacer(1));
		block.addChild(new Text(output, 1, 0));
		block.addChild(new DynamicBorder());
		this.ctx.presentCommandOutput(block);
	}

	async handleMemoryCommand(text: string): Promise<void> {
		const argumentText = text.slice(7).trim();
		const action = argumentText.split(/\s+/, 1)[0]?.toLowerCase() || "view";
		const agentDir = this.ctx.settings.getAgentDir();
		const backend = await resolveMemoryBackend(this.ctx.settings);

		if (action === "view") {
			const payload = await backend.buildDeveloperInstructions(agentDir, this.ctx.settings, this.ctx.session);
			if (!payload) {
				this.ctx.showWarning(M.ccMemoryPayloadEmpty);
				return;
			}
			const block = new TranscriptBlock();
			block.addChild(new DynamicBorder());
			block.addChild(new Text(theme.bold(theme.fg("accent", M.ccMemoryInjectionTitle)), 1, 0));
			block.addChild(new Spacer(1));
			block.addChild(new Markdown(payload, 1, 1, getMarkdownTheme()));
			block.addChild(new DynamicBorder());
			this.ctx.presentCommandOutput(block);
			return;
		}

		if (action === "reset" || action === "clear") {
			try {
				await backend.clear(agentDir, this.ctx.sessionManager.getCwd(), this.ctx.session);
				await this.ctx.session.refreshBaseSystemPrompt();
				this.ctx.showStatus(M.ccMemoryCleared);
			} catch (error) {
				this.ctx.showError(
					M.ccMemoryClearFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)),
				);
			}
			return;
		}

		if (action === "enqueue" || action === "rebuild") {
			try {
				await backend.enqueue(agentDir, this.ctx.sessionManager.getCwd(), this.ctx.session);
				this.ctx.showStatus(M.ccMemoryConsolidationEnqueued);
			} catch (error) {
				this.ctx.showError(
					M.ccMemoryEnqueueFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)),
				);
			}
			return;
		}
		if (action === "queue") {
			try {
				const payload = await backend.queuePreview?.({
					agentDir,
					cwd: this.ctx.sessionManager.getCwd(),
					session: this.ctx.session,
				});
				if (!payload) {
					this.ctx.showWarning(M.ccMemoryActionUnavailableFmt.replace("%s", "queue").replace("%s", backend.id));
					return;
				}
				showMarkdownPanel(this.ctx, M.ccMemoryPanelTitleFmt.replace("%s", "Queue"), payload);
			} catch (error) {
				this.ctx.showError(
					M.ccMemoryFailedFmt
						.replace("%s", "queue")
						.replace("%s", error instanceof Error ? error.message : String(error)),
				);
			}
			return;
		}

		if (action === "sync") {
			try {
				await backend.enqueue(agentDir, this.ctx.sessionManager.getCwd(), this.ctx.session);
				this.ctx.showStatus(M.ccMemoryConsolidationRan);
			} catch (error) {
				this.ctx.showError(
					M.ccMemoryFailedFmt
						.replace("%s", "sync")
						.replace("%s", error instanceof Error ? error.message : String(error)),
				);
			}
			return;
		}

		if (action === "stats" || action === "diagnose") {
			const hook = action === "stats" ? backend.stats : backend.diagnose;
			try {
				const payload = await hook?.(agentDir, this.ctx.sessionManager.getCwd(), this.ctx.session);
				if (!payload) {
					this.ctx.showWarning(memoryStatsUnavailableMessage(backend.id, action));
					return;
				}
				showMarkdownPanel(
					this.ctx,
					M.ccMemoryPanelTitleFmt.replace("%s", action === "stats" ? M.ccMemoryStats : M.ccMemoryDiagnostics),
					payload,
				);
			} catch (error) {
				this.ctx.showError(
					M.ccMemoryFailedFmt
						.replace("%s", action)
						.replace("%s", error instanceof Error ? error.message : String(error)),
				);
			}
			return;
		}

		if (action === "mm") {
			await this.#handleMentalModelsSubcommand(argumentText);
			return;
		}

		this.ctx.showError(M.ccMemoryUsage);
	}

	async #handleMentalModelsSubcommand(argumentText: string): Promise<void> {
		// Parse: "mm <verb> [arg]"
		const parts = argumentText.split(/\s+/).slice(1);
		const verb = parts[0]?.toLowerCase() ?? "list";
		const arg = parts[1];

		const state = this.ctx.session.getHindsightSessionState();
		const primary = state && !state.aliasOf ? state : undefined;
		if (!primary) {
			this.ctx.showError(M.ccHindsightNotActive);
			return;
		}
		if (!primary.config.mentalModelsEnabled) {
			this.ctx.showError(M.ccMentalModelsDisabled);
			return;
		}

		switch (verb) {
			case "list":
				await this.#mmList(primary);
				return;
			case "show":
				if (!arg) return this.ctx.showError(M.ccMmShowUsage);
				await this.#mmShow(primary, arg);
				return;
			case "refresh":
				await this.#mmRefresh(primary, arg);
				return;
			case "history":
				if (!arg) return this.ctx.showError(M.ccMmHistoryUsage);
				await this.#mmHistory(primary, arg);
				return;
			case "seed":
				await this.#mmSeed(primary);
				return;
			case "reload":
				await this.#mmReload(primary);
				return;
			case "delete":
			case "remove":
				if (!arg) return this.ctx.showError(M.ccMmDeleteUsage);
				await this.#mmDelete(primary, arg);
				return;
			default:
				this.ctx.showError(M.ccMmUsage);
		}
	}

	async #mmList(state: HindsightSessionState): Promise<void> {
		const client: HindsightApi = state.client;
		try {
			const response = await client.listMentalModels(state.bankId, { detail: "metadata" });
			const items = response.items ?? [];
			if (items.length === 0) {
				this.ctx.showStatus(M.ccNoMentalModelsOnBankFmt.replace("%s", state.bankId));
				return;
			}
			const lines = items
				.slice()
				.sort((a, b) => a.id.localeCompare(b.id))
				.map(summarizeMentalModel);
			showMarkdownPanel(this.ctx, M.ccMentalModelsTitleFmt.replace("%s", state.bankId), lines.join("\n"));
		} catch (error) {
			this.ctx.showError(M.ccMmListFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)));
		}
	}

	async #mmShow(state: HindsightSessionState, id: string): Promise<void> {
		try {
			const model = await state.client.getMentalModel(state.bankId, id, { detail: "content" });
			if (!model) {
				this.ctx.showError(M.ccMentalModelNotFoundFmt.replace("%s", id));
				return;
			}
			const tags =
				model.tags && model.tags.length > 0 ? `\n${M.ccTagsLineFmt.replace("%s", model.tags.join(", "))}_` : "";
			const refreshed = model.last_refreshed_at
				? `\n${M.ccLastRefreshedLineFmt.replace("%s", model.last_refreshed_at)}_`
				: "";
			const sourceQuery = model.source_query ? `\n\n${M.ccSourceQueryFmt.replace("%s", model.source_query)}` : "";
			const content = (model.content ?? M.ccEmptyModelContent).trim();
			showMarkdownPanel(
				this.ctx,
				model.name,
				`${M.ccModelIdFmt.replace("%s", model.id)}${tags}${refreshed}${sourceQuery}\n\n${content}`,
			);
		} catch (error) {
			this.ctx.showError(M.ccMmShowFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)));
		}
	}

	async #mmRefresh(state: HindsightSessionState, id: string | undefined): Promise<void> {
		try {
			if (id) {
				// Single-model refresh is explicit operator intent: bypass the
				// auto-refresh filter so curated/manual models can still be
				// refreshed on demand.
				await state.client.refreshMentalModel(state.bankId, id);
				this.ctx.showStatus(M.ccRefreshQueuedForFmt.replace("%s", id));
			} else {
				// Bulk refresh: only touch models that opted into automatic
				// refresh via `trigger.refresh_after_consolidation`. Curated
				// models are reviewed before publishing and must not be
				// silently regenerated by a bank-wide refresh sweep. Reading
				// `detail: "content"` here is required because the trigger
				// field is excluded from `detail: "metadata"`.
				const list = await state.client.listMentalModels(state.bankId, { detail: "content" });
				const items = list.items ?? [];
				if (items.length === 0) {
					this.ctx.showStatus(M.ccNoMentalModelsOnBankFmt.replace("%s", state.bankId));
					return;
				}
				const targets = items.filter(m => m.trigger?.refresh_after_consolidation === true);
				const skipped = items.length - targets.length;
				if (targets.length === 0) {
					this.ctx.showStatus(M.ccNoAutoRefreshModelsFmt.replace("%s", String(skipped)));
					return;
				}
				let queued = 0;
				for (const item of targets) {
					try {
						await state.client.refreshMentalModel(state.bankId, item.id);
						queued++;
					} catch (error) {
						this.ctx.showWarning(
							M.ccRefreshFailedForFmt
								.replace("%s", item.id)
								.replace("%s", error instanceof Error ? error.message : String(error)),
						);
					}
				}
				const skippedSuffix = skipped > 0 ? M.ccSkippedCuratedFmt.replace("%s", String(skipped)) : "";
				this.ctx.showStatus(
					M.ccRefreshQueuedCountFmt
						.replace("%s", String(queued))
						.replace("%s", String(targets.length))
						.replace("%s", skippedSuffix),
				);
			}
			// Reload the cache after a brief grace so the new content (if the refresh
			// completes synchronously on the server) flows into the system prompt.
			await Bun.sleep(500);
			await reloadMentalModelsForSession(state.session);
		} catch (error) {
			this.ctx.showError(
				M.ccMmRefreshFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)),
			);
		}
	}

	async #mmHistory(state: HindsightSessionState, id: string): Promise<void> {
		try {
			const [model, history] = await Promise.all([
				state.client.getMentalModel(state.bankId, id, { detail: "content" }),
				state.client.getMentalModelHistory(state.bankId, id),
			]);
			if (!model) {
				this.ctx.showError(M.ccMentalModelNotFoundFmt.replace("%s", id));
				return;
			}
			if (history.length === 0) {
				this.ctx.showStatus(M.ccNoHistoryForFmt.replace("%s", id));
				return;
			}
			// History is most-recent first. Each entry stores the content BEFORE that
			// change. To diff "what changed at entry N", compare entry N's
			// previous_content (= state before that change) with entry N-1's
			// previous_content (= state after that change, which was state before
			// the next change). For the most recent change, compare against the
			// model's CURRENT content.
			const sections: string[] = [];
			for (let i = 0; i < history.length; i++) {
				const before = history[i].previous_content ?? "";
				const after = i === 0 ? (model.content ?? "") : (history[i - 1].previous_content ?? "");
				const diff = diffMentalModelContent(before, after);
				sections.push(`### ${history[i].changed_at}\n\n\`\`\`diff\n${diff}\n\`\`\``);
			}
			showMarkdownPanel(this.ctx, M.ccHistoryTitleFmt.replace("%s", model.name), sections.join("\n\n"));
		} catch (error) {
			this.ctx.showError(
				M.ccMmHistoryFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)),
			);
		}
	}
	async #mmSeed(state: HindsightSessionState): Promise<void> {
		try {
			const config = loadHindsightConfig(this.ctx.settings);
			const seeds = resolveSeedsForScope(
				{
					bankId: state.bankId,
					retainTags: state.retainTags,
					recallTags: state.recallTags,
					recallTagsMatch: state.recallTagsMatch,
				},
				config.scoping,
			);
			if (seeds.length === 0) {
				this.ctx.showStatus(M.ccNoSeedsForScopeFmt.replace("%s", String(config.scoping)));
				return;
			}
			const list = await state.client.listMentalModels(state.bankId, { detail: "metadata" });
			const existing = list.items ?? [];
			let created = 0;
			let skipped = 0;
			for (const seed of seeds) {
				if (seedAlreadyExists(seed, existing)) {
					skipped++;
					continue;
				}
				try {
					await state.client.createMentalModel(state.bankId, seed.name, seed.sourceQuery, {
						id: seed.id,
						tags: seed.tags.length > 0 ? seed.tags : undefined,
						maxTokens: seed.maxTokens,
						trigger: seed.trigger,
					});
					created++;
				} catch (error) {
					this.ctx.showWarning(
						M.ccSeedFailedForFmt
							.replace("%s", seed.id)
							.replace("%s", error instanceof Error ? error.message : String(error)),
					);
				}
			}
			this.ctx.showStatus(M.ccSeededCountFmt.replace("%s", String(created)).replace("%s", String(skipped)));
		} catch (error) {
			this.ctx.showError(M.ccMmSeedFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)));
		}
	}

	async #mmReload(state: HindsightSessionState): Promise<void> {
		const ok = await reloadMentalModelsForSession(state.session);
		if (ok) {
			this.ctx.showStatus(M.ccCacheReloaded);
		} else {
			this.ctx.showError(M.ccReloadFailed);
		}
	}

	async #mmDelete(state: HindsightSessionState, id: string): Promise<void> {
		try {
			const removed = await state.client.deleteMentalModel(state.bankId, id);
			if (!removed) {
				this.ctx.showError(M.ccMentalModelNotFoundFmt.replace("%s", id));
				return;
			}
			// Drop the cached snippet so the closing tag does not silently keep
			// stale content in the system prompt until the next agent_end TTL.
			await reloadMentalModelsForSession(state.session);
			this.ctx.showStatus(M.ccDeletedFromBankFmt.replace("%s", id).replace("%s", state.bankId));
		} catch (error) {
			this.ctx.showError(
				M.ccMmDeleteFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)),
			);
		}
	}

	async #runNewSessionFlow(options?: NewSessionOptions, label: string = M.ccNewSessionStarted): Promise<void> {
		this.ctx.clearTransientSessionUi();

		if (this.ctx.session.isCompacting) {
			this.ctx.session.abortCompaction();
			while (this.ctx.session.isCompacting) {
				await Bun.sleep(10);
			}
		}
		if (!(await this.ctx.session.newSession(options))) return;
		// A focused subagent view keeps its own history: return to the main session
		// first so the transcript below cannot rebuild from the subagent's surviving
		// conversation, then drop any turn-scoped anchors (coalescing timers,
		// in-flight dispatches) the session boundary orphaned.
		if (this.ctx.focusedAgentId) await this.ctx.unfocusSession();
		this.ctx.eventController.resetTranscriptAnchors();
		this.ctx.resetObserverRegistry();
		setSessionTerminalTitle(this.ctx.sessionManager.getSessionName(), this.ctx.sessionManager.getCwd());

		this.ctx.statusLine.invalidate();
		this.ctx.statusLine.resetActiveTime();
		this.ctx.updateEditorBorderColor();
		this.ctx.clearTransientSessionUi();
		this.ctx.resetTranscript();

		this.ctx.present([new Spacer(1), new Text(`${theme.fg("accent", `${theme.status.success} ${label}`)}`, 1, 1)]);
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender(true, { clearScrollback: true });
	}

	async handleClearCommand(): Promise<void> {
		await this.#runNewSessionFlow();
	}

	async handleFreshCommand(): Promise<void> {
		const result = this.ctx.session.freshSession();
		if (!result) {
			this.ctx.showWarning(M.ccWaitForResponseRefresh);
			return;
		}
		const stateLabel = result.closedProviderSessions === 1 ? M.ccProviderState : M.ccProviderStates;
		this.ctx.statusLine.invalidate();
		this.ctx.ui.requestRender();
		this.ctx.showStatus(
			M.ccFreshProviderSessionFmt.replace("%s", String(result.closedProviderSessions)).replace("%s", stateLabel),
		);
	}
	async handleResetContextCommand(): Promise<void> {
		if (this.ctx.session.isCompacting) {
			this.ctx.session.abortCompaction();
			while (this.ctx.session.isCompacting) {
				await Bun.sleep(10);
			}
		}
		const result = await this.ctx.session.resetSessionContext();
		if (!result) {
			this.ctx.showWarning(M.ccWaitForResponseResetContext);
			return;
		}
		// Drop the rendered transcript so the UI matches the now-empty model
		// context (mirrors #runNewSessionFlow's teardown, minus the new session —
		// the session id, title, and transcript file all survive).
		this.ctx.clearTransientSessionUi();
		this.ctx.resetTranscript();
		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorBorderColor();
		this.ctx.present([
			new Spacer(1),
			new Text(
				theme.fg(
					"accent",
					`${theme.status.success} ${
						result.droppedCount === 1
							? M.ccContextResetOneFmt
							: M.ccContextResetManyFmt.replace("%s", String(result.droppedCount))
					}`,
				),
				1,
				1,
			),
		]);
		this.ctx.ui.requestRender(true, { clearScrollback: true });
	}

	async handleDeleteCommand(): Promise<void> {
		if (!this.ctx.sessionManager.getSessionFile()) {
			this.ctx.showError(M.ccNothingToDelete);
			return;
		}
		await this.#runNewSessionFlow({ drop: true }, M.statusSessionDeleted);
	}

	async handleForkCommand(): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(M.ccWaitForResponseFork);
			return;
		}
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.disposeChildren();

		const success = await this.ctx.session.fork();
		if (!success) {
			this.ctx.showError(M.ccForkFailed);
			return;
		}

		this.ctx.statusLine.invalidate();
		this.ctx.ui.requestRender();

		const sessionFile = this.ctx.session.sessionFile;
		const shortPath = (sessionFile ? sessionFile.split("/").pop() : undefined) ?? M.ccNewSession;
		this.ctx.present([
			new Spacer(1),
			new Text(
				`${theme.fg("accent", `${theme.status.success} ${M.ccSessionForkedToFmt.replace("%s", shortPath)}`)}`,
				1,
				1,
			),
		]);
	}

	/**
	 * `/move` — relocate the current session to a different directory.
	 *
	 * With no `targetPath` (TUI only), opens an autocomplete overlay so the user
	 * can pick or type a directory. With a `targetPath`, resolves it directly.
	 * If the target directory does not exist, the user is asked whether to create
	 * it. The active session file and artifacts are moved into the target
	 * directory's session bucket so `/resume` from that directory can find it.
	 */
	async handleMoveCommand(targetPath?: string): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(M.ccWaitForResponseMove);
			return;
		}

		let input: string | undefined = targetPath?.trim() || undefined;

		// No argument in TUI mode: open the path autocomplete overlay.
		if (!input) {
			const result = await this.ctx.showHookCustom<MoveOverlayResult | undefined>(
				(_tui, _theme, _keybindings, done) =>
					new MoveOverlay(this.ctx.sessionManager.getCwd(), done, moveDirectorySource),
				{ overlay: true },
			);
			if (!result) return; // cancelled
			input = result.directory;
		}

		const unquoted = stripOuterDoubleQuotes(input);
		if (!unquoted) {
			this.ctx.showError(M.ccMoveUsage);
			return;
		}

		const cwd = this.ctx.sessionManager.getCwd();
		const resolvedPath = resolveToCwd(unquoted, cwd);

		// If the directory doesn't exist, offer to create it.
		let isDirectory: boolean;
		try {
			isDirectory = (await fs.stat(resolvedPath)).isDirectory();
		} catch {
			isDirectory = false;
		}

		if (!isDirectory) {
			const parentDir = path.dirname(resolvedPath);
			let parentExists = false;
			try {
				parentExists = (await fs.stat(parentDir)).isDirectory();
			} catch {
				parentExists = false;
			}
			if (!parentExists) {
				this.ctx.showError(M.ccCannotCreateDirFmt.replace("%s", path.basename(resolvedPath)));
				return;
			}
		}
		const moved = await this.#withSessionMove(async () => {
			if (!isDirectory) {
				const confirmed = await this.ctx.showHookConfirm(
					M.ccCreateDirectory,
					M.ccCreateDirectoryConfirmFmt.replace("%s", path.basename(resolvedPath)),
				);
				if (!confirmed) return false;
				try {
					await fs.mkdir(resolvedPath, { recursive: true });
				} catch (err) {
					this.ctx.showError(
						M.ccFailedToCreateDirFmt.replace("%s", err instanceof Error ? err.message : String(err)),
					);
					return false;
				}
			}
			return this.#relocateSession(resolvedPath);
		});
		if (moved) {
			this.ctx.present([
				new Spacer(1),
				new Text(`${theme.fg("accent", `${theme.status.success} Moved to ${resolvedPath}`)}`, 1, 1),
			]);
		}
	}

	/**
	 * `/wt [<branch>]` — fork the checkout into a new linked git worktree on
	 * `branch` (default `wt/<timestamp>`), carrying uncommitted changes along,
	 * then relocate the session there like `/move`.
	 */
	async handleWorktreeCommand(branch?: string): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(M.ccWaitForResponseWorktree);
			return;
		}
		await this.#withSessionMove(async () => {
			const branchName = branch?.trim() || defaultSessionWorktreeBranch();
			const cwd = this.ctx.sessionManager.getCwd();
			this.ctx.statusContainer.disposeChildren();
			const loader = new Loader(
				this.ctx.ui,
				spinner => theme.fg("accent", spinner),
				text => theme.fg("muted", text),
				M.ccCreatingWorktreeFmt.replace("%s", branchName),
				getSymbolTheme().spinnerFrames,
			);
			this.ctx.statusContainer.addChild(loader);
			this.ctx.ui.requestRender();
			let worktree: SessionWorktree;
			try {
				worktree = await createSessionWorktree(cwd, this.ctx.settings, branchName);
			} catch (err) {
				this.ctx.showError(
					M.ccWorktreeCreateFailedFmt.replace("%s", err instanceof Error ? err.message : String(err)),
				);
				return false;
			} finally {
				loader.stop();
				this.ctx.statusContainer.disposeChildren();
			}
			if (worktree.cloneError) {
				logger.warn("worktree clone fell back to plain checkout", {
					path: worktree.path,
					error: worktree.cloneError,
				});
			}
			if (!(await this.#relocateSession(worktree.path))) return false;
			const cleanup = await cleanSourceCheckoutIfConfigured(cwd, this.ctx.settings);
			if (cleanup.errorMessage !== undefined) {
				this.ctx.showWarning(M.ccWorktreeCleanupFailedFmt.replace("%s", cleanup.errorMessage));
			}
			this.ctx.present([
				new Spacer(1),
				new Text(
					`${theme.fg("accent", `${theme.status.success} ${formatSessionWorktreeSummary(worktree, cleanup.cleaned)}`)}`,
					1,
					1,
				),
			]);
			return true;
		});
	}

	/** Save source settings before acquiring the gate for a complete relocation operation. */
	async #withSessionMove(operation: () => Promise<boolean>): Promise<boolean> {
		try {
			await this.ctx.settings.flush();
		} catch (err) {
			this.ctx.showError(
				M.ccFailedToSaveSettingsFmt.replace("%s", err instanceof Error ? err.message : String(err)),
			);
			return false;
		}

		return this.ctx.withBtwSessionMove(operation);
	}

	/** Relocate only while #withSessionMove holds the BTW gate; false means no successful move. */
	async #relocateSession(resolvedPath: string): Promise<boolean> {
		if (resolvedPath === path.resolve(this.ctx.sessionManager.getCwd())) return false;

		const previousState = this.ctx.sessionManager.captureState();
		try {
			await this.ctx.session.moveSession(resolvedPath);
		} catch (err) {
			this.ctx.showError(M.ccMoveFailedFmt.replace("%s", err instanceof Error ? err.message : String(err)));
			return false;
		}
		let applied = false;
		try {
			applied = await this.ctx.applyCwdChange(resolvedPath);
		} catch (error) {
			await this.#restoreAfterMoveFailure(previousState, error);
			return false;
		}
		if (!applied) {
			await this.#restoreAfterMoveFailure(previousState);
			return false;
		}

		this.ctx.updateEditorBorderColor();
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender();
		return true;
	}

	async handleRenameCommand(title: string): Promise<void> {
		const session = this.ctx.session;
		const sessionManager = this.ctx.sessionManager;
		const sessionId = sessionManager.getSessionId();
		const signal = session.titleGenerationSignal;
		let titleRevision = sessionManager.titleRevision;
		const isCurrent = () =>
			this.ctx.session === session &&
			this.ctx.sessionManager === sessionManager &&
			!signal.aborted &&
			sessionManager.getSessionId() === sessionId &&
			sessionManager.titleRevision === titleRevision;
		try {
			const persistence = sessionManager.setSessionName(title, "user");
			titleRevision = sessionManager.titleRevision;
			const stored = await persistence;
			if (!isCurrent()) return;
			if (!stored) {
				this.ctx.showError(M.ccSessionNameEmpty);
				return;
			}
			const name = sessionManager.getSessionName()!;
			this.ctx.showStatus(M.ccSessionRenamedToFmt.replace("%s", name));
		} catch (err) {
			if (!isCurrent()) return;
			this.ctx.showError(M.ccRenameFailedFmt.replace("%s", err instanceof Error ? err.message : String(err)));
		}
	}

	async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		const shouldPersistCwd = isPersistentShellCdCommand(command);
		if (isDeferred && shouldPersistCwd) {
			this.ctx.showWarning(M.ccWaitForResponseCd);
			return;
		}

		if (shouldPersistCwd) {
			await this.#withSessionMove(() => this.#executeBashCommand(command, excludeFromContext, isDeferred, true));
		} else {
			await this.#executeBashCommand(command, excludeFromContext, isDeferred, false);
		}
	}

	/** Returns whether shell execution committed a cwd relocation, not whether the shell command succeeded. */
	async #executeBashCommand(
		command: string,
		excludeFromContext: boolean,
		isDeferred: boolean,
		shouldPersistCwd: boolean,
	): Promise<boolean> {
		this.ctx.bashComponent = new BashExecutionComponent(command, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
			this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
		} else {
			this.ctx.present(this.ctx.bashComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executeBash(
				command,
				chunk => {
					if (this.ctx.bashComponent) {
						this.ctx.bashComponent.appendOutput(chunk);
					}
				},
				{
					excludeFromContext,
					useUserShell: true,
					// User-shell zsh/fish `!` commands run on a headless PTY; raw
					// bytes render through the component's vterm replay (color-safe).
					pty: {
						...bashPtyViewport(this.ctx.ui),
						onChunk: chunk => this.ctx.bashComponent?.appendPtyChunk(chunk),
					},
				},
			);
			if (this.ctx.bashComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.bashComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
					artifactError: meta?.artifactError,
					images: result.images,
					showImages: this.ctx.settings.get("terminal.showImages"),
				});
			}
			try {
				if (shouldPersistCwd) return await this.#applyBashResultCwd(result);
			} catch (error) {
				this.ctx.showError(
					M.ccBashCwdFailedFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
				);
			}
		} catch (error) {
			if (this.ctx.bashComponent) {
				this.ctx.bashComponent.setComplete(undefined, false);
			}
			this.ctx.showError(M.ccBashFailedFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError));
		} finally {
			this.ctx.bashComponent = undefined;
			this.ctx.ui.requestRender();
		}
		return false;
	}

	async #applyBashResultCwd(result: BashResult): Promise<boolean> {
		if (result.cancelled || result.exitCode !== 0 || !result.workingDir) return false;
		if (!path.isAbsolute(result.workingDir)) return false;

		const resolvedPath = path.resolve(result.workingDir);
		if (resolvedPath === path.resolve(this.ctx.sessionManager.getCwd())) return false;

		let isDirectory = false;
		try {
			isDirectory = (await fs.stat(resolvedPath)).isDirectory();
		} catch {
			isDirectory = false;
		}
		if (!isDirectory) return false;

		return this.#relocateSession(resolvedPath);
	}

	async handlePythonCommand(code: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.pythonComponent = new EvalExecutionComponent(code, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.pythonComponent);
			this.ctx.pendingPythonComponents.push(this.ctx.pythonComponent);
		} else {
			this.ctx.present(this.ctx.pythonComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executePython(
				code,
				chunk => {
					if (this.ctx.pythonComponent) {
						this.ctx.pythonComponent.appendOutput(chunk);
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.pythonComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.pythonComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
					artifactError: meta?.artifactError,
				});
			}
		} catch (error) {
			if (this.ctx.pythonComponent) {
				this.ctx.pythonComponent.setComplete(undefined, false);
			}
			this.ctx.showError(
				M.ccPythonFailedFmt.replace("%s", error instanceof Error ? error.message : M.ccUnknownError),
			);
		}

		this.ctx.pythonComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handleCompactCommand(
		customInstructions?: string,
		mode?: CompactMode,
		beforeFlush?: (outcome: CompactionOutcome) => void | Promise<void>,
		internalGuidance?: string,
	): Promise<CompactionOutcome> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning(M.ccNothingToCompact);
			return "ok";
		}

		// `internalGuidance` is a private summarizer directive (plan-mode
		// "Approve and compact context") that MUST stay off the public
		// `customInstructions` channel of the `session_before_compact` extension
		// hook — extensions treat that field as user focus and would otherwise
		// bias the summary toward the plan boilerplate (issue #4359). Ride it
		// through as a CompactOptions field instead. That caller also dispatches
		// the execution turn itself, so the compaction must not resume the
		// plan-approval turn it aborted.
		if (internalGuidance) {
			return this.executeCompaction(
				{ internalGuidance, suppressContinuation: true, ...(mode ? { mode } : {}) },
				false,
				beforeFlush,
				mode,
			);
		}
		return this.executeCompaction(customInstructions, false, beforeFlush, mode);
	}

	/**
	 * TUI handler for `/shake`. `elide` drops heavy structural content,
	 * `images` strips image blocks, and `thinking` drops all thinking blocks.
	 * Rebuilds the chat and reports counts.
	 */
	async handleShakeCommand(mode: ShakeMode): Promise<void> {
		let result: ShakeResult;
		try {
			result = await this.ctx.session.shake(mode);
		} catch (error) {
			this.ctx.showError(M.ccShakeFailedFmt.replace("%s", error instanceof Error ? error.message : String(error)));
			return;
		}

		const dropped =
			result.toolResultsDropped +
			result.blocksDropped +
			(result.imagesDropped ?? 0) +
			(result.thinkingBlocksDropped ?? 0);
		if (dropped === 0) {
			this.ctx.showStatus(M.ccNothingToShake);
			return;
		}
		this.ctx.rebuildChatFromMessages();
		this.ctx.statusLine.invalidate();
		this.ctx.ui.requestRender();
		this.ctx.showStatus(formatShakeSummary(result));
	}

	async executeCompaction(
		customInstructionsOrOptions?: string | CompactOptions,
		isAuto = false,
		beforeFlush?: (outcome: CompactionOutcome) => void | Promise<void>,
		mode?: CompactMode,
	): Promise<CompactionOutcome> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.disposeChildren();

		const label = isAuto ? M.ccAutoCompactingContext : M.ccCompactingContext;
		const compactingLoader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			label,
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(compactingLoader);
		this.ctx.ui.requestRender();

		let outcome: CompactionOutcome = "ok";
		try {
			const instructions = typeof customInstructionsOrOptions === "string" ? customInstructionsOrOptions : undefined;
			const baseOptions =
				customInstructionsOrOptions && typeof customInstructionsOrOptions === "object"
					? customInstructionsOrOptions
					: undefined;
			// The slash path passes `mode` positionally; the extension path carries
			// it inside the options object. Either source wins over no mode.
			const effectiveMode = mode ?? baseOptions?.mode;
			const options =
				baseOptions || effectiveMode
					? { ...baseOptions, ...(effectiveMode ? { mode: effectiveMode } : {}) }
					: undefined;
			await this.ctx.session.compact(instructions, options);

			compactingLoader.stop();
			this.ctx.statusContainer.disposeChildren();
			this.ctx.rebuildChatFromMessages({ reuseSettledComponents: true });

			this.ctx.statusLine.invalidate();
			// Same as the auto-compaction rebuild: a collapsed transcript is an
			// intentional replacement, so drop the stale pre-compaction scrollback
			// instead of repainting the shrunken frame below it. With collapse
			// disabled the full history stays inline and scrollback is kept.
			if (this.ctx.settings.get("display.collapseCompacted")) {
				this.ctx.ui.requestRender(true, { clearScrollback: true });
			} else {
				this.ctx.ui.requestRender();
			}
		} catch (error) {
			if (error instanceof CompactionCancelledError) {
				outcome = "cancelled";
				this.ctx.showError(M.ccCompactionCancelled);
			} else {
				outcome = "failed";
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.showError(M.ccCompactionFailedFmt.replace("%s", message));
			}
		} finally {
			compactingLoader.stop();
			this.ctx.statusContainer.disposeChildren();
		}
		// Run the caller's pre-flush hook (e.g. the plan-approval model transition)
		// before queued user input is dispatched, so any turn queued during
		// compaction executes on the post-compaction model rather than the model
		// compaction itself ran on.
		if (beforeFlush) await beforeFlush(outcome);
		await this.ctx.flushCompactionQueue({ willRetry: false });
		return outcome;
	}

	async handleHandoffCommand(customInstructions?: string): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning(M.ccWaitForResponseHandoff);
			return;
		}
		if (this.ctx.session.isCompacting) {
			this.ctx.showWarning(M.ccWaitForCompactionHandoff);
			return;
		}

		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning(M.ccNothingToHandoff);
			return;
		}

		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.disposeChildren();

		const handoffLoader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			M.ccGeneratingHandoff,
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(handoffLoader);
		this.ctx.ui.requestRender();

		try {
			// Handoff generation runs as a oneshot request; the document is then
			// committed as a compaction entry on this session.
			const result = await this.ctx.session.handoff(customInstructions);

			if (!result) {
				this.ctx.showError(M.ccHandoffCancelled);
				return;
			}

			// Rebuild chat from the session, which now shows the handoff compaction divider.
			this.ctx.clearTransientSessionUi();
			await this.ctx.renderInitialMessages();
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
			await this.ctx.reloadTodos();

			this.ctx.present([
				new Spacer(1),
				new Text(`${theme.fg("accent", `${theme.status.success} ${M.ccContextHandedOff}`)}`, 1, 1),
			]);
			if (result.savedPath) {
				this.ctx.showStatus(M.ccHandoffSavedFmt.replace("%s", result.savedPath));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// `session.handoff()` normalizes genuine cancellations to this exact message; a
			// provider error (even one named AbortError) is re-thrown verbatim so it surfaces
			// as a real failure instead of a false "cancelled".
			if (message === "Handoff cancelled") {
				this.ctx.showError(M.ccHandoffCancelled);
			} else {
				// Persist the real failure so it is debuggable after the transient
				// TUI error clears (#7993).
				logger.error("Handoff failed", { error: message });
				this.ctx.showError(M.ccHandoffFailedFmt.replace("%s", message));
			}
		} finally {
			this.#finishHandoffUi(handoffLoader);
		}
		this.ctx.ui.requestRender(true, { clearScrollback: true });
	}

	#finishHandoffUi(handoffLoader: Loader): void {
		handoffLoader.stop();
		// A retry/compaction event may replace the handoff overlay while transcript
		// replay yields. Preserve it only while it still owns the status row; a
		// reference to a loader disposed earlier must not retain the handoff overlay.
		const maintenanceLoader = this.ctx.autoCompactionLoader ?? this.ctx.retryLoader;
		if (maintenanceLoader && this.ctx.statusContainer.children.includes(maintenanceLoader)) return;
		this.ctx.statusContainer.disposeChildren();
		// `disposeChildren()` disposed any working loader mounted by a delayed
		// `agent_start` during transcript replay, which stops its animation timer.
		// Drop the now-frozen reference so the reconciler below never reattaches it
		// (`ensureLoadingAnimation()` only re-adds an existing instance, never
		// restarts it).
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		if (this.ctx.session.isStreaming) {
			// A new turn won the race with handoff cleanup; mount a fresh, running
			// loader for it now that the stale reference is cleared.
			this.ctx.ensureLoadingAnimation();
		}
	}
}

const BAR_WIDTH_MAX = 24;
const COLUMN_WIDTH_MIN = 4;

function renderJobLine(job: AsyncJobSnapshotItem, now: number): string {
	const duration = formatDuration(Math.max(0, now - job.startTime));
	const status = formatJobStatus(job.status);
	return `${theme.fg("dim", job.id)} ${theme.fg("dim", `[${job.type}]`)} ${status} ${theme.fg("dim", `(${duration})`)}`;
}

function formatJobStatus(status: AsyncJobSnapshotItem["status"]): string {
	if (status === "running") return theme.fg("warning", M.ccJobStatusRunning);
	if (status === "completed") return theme.fg("success", M.ccJobStatusCompleted);
	if (status === "cancelled") return theme.fg("dim", M.ccJobStatusCancelled);
	return theme.fg("error", M.ccJobStatusFailed);
}

function truncateJobLabel(label: string, maxWidth: number): string {
	if (visibleWidth(label) <= maxWidth) return label;
	if (maxWidth <= 1) return "…";

	let out = "";
	for (const char of label) {
		const next = `${out}${char}`;
		if (visibleWidth(`${next}…`) > maxWidth) break;
		out = next;
	}

	return `${out}…`;
}

function formatNumber(value: number, maxFractionDigits = 1): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(value);
}

function resolveProviderAuthMode(authStorage: AuthStorage, provider: string): string {
	if (authStorage.hasOAuth(provider)) {
		return "oauth";
	}
	if (authStorage.has(provider)) {
		return "api key";
	}
	if (getEnvApiKey(provider)) {
		return "env api key";
	}
	if (authStorage.hasAuth(provider)) {
		return "runtime/fallback";
	}
	return "unknown";
}

export function renderProviderSection(details: ProviderDetails, uiTheme: Pick<Theme, "fg">): string {
	const lines: string[] = [];
	lines.push(`${uiTheme.fg("dim", M.ccLabelName)} ${details.provider}`);
	for (const field of details.fields) {
		lines.push(`${uiTheme.fg("dim", `${field.label}:`)} ${field.value}`);
	}
	return `${lines.join("\n")}\n`;
}

function resolveProviderUsageTotal(reports: UsageReport[]): number {
	return reports
		.flatMap(report => report.limits)
		.map(limit => resolveUsedFraction(limit) ?? 0)
		.reduce((sum, value) => sum + value, 0);
}

function formatWindowSuffix(label: string, windowLabel: string, uiTheme: Theme): string {
	const normalizedLabel = label.toLowerCase();
	const normalizedWindow = windowLabel.toLowerCase();
	if (normalizedWindow === "quota window") return "";
	if (normalizedLabel.includes(normalizedWindow)) return "";
	return uiTheme.fg("dim", `(${windowLabel})`);
}

/** ` (org)` suffix when the report is org-attributed — two subscriptions can share one email. */
function orgSuffix(report: UsageReport): string {
	const orgName = report.metadata?.orgName;
	const orgId = report.metadata?.orgId;
	const org = typeof orgName === "string" && orgName ? orgName : typeof orgId === "string" ? orgId : undefined;
	return org ? ` (${org})` : "";
}

function formatAccountLabel(limit: UsageLimit, report: UsageReport, index: number): string {
	const email = report.metadata?.email;
	if (typeof email === "string" && email) return `${email}${orgSuffix(report)}`;
	const accountId =
		typeof report.metadata?.accountId === "string" && report.metadata.accountId
			? report.metadata.accountId
			: limit.scope.accountId || undefined;
	if (accountId) return `${accountId}${orgSuffix(report)}`;
	const projectId =
		typeof report.metadata?.projectId === "string" && report.metadata.projectId
			? report.metadata.projectId
			: limit.scope.projectId || undefined;
	if (projectId) return projectId;
	return M.ccAccountIndexFmt.replace("%s", String(index + 1));
}

function formatUnlimitedReportLabel(report: UsageReport, index: number): string {
	const email = report.metadata?.email;
	if (typeof email === "string" && email) return `${email}${orgSuffix(report)}`;
	const accountId = report.metadata?.accountId;
	if (typeof accountId === "string" && accountId) return `${accountId}${orgSuffix(report)}`;
	const projectId = report.metadata?.projectId;
	if (typeof projectId === "string" && projectId) return projectId;
	return M.ccAccountIndexFmt.replace("%s", String(index + 1));
}

function formatResetShort(limit: UsageLimit, nowMs: number): string | undefined {
	const resetsAt = limit.window?.resetsAt;
	if (resetsAt === undefined) return undefined;
	// Codex returns the prior window's reset_at until a new request opens a fresh window —
	// rendering a negative delta is meaningless, so drop the suffix in that case.
	if (resetsAt <= nowMs) return undefined;
	return formatDuration(resetsAt - nowMs);
}

function formatAccountHeaderRow(
	limits: UsageLimit[],
	reports: UsageReport[],
	nowMs: number,
	columnWidth: number,
	uiTheme: Theme,
	activeAccount?: OAuthAccountIdentity,
): string[] {
	const parts = limits.map((limit, index) => {
		const reset = formatResetShort(limit, nowMs);
		const report = reports[index];
		const active = report !== undefined && limitMatchesActiveAccount(report, limit, activeAccount);
		const label = formatAccountLabel(limit, report, index);
		return {
			label: active ? `● ${label}` : label,
			suffix: reset ? `(${reset})` : "",
			active,
		};
	});
	const maxSuffixWidth = parts.reduce((max, p) => Math.max(max, visibleWidth(p.suffix)), 0);
	const gap = maxSuffixWidth > 0 ? 1 : 0;
	const prefixBudget = columnWidth - maxSuffixWidth - gap;

	// If suffix can't share the cell with at least `x…`, fall back to whole-label truncation.
	if (prefixBudget < 2) {
		return parts.map(p => {
			const full = p.suffix ? `${p.label} ${p.suffix}` : p.label;
			const cell = padColumn(truncateJobLabel(full, columnWidth), columnWidth);
			return p.active ? uiTheme.fg("accent", cell) : cell;
		});
	}

	return parts.map(p => {
		const prefix = truncateJobLabel(p.label, prefixBudget);
		const prefixCell = prefix + " ".repeat(prefixBudget - visibleWidth(prefix));
		const styledPrefix = p.active ? uiTheme.fg("accent", prefixCell) : prefixCell;
		if (!p.suffix) return styledPrefix + " ".repeat(maxSuffixWidth + gap);
		const suffixPad = " ".repeat(maxSuffixWidth - visibleWidth(p.suffix));
		return `${styledPrefix} ${suffixPad}${uiTheme.fg("dim", p.suffix)}`;
	});
}

function padColumn(text: string, width: number): string {
	const visible = visibleWidth(text);
	if (visible >= width) return text;
	return `${text}${padding(width - visible)}`;
}

type AggregateDisplayStatus = NonNullable<UsageLimit["status"]> | "neutral";

function resolveAggregateStatus(limits: UsageLimit[]): AggregateDisplayStatus {
	const hasOk = limits.some(limit => limit.status === "ok");
	const hasWarning = limits.some(limit => limit.status === "warning");
	const hasExhausted = limits.some(limit => limit.status === "exhausted");
	if (!hasOk && !hasWarning && !hasExhausted) {
		return limits.length > 0 && limits.every(isUsedOnlyAbsoluteAmount) ? "neutral" : "unknown";
	}
	if (hasOk) {
		return hasWarning || hasExhausted ? "warning" : "ok";
	}
	if (hasWarning) return "warning";
	return "exhausted";
}

function formatAggregateAmount(limits: UsageLimit[]): string {
	const fractions = limits
		.map(limit => resolveUsedFraction(limit))
		.filter((value): value is number => value !== undefined);
	if (fractions.length === limits.length && fractions.length > 0) {
		const sum = fractions.reduce((total, value) => total + value, 0);
		const avgRemaining = Math.max(0, ((limits.length - sum) / limits.length) * 100);
		return M.ccFreePctFmt.replace("%s", formatNumber(avgRemaining));
	}

	const amounts = limits
		.map(limit => limit.amount)
		.filter(amount => amount.used !== undefined && amount.limit !== undefined && amount.limit > 0);
	if (amounts.length === limits.length && amounts.length > 0) {
		const totalUsed = amounts.reduce((sum, amount) => sum + (amount.used ?? 0), 0);
		const totalLimit = amounts.reduce((sum, amount) => sum + (amount.limit ?? 0), 0);
		const remainingPct = totalLimit > 0 ? Math.max(0, 100 - (totalUsed / totalLimit) * 100) : 0;
		return M.ccFreePctFmt.replace("%s", formatNumber(remainingPct));
	}

	if (limits.length > 0 && limits.every(isUsedOnlyAbsoluteAmount)) return "";

	// Prepaid balances have no total to divide by. `totalRemainingOnly`
	// collapses account-wide pools seen once per stored key and sums only
	// genuinely distinct ones, so a multi-key provider is never double-counted.
	const remaining = formatRemainingOnlyTotal(limits);
	if (remaining !== undefined) return remaining;

	// Count unique accounts from limit scopes — not limits.length.
	const uniqueAccountIds = new Set(
		limits.map(limit => limit.scope.accountId).filter((id): id is string => typeof id === "string" && id.length > 0),
	);
	if (uniqueAccountIds.size > 0) return M.ccAcctPluralFmt.replace("%s", String(uniqueAccountIds.size));
	// No account IDs available — keep the pre-existing fallback so providers
	// that don't populate scope.accountId still show a summary.
	return M.ccAcctPluralFmt.replace("%s", String(limits.length));
}

function resolveResetRange(limits: UsageLimit[], nowMs: number): string | null {
	const windows = limits
		.map(limit => limit.window)
		.filter(
			(window): window is NonNullable<UsageLimit["window"]> =>
				window?.resetsAt !== undefined && Number.isFinite(window.resetsAt) && window.resetsAt > nowMs,
		);
	if (windows.length === 0) return null;
	// Use the shared verb when every contributing window agrees (e.g. all "tick");
	// mixed or absent labels fall back to the generic "resets".
	const labels = new Set(windows.map(window => window.resetLabel ?? M.ccResetsVerb));
	const verb = labels.size === 1 ? [...labels][0]! : M.ccResetsVerb;
	const offsets = windows.map(window => window.resetsAt! - nowMs);
	const minReset = Math.min(...offsets);
	const maxReset = Math.max(...offsets);
	if (maxReset - minReset > 60_000) {
		return `${verb} ${M.ccResetRangeFmt.replace("%s", `${formatDuration(minReset)}–${formatDuration(maxReset)}`)}`;
	}
	return `${verb} ${M.ccResetRangeFmt.replace("%s", formatDuration(minReset))}`;
}

function resolveStatusIcon(status: AggregateDisplayStatus, uiTheme: Theme): string {
	if (status === "neutral") return uiTheme.fg("dim", uiTheme.status.info);
	if (status === "exhausted") return uiTheme.fg("error", uiTheme.status.error);
	if (status === "warning") return uiTheme.fg("warning", uiTheme.status.warning);
	if (status === "ok") return uiTheme.fg("success", uiTheme.status.success);
	return uiTheme.fg("dim", uiTheme.status.pending);
}

function resolveStatusColor(status: UsageLimit["status"]): "success" | "warning" | "error" | "dim" {
	if (status === "exhausted") return "error";
	if (status === "warning") return "warning";
	if (status === "ok") return "success";
	return "dim";
}

function renderUsageBar(limit: UsageLimit, uiTheme: Theme, barWidth: number): string {
	const usedAmount = limit.amount.used;
	if (usedAmount !== undefined && isUsedOnlyAbsoluteAmount(limit)) {
		const used =
			limit.amount.unit === "usd"
				? `$${usedAmount.toFixed(2)}`
				: `${formatNumber(usedAmount, 2)} ${limit.amount.unit}`;
		return uiTheme.fg("dim", truncateJobLabel(M.ccUsedFmt.replace("%s", used), barWidth));
	}
	const fraction = resolveUsedFraction(limit);
	if (fraction === undefined) {
		return uiTheme.fg("dim", "·".repeat(barWidth));
	}
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const exact = clamped * barWidth;
	const fullCells = Math.floor(exact);
	const remainder = exact - fullCells;
	let partial = "";
	if (remainder >= 2 / 3) partial = "▓";
	else if (remainder >= 1 / 3) partial = "▒";
	const leading = "█".repeat(fullCells) + partial;
	const empty = "░".repeat(Math.max(0, barWidth - fullCells - (partial ? 1 : 0)));
	const color = resolveStatusColor(limit.status);
	return `${uiTheme.fg(color, leading)}${uiTheme.fg("dim", empty)}`;
}

/**
 * Pick a per-account column width so the columns and trailing amount fit in `available`.
 * Falls back to the minimum when the terminal is too narrow rather than wrapping.
 */
function resolveColumnWidth(count: number, available: number, trailing: number): number {
	if (count <= 0) return BAR_WIDTH_MAX;
	const indent = 2;
	const gaps = count - 1;
	const spaceForBars = available - indent - gaps - (trailing > 0 ? trailing + 1 : 0);
	const ideal = Math.floor(spaceForBars / count);
	if (ideal < COLUMN_WIDTH_MIN) return COLUMN_WIDTH_MIN;
	return ideal;
}

export function renderUsageReports(
	reports: UsageReport[],
	uiTheme: Theme,
	nowMs: number,
	availableWidth: number,
	resolveActiveAccount?: (provider: string) => OAuthAccountIdentity | undefined,
	usageModelSelectors: readonly string[] = [],
): string {
	const displayReports = collapseSharedUsageReports(reports);
	const lines: string[] = [];
	const latestFetchedAt = Math.max(...reports.map(report => report.fetchedAt ?? 0));
	const headerSuffix = latestFetchedAt ? M.ccAgoSuffixFmt.replace("%s", formatDuration(nowMs - latestFetchedAt)) : "";
	lines.push(uiTheme.bold(uiTheme.fg("accent", `${M.ccUsageTitle}${headerSuffix}`)));
	const grouped = new Map<string, UsageReport[]>();
	for (const report of displayReports) {
		const list = grouped.get(report.provider) ?? [];
		list.push(report);
		grouped.set(report.provider, list);
	}
	const providerEntries = Array.from(grouped.entries())
		.map(([provider, providerReports]) => ({
			provider,
			providerReports,
			totalUsage: resolveProviderUsageTotal(providerReports),
		}))
		.sort((a, b) => {
			if (a.totalUsage !== b.totalUsage) return a.totalUsage - b.totalUsage;
			return a.provider.localeCompare(b.provider);
		});

	for (const { provider, providerReports } of providerEntries) {
		lines.push("");
		const providerName = formatProviderName(provider);
		const activeAccount = resolveActiveAccount?.(provider);

		const limitGroups = new Map<
			string,
			{ label: string; windowLabel: string; limits: UsageLimit[]; reports: UsageReport[] }
		>();
		for (const report of providerReports) {
			for (const limit of report.limits) {
				const windowId = limit.window?.id ?? limit.scope.windowId ?? "default";
				const key = `${formatLimitTitle(limit)}|${windowId}`;
				const windowLabel = limit.window?.label ?? windowId;
				const entry = limitGroups.get(key) ?? {
					label: formatLimitTitle(limit),
					windowLabel,
					limits: [],
					reports: [],
				};
				entry.limits.push(limit);
				entry.reports.push(report);
				limitGroups.set(key, entry);
			}
		}

		lines.push(uiTheme.bold(uiTheme.fg("accent", providerName)));
		const activeAccountLabel = formatActiveAccountLabel(activeAccount);
		if (activeAccountLabel) {
			lines.push(`  ${uiTheme.fg("accent", M.ccInUseBySession)} ${activeAccountLabel}`);
		}
		const reportingModels = usageModelSelectors.filter(selector => selector.startsWith(`${provider}/`));
		if (reportingModels.length > 0) {
			lines.push(`  ${uiTheme.fg("accent", M.ccModelsWithUsageData)}`);
			for (const selector of reportingModels) {
				lines.push(`    ${replaceTabs(truncateToWidth(sanitizeText(selector), availableWidth - 4))}`);
			}
		}

		// Provider-wide disclaimers (e.g. "OMP-observed spend only") render once
		// above the per-account sections instead of duplicating onto every limit.
		const providerNotes = [...new Set(providerReports.flatMap(report => report.notes ?? []))];
		if (providerNotes.length > 0) {
			lines.push(
				`  ${uiTheme.fg("dim", replaceTabs(truncateToWidth(sanitizeText(providerNotes.map(n => n.replace(/[\r\n]+/g, " ")).join(" • ")), 110)))}`.trimEnd(),
			);
		}

		const resetAccountLines: string[] = [];
		for (const report of providerReports) {
			const resets = summarizeUsageResetCredits(report.resetCredits, nowMs);
			if (!resets || resets.bankedCount <= 0) continue;
			const identityLabel =
				typeof report.metadata?.email === "string" && report.metadata.email
					? report.metadata.email
					: typeof report.metadata?.accountId === "string" && report.metadata.accountId
						? report.metadata.accountId
						: "account";
			const orgLabel =
				typeof report.metadata?.orgName === "string" && report.metadata.orgName
					? report.metadata.orgName
					: typeof report.metadata?.orgId === "string"
						? report.metadata.orgId
						: undefined;
			const rawLabel = orgLabel && orgLabel !== identityLabel ? `${identityLabel} (${orgLabel})` : identityLabel;
			const label = sanitizeText(rawLabel.replace(/[\r\n\t]+/g, " "));
			const activeOrg = activeAccount?.orgId;
			const reportOrg = typeof report.metadata?.orgId === "string" ? report.metadata.orgId : undefined;
			const orgMatches = !activeOrg && !reportOrg ? true : activeOrg === reportOrg;
			const isActive =
				orgMatches &&
				!!activeAccount &&
				((!!activeAccount.accountId && activeAccount.accountId === report.metadata?.accountId) ||
					(!!activeAccount.email && activeAccount.email === report.metadata?.email));
			const availability =
				resets.redeemableCount === resets.bankedCount ? "" : ` · ${resets.redeemableCount} usable now`;
			resetAccountLines.push(
				`    • ${label}: ${resets.bankedCount} saved reset${resets.bankedCount === 1 ? "" : "s"}${availability}${isActive ? " (active)" : ""}`,
			);
			if (resets.soonestExpiry) {
				const expiryMs = Date.parse(resets.soonestExpiry);
				const remaining = expiryMs - nowMs;
				const expiryDate = resets.soonestExpiry.slice(0, 10);
				if (remaining > 0) {
					resetAccountLines.push(`        soonest expires in ${formatDuration(remaining)} (${expiryDate})`);
				} else {
					resetAccountLines.push(`        expired (${expiryDate})`);
				}
			}
			if (resets.redeemableCount === 0 && resets.unavailableReason) {
				const reason = sanitizeText(resets.unavailableReason.replace(/[\r\n\t]+/g, " "));
				resetAccountLines.push(`        unavailable: ${reason}`);
			}
		}
		if (resetAccountLines.length > 0) {
			lines.push(`  ${uiTheme.fg("accent", M.ccSavedRateLimitResets)} ${uiTheme.fg("dim", M.ccUsageResetHint)}`);
			for (const line of resetAccountLines) lines.push(uiTheme.fg("dim", line));
		}

		// Order account columns ONCE per provider (worst-first), then apply that
		// same order to every window group. Sorting each group independently by
		// its own used fraction (issue #6067) desynchronized the columns: an
		// account exhausted on its 5h window but light on the weekly window would
		// land in different column positions on each row, so the positional
		// `account N` labels denoted different credentials per row and an
		// exhausted limit appeared under a sibling that still had quota.
		const accountRank = new Map<UsageReport, number>();
		providerReports.forEach((report, position) => {
			const worst = report.limits.reduce((max, limit) => {
				const fraction = resolveUsedFraction(limit) ?? -1;
				return fraction > max ? fraction : max;
			}, -1);
			// Encode worst-first primary key with the stable position as tiebreak
			// so accounts tied on pressure keep their discovery order.
			accountRank.set(report, -worst * 1000 + position);
		});

		const renderableGroups = Array.from(limitGroups.values()).map(group => {
			const entries = group.limits.map((limit, index) => ({
				limit,
				report: group.reports[index],
				index,
			}));
			entries.sort((a, b) => {
				const aRank = accountRank.get(a.report) ?? a.index;
				const bRank = accountRank.get(b.report) ?? b.index;
				if (aRank !== bRank) return aRank - bRank;
				return a.index - b.index;
			});
			const sortedLimits = entries.map(entry => entry.limit);
			const sortedReports = entries.map(entry => entry.report);
			return { group, sortedLimits, sortedReports, amountText: formatAggregateAmount(sortedLimits) };
		});

		const sectionCount = renderableGroups.reduce((max, g) => Math.max(max, g.sortedLimits.length), 0);
		const sectionTrailing = renderableGroups.reduce((max, g) => Math.max(max, visibleWidth(g.amountText)), 0);
		const sectionColumnWidth = resolveColumnWidth(sectionCount, availableWidth, sectionTrailing);
		const sectionBarWidth = Math.min(sectionColumnWidth, BAR_WIDTH_MAX);

		for (const { group, sortedLimits, sortedReports, amountText } of renderableGroups) {
			const status = resolveAggregateStatus(sortedLimits);
			const statusIcon = resolveStatusIcon(status, uiTheme);

			const windowSuffix = formatWindowSuffix(group.label, group.windowLabel, uiTheme);
			lines.push(`${statusIcon} ${uiTheme.bold(group.label)} ${windowSuffix}`.trim());
			const accountLabels = formatAccountHeaderRow(
				sortedLimits,
				sortedReports,
				nowMs,
				sectionColumnWidth,
				uiTheme,
				activeAccount,
			);
			lines.push(`  ${accountLabels.join(" ")}`.trimEnd());
			const bars = sortedLimits.map(limit =>
				padColumn(renderUsageBar(limit, uiTheme, sectionBarWidth), sectionColumnWidth),
			);
			lines.push(`  ${bars.join(" ")} ${amountText}`.trimEnd());
			const resetText = sortedLimits.length <= 1 ? resolveResetRange(sortedLimits, nowMs) : null;
			if (resetText) {
				lines.push(`  ${uiTheme.fg("dim", resetText)}`.trimEnd());
			}
			const notes = [...new Set(sortedLimits.flatMap(limit => limit.notes ?? []))];
			if (notes.length > 0) {
				lines.push(
					`  ${uiTheme.fg("dim", replaceTabs(truncateToWidth(sanitizeText(notes.map(n => n.replace(/[\r\n]+/g, " ")).join(" • ")), 110)))}`.trimEnd(),
				);
			}
		}

		// Render accounts with no rate limits (e.g. business/enterprise plans).
		const unlimitedReports = providerReports.filter(report => report.limits.length === 0);
		for (const report of unlimitedReports) {
			const label = formatUnlimitedReportLabel(report, 0);
			const tier = report.metadata?.planType;
			const tierSuffix = typeof tier === "string" && tier ? ` ${uiTheme.fg("dim", `(${tier})`)}` : "";
			lines.push(
				`${uiTheme.fg("success", uiTheme.status.success)} ${label}${tierSuffix} ${uiTheme.fg("dim", M.ccNoLimitsLabel)}`,
			);
		}
		// No per-provider footer; global header shows last check.
	}

	return lines.join("\n");
}
