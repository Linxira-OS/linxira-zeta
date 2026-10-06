import { describe, expect, test } from "bun:test";
import {
	DELETE_CONFIRM_WINDOW_MS,
	deleteConfirmArmed,
	disarmDeleteConfirm,
	noteDeleteAttempt,
	resetDeleteConfirmForTest,
} from "@linxiraos/zeta/modes/controllers/delete-confirm";

describe("delete-confirm", () => {
	test("three presses inside the window arm, escalate, then confirm", () => {
		resetDeleteConfirmForTest();
		const t0 = 1_000_000;
		expect(noteDeleteAttempt(t0)).toBe("first");
		expect(noteDeleteAttempt(t0 + 1_000)).toBe("second");
		expect(noteDeleteAttempt(t0 + 2_000)).toBe("confirm");
		// Confirm consumes the armed state: a fresh press starts over.
		expect(noteDeleteAttempt(t0 + 3_000)).toBe("first");
	});

	test("timeout after the first press rearms from press one", () => {
		resetDeleteConfirmForTest();
		const t0 = 2_000_000;
		expect(noteDeleteAttempt(t0)).toBe("first");
		expect(noteDeleteAttempt(t0 + DELETE_CONFIRM_WINDOW_MS - 1)).toBe("second");
		// Strictly past the window: the third press counts as a new first.
		expect(noteDeleteAttempt(t0 + DELETE_CONFIRM_WINDOW_MS + 1)).toBe("first");
	});

	test("window is measured from the first press, not the second", () => {
		resetDeleteConfirmForTest();
		const t0 = 3_000_000;
		expect(noteDeleteAttempt(t0)).toBe("first");
		expect(noteDeleteAttempt(t0 + DELETE_CONFIRM_WINDOW_MS - 2)).toBe("second");
		// Third press at (first + window - 1): still inside the original window.
		expect(noteDeleteAttempt(t0 + DELETE_CONFIRM_WINDOW_MS - 1)).toBe("confirm");
	});

	test("disarm resets the cycle and armed flag", () => {
		resetDeleteConfirmForTest();
		const t0 = 4_000_000;
		expect(noteDeleteAttempt(t0)).toBe("first");
		expect(deleteConfirmArmed(t0 + 1_000)).toBe(true);
		disarmDeleteConfirm();
		expect(deleteConfirmArmed(t0 + 1_000)).toBe(false);
		expect(noteDeleteAttempt(t0 + 2_000)).toBe("first");
	});

	test("expiry disarms: flag turns false past the window", () => {
		resetDeleteConfirmForTest();
		const t0 = 5_000_000;
		expect(noteDeleteAttempt(t0)).toBe("first");
		expect(deleteConfirmArmed(t0 + DELETE_CONFIRM_WINDOW_MS)).toBe(true);
		expect(deleteConfirmArmed(t0 + DELETE_CONFIRM_WINDOW_MS + 1)).toBe(false);
	});
});
