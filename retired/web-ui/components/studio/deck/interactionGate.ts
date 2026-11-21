/**
 * Ported from OMP Studio (MIT) `deck/interactionGate.ts`.
 *
 * Composer `gated` (busy / snapshotReady / executionMatches / can()) is the
 * wrong lock for a card that is already on screen: those flags flicker while a
 * session, capability manifest or worker bind catches up, so the ask appears
 * with dead buttons and then unlocks with no click. A *visible* pending
 * interaction is answerable unless the runtime truly cannot take the answer —
 * which on this surface means "disconnected" or "resyncing".
 */
export function interactionDeckDisabled(input: {
	readonly resyncRequired: boolean;
	readonly runtimeConnected: boolean;
}): boolean {
	return input.resyncRequired || !input.runtimeConnected;
}
