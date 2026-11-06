/**
 * Studio wire protocol identity. The renderer and the host are separate copies
 * of the contract; the frame header is what actually proves they speak the same
 * protocol, so it must round-trip and must refuse an upstream Studio header
 * (an old/foreign client cannot be mistaken for a Zeta one).
 */

import { describe, expect, test } from "bun:test";
import { encodeFrame, FrameCodecError, FrameDecoder } from "../src/server/studio-host/protocol/frame-codec";

const RUNTIME_EPOCH = 7 as never;

function decodeOne(frame: Buffer) {
	const decoder = new FrameDecoder();
	return decoder.push(frame);
}

describe("studio wire protocol", () => {
	test("round-trips a frame with the Zeta protocol name", () => {
		const frames = decodeOne(encodeFrame("frame-1", RUNTIME_EPOCH, { hello: "zeta" }));
		expect(frames).toHaveLength(1);
		expect(frames[0]?.header.protocol).toBe("zeta-studio");
		expect(frames[0]?.body).toEqual({ hello: "zeta" });
	});

	test("rejects a header carrying the upstream protocol name", () => {
		const frame = encodeFrame("frame-2", RUNTIME_EPOCH, {});
		const headerStart = 8;
		const headerLength = frame.readUInt32BE(4);
		const header = JSON.parse(frame.subarray(headerStart, headerStart + headerLength).toString("utf8")) as {
			protocol: string;
		};
		header.protocol = "omp-studio";
		const forged = Buffer.from(JSON.stringify(header), "utf8");
		const prefix = Buffer.from(frame.subarray(0, headerStart));
		const body = Buffer.from(frame.subarray(headerStart + headerLength));
		prefix.writeUInt32BE(4 + forged.byteLength + body.byteLength, 0);
		prefix.writeUInt32BE(forged.byteLength, 4);

		expect(() => decodeOne(Buffer.concat([prefix, forged, body]))).toThrow(FrameCodecError);
	});
});
