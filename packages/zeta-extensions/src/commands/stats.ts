// /stats /usage /token: session and context statistics (pi extension API equivalents of omp usage/stats/token commands)
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface SessionStats {
	entries: number;
	userMessages: number;
	assistantMessages: number;
	toolResults: number;
	firstTs: number | undefined;
	lastTs: number | undefined;
}

function computeStats(ctx: ExtensionCommandContext): SessionStats {
	const entries = ctx.sessionManager.getEntries();
	const stats: SessionStats = {
		entries: entries.length,
		userMessages: 0,
		assistantMessages: 0,
		toolResults: 0,
		firstTs: undefined,
		lastTs: undefined,
	};
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const ts = Date.parse(entry.timestamp);
		if (!Number.isNaN(ts)) {
			if (stats.firstTs === undefined || ts < stats.firstTs) stats.firstTs = ts;
			if (stats.lastTs === undefined || ts > stats.lastTs) stats.lastTs = ts;
		}
		const role = entry.message?.role;
		if (role === "user") stats.userMessages += 1;
		else if (role === "assistant") stats.assistantMessages += 1;
		else if (role === "toolResult") stats.toolResults += 1;
	}
	return stats;
}

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function installStats(api: ExtensionAPI): void {
	api.registerCommand("stats", {
		description: "Show session statistics",
		handler: async (_args, ctx) => {
			const s = computeStats(ctx);
			const lines = [
				`Entries: ${s.entries}`,
				`User messages: ${s.userMessages}`,
				`Assistant messages: ${s.assistantMessages}`,
				`Tool results: ${s.toolResults}`,
			];
			if (s.firstTs !== undefined && s.lastTs !== undefined) {
				lines.push(`Session duration: ${formatDuration(s.lastTs - s.firstTs)}`);
			}
			void api.sendMessage({ customType: "zeta-stats", content: lines.join("\n"), display: true });
		},
	});

	api.registerCommand("usage", {
		description: "Show current context usage",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens === null) {
				ctx.ui.notify("Context usage unknown right now.", "info");
				return;
			}
			const percent = usage.percent !== null ? usage.percent.toFixed(1) : "?";
			ctx.ui.notify(
				`Context: ${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens (${percent}%)`,
				"info",
			);
		},
	});

	api.registerCommand("token", {
		description: "Show current context token count",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens === null) {
				ctx.ui.notify("Token count unknown right now.", "info");
				return;
			}
			ctx.ui.notify(`Tokens: ${usage.tokens.toLocaleString()}`, "info");
		},
	});
}
