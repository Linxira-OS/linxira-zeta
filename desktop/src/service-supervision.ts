/**
 * Supervision policy for the embedded Zeta service process.
 *
 * Pure decision logic (no Electron imports) so it stays unit-testable —
 * same pattern as session-monitor.ts. The desktop shell uses these to decide
 * whether an unexpected service exit should be retried or surfaced as a
 * fatal failure.
 */

/** How many times an unexpectedly-exited service is restarted before giving up. */
export const SERVICE_MAX_RESTARTS = 1;

/**
 * Whether the service should be restarted after an unexpected exit.
 *
 * Any exit while the shell is not quitting is unexpected (the service is
 * owned for the app's whole lifetime), so the budget — not the exit code —
 * decides. A clean `exit 0` outside shutdown is treated the same as a crash:
 * silently accepting it would leave the window alive against a dead backend.
 */
export function shouldRestartServe(restartsUsed: number): boolean {
	return restartsUsed < SERVICE_MAX_RESTARTS;
}
