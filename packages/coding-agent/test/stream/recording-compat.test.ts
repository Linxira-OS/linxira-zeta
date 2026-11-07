import { describe, expect, it } from "bun:test";
import { parseRecording, RECORDING_EXTENSION, RECORDING_VERSION } from "@linxiraos/zeta/stream/recording";

/**
 * Recording format contract after the `.ompcast` -> `.zetacast` rename.
 *
 * The pre-rename header key and extension are no longer read: recordings are
 * stored in temporary storage and only files written by this build are
 * accepted. New files always carry the canonical header and extension.
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

describe("recording format", () => {
	it("writes and reads the canonical header key", () => {
		const parsed = parseRecording(
			`${JSON.stringify({ zetacast: RECORDING_VERSION, ...HEADER })}\n${JSON.stringify(EVENT)}\n`,
		);
		expect(parsed.header.zetacast).toBe(RECORDING_VERSION);
		expect(parsed.events).toHaveLength(1);
	});

	it("rejects a recording written with the pre-rename header key", () => {
		const legacy = JSON.stringify({ ompcast: RECORDING_VERSION, ...HEADER });
		expect(() => parseRecording(`${legacy}\n${JSON.stringify(EVENT)}\n`)).toThrow(/not a recording/);
	});

	it("rejects a file that is not a recording at all", () => {
		expect(() => parseRecording(`${JSON.stringify({ cols: 1 })}\n`)).toThrow(/not a recording/);
	});

	it("uses the new extension for newly written files", () => {
		expect(RECORDING_EXTENSION).toBe(".zetacast");
	});
});
