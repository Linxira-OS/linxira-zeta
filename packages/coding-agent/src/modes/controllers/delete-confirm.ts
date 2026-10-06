/**
 * `/delete` triple-press confirmation state (TUI).
 *
 * Press 1 arms the delete, press 2 escalates the warning, press 3 within the
 * window executes. The window is measured from the first press; timeout, Esc,
 * or any other submission disarms. The state lives purely in module memory —
 * a restart always starts disarmed, by design.
 */
export const DELETE_CONFIRM_WINDOW_MS = 15_000;

/** Outcome of one `/delete` press. `confirm` also disarms (the delete runs). */
export type DeleteConfirmPhase = "first" | "second" | "confirm";

let armedAt = 0;
let presses = 0;

/**
 * Record one `/delete` press and report what it should do:
 *  - `"first"` — arm and show the initial hint
 *  - `"second"` — show the stronger warning
 *  - `"confirm"` — the third press inside the window; state is reset so a
 *    later `/delete` starts a fresh arm cycle
 */
export function noteDeleteAttempt(now: number = Date.now()): DeleteConfirmPhase {
	if (armedAt <= 0 || now - armedAt > DELETE_CONFIRM_WINDOW_MS) {
		armedAt = now;
		presses = 1;
		return "first";
	}
	presses += 1;
	if (presses >= 3) {
		disarmDeleteConfirm();
		return "confirm";
	}
	return "second";
}

/** Disarm the pending delete (other submissions, Esc). */
export function disarmDeleteConfirm(): void {
	armedAt = 0;
	presses = 0;
}

/** Whether a delete is currently armed inside the confirmation window. */
export function deleteConfirmArmed(now: number = Date.now()): boolean {
	return armedAt > 0 && now - armedAt <= DELETE_CONFIRM_WINDOW_MS;
}

/** Reset module state between tests. @internal */
export function resetDeleteConfirmForTest(): void {
	disarmDeleteConfirm();
}
