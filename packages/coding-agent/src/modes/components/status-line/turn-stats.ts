/**
 * Per-turn telemetry (TTFT / TPS / duration / tokens / cost) extracted from the
 * trailing assistant message. Shared by the `turn_stats` status-line segment
 * and the transient post-turn line in the event controller, so both surfaces
 * render identical numbers from one code path.
 */
import type { AgentMessage } from "@linxiraos/pi-agent-core";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { formatNumber } from "@linxiraos/pi-utils";
import { theme } from "../../../modes/theme/theme";

export interface TurnStats {
	/** Time to first token in milliseconds. */
	ttftMs: number;
	/** Total request duration in milliseconds. */
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	costTotal: number;
	/** Output tokens per second over the full request duration (bench-cli semantics). */
	tokensPerSecond: number;
}

/**
 * Telemetry for the most recent completed assistant turn, or `null` when the
 * message tail does not end in a billed assistant run (fresh session, new turn
 * still open, or a provider that stamped no measurable output).
 */
export function extractLastTurnStats(messages: readonly AgentMessage[]): TurnStats | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role === "user") return null;
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage;
		const outputTokens = Number.isFinite(assistant.usage?.output) ? Math.max(0, assistant.usage!.output) : 0;
		const durationMs = Number.isFinite(assistant.duration) && assistant.duration! > 0 ? assistant.duration! : 0;
		if (outputTokens <= 0 || durationMs <= 0) return null;
		return {
			ttftMs: Number.isFinite(assistant.ttft) && assistant.ttft! > 0 ? assistant.ttft! : 0,
			durationMs,
			inputTokens: Number.isFinite(assistant.usage?.input) ? Math.max(0, assistant.usage!.input) : 0,
			outputTokens,
			costTotal: assistant.usage?.cost?.total ?? 0,
			tokensPerSecond: (outputTokens * 1000) / durationMs,
		};
	}
	return null;
}

/** `⚡42.5/s ⇄1.2s ⏱29.7s ⤵567 ⤴1.2K $0.08` — unstyled; callers apply color. */
export function formatTurnStats(stats: TurnStats): string {
	const parts: string[] = [];
	parts.push(withIcon(theme.icon.throughput, `${stats.tokensPerSecond.toFixed(1)}/s`));
	parts.push(`⇄${(stats.ttftMs / 1000).toFixed(1)}s`);
	parts.push(withIcon(theme.icon.time, `${(stats.durationMs / 1000).toFixed(1)}s`));
	parts.push(`${theme.icon.input}${formatNumber(stats.inputTokens)}`);
	parts.push(`${theme.icon.output}${formatNumber(stats.outputTokens)}`);
	parts.push(`$${stats.costTotal.toFixed(2)}`);
	return parts.join(" ");
}

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}
