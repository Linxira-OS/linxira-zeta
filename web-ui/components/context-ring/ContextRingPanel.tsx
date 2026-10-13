"use client";

import { ContextRingPanelChrome } from "./ContextRingView";
import { useContextReport } from "./useContextReport";
import "./ContextRing.css";

export interface ContextRingPanelProps {
	/** Agent session to report on; null renders the empty state. */
	sessionId: string | null;
	/**
	 * Live occupancy from the agent state stream. Only used for the first paint
	 * after a model switch, before the report arrives.
	 */
	contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
	/** Whether the agent session is live; gates polling. */
	running?: boolean;
	/** Poll cadence in ms while the document is visible (default 2500). */
	pollMs?: number;
	className?: string;
}

/**
 * Right-dock context-statistics panel: the session's context-window ring, its
 * category composition, the auto-compaction threshold, and the session's
 * cumulative token/call counters.
 *
 * Data comes from `GET /api/agent/<id>/context`
 * (`packages/coding-agent/src/server/web-gateway/context-usage.ts`), which
 * projects the session's own accounting — token anchoring, category split and
 * compaction thresholds all come from the runtime, not from this component.
 * Registration into the dock registry is the shell's job: see
 * `panel-entry.tsx` for the descriptor and icon.
 */
export function ContextRingPanel({
	sessionId,
	contextUsage,
	running = true,
	pollMs,
	className,
}: ContextRingPanelProps) {
	const { report, loading, error } = useContextReport({ sessionId, enabled: running, pollMs });
	return (
		<ContextRingPanelChrome
			sessionId={sessionId}
			report={report}
			loading={loading}
			error={error}
			running={running}
			livePercent={contextUsage?.percent ?? null}
			className={className}
		/>
	);
}
