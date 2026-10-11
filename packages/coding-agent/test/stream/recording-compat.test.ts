import { describe, expect, it } from "bun:test";
import { parseRecording, RECORDING_EXTENSION, RECORDING_VERSION } from "@linxiraos/zeta/stream/recording";

/**
 * Upgrade contract for the `.ompcast` -> `.zetacast` rename.
 *
 * Recordings live in the user's own data directory, so an in-place upgrade must
 * not orphan files written by the previous install. These cases pin the
 * read-old/write-new behaviour; the legacy header key and extension are the
 * only places the old spelling is allowed to survive.
 */
const HEADER = {
	cols: 120,
	rows: 40,
	title: "session",
	createdAt: "2026-09-22T10:00:00.000Z",
};
// `resize` is the one frame variant with no payload requirements, so it is the
// cheapest way to exercise the parser without dragging in the whole frame model.
const EVENT = [0, { t: "resize", rows: 40, cols: 120 }];

describe("recording format compatibility", () => {
	it("writes and reads the canonical header key", () => {
		const parsed = parseRecording(
			`${JSON.stringify({ zetacast: RECORDING_VERSION, ...HEADER })}\n${JSON.stringify(EVENT)}\n`,
		);
		expect(parsed.header.zetacast).toBe(RECORDING_VERSION);
		expect(parsed.events).toHaveLength(1);
	});

	it("still reads a recording written with the pre-rename header key", () => {
		const legacy = JSON.stringify({ ompcast: RECORDING_VERSION, ...HEADER });
		const parsed = parseRecording(`${legacy}\n${JSON.stringify(EVENT)}\n`);
		// Normalized to the canonical field so downstream never sees two shapes.
		expect(parsed.header.zetacast).toBe(RECORDING_VERSION);
		expect(parsed.events).toHaveLength(1);
	});

	it("reports an unsupported legacy version instead of guessing", () => {
		const legacy = JSON.stringify({ ompcast: 99, ...HEADER });
		expect(() => parseRecording(`${legacy}\n${JSON.stringify(EVENT)}\n`)).toThrow(/unsupported recording version 99/);
	});

	it("rejects a file that is not a recording at all", () => {
		expect(() => parseRecording(`${JSON.stringify({ cols: 1 })}\n`)).toThrow(/not a recording/);
	});

	it("uses the new extension for newly written files", () => {
		expect(RECORDING_EXTENSION).toBe(".zetacast");
	});
});
