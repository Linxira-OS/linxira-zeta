/**
 * Live compaction-phase label shared by the two TUI loaders.
 *
 * The auto loader (event-controller) and the `/compact` loader
 * (command-controller) are separate widgets, but both must show the granular
 * phase of the pass that is running. This module is the one place that maps a
 * `compaction_phase` event to a short label; each loader reads it inside its
 * working-row closure, and the event consumer requests a render after updating.
 *
 * Terminal phases map to `undefined`: the end handlers own the final text.
 */

import { compactionProgressOf, type CompactionPhaseEvent } from "../../session/compaction-contract";

let label: string | undefined;

/** Short label for a phase event, or undefined when the pass is finishing. */
export function formatCompactionPhase(event: CompactionPhaseEvent): string | undefined {
	const progress = compactionProgressOf(event);
	return progress.stage === "failed" || progress.stage === "aborted" ? undefined : progress.label;
}

/** Update the label loaders render next to their spinner. */
export function setCompactionPhaseLabel(value: string | undefined): void {
	label = value;
}

/** Label suffix for a loader row (` · summarizing`), empty when idle. */
export function compactionPhaseSuffix(): string {
	return label ? ` · ${label}` : "";
}
