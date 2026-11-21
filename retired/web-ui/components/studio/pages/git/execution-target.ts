"use client";

/**
 * Studio's `useExecutionTarget()` shim.
 *
 * The original hook reports the Execution Target (local / SSH host) the panel
 * is bound to and bumps `syncRevision` when the target switches, which made
 * every data hook re-read. Zeta has no SSH execution targets in this
 * migration, so there is exactly one target: the selected workspace, and the
 * revision never changes.
 */

const LOCAL_TARGET = "local";

export function useExecutionTarget(): { target: string; syncRevision: number } {
	return { target: LOCAL_TARGET, syncRevision: 0 };
}
