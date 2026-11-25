import { readLines } from "@linxiraos/pi-utils";

/**
 * Claims Bun's singleton stdin reader immediately and exposes a separately readable stream.
 * RPC startup uses this before extension discovery so in-process modules cannot steal protocol input.
 */
let claimedInput: ReadableStream<Uint8Array> | undefined;

export function claimRpcInput(): ReadableStream<Uint8Array> {
	// Bun exposes one stdin stream per process; a protocol host may be started
	// more than once in-process (tests, embedded launchers). Reuse the claim
	// instead of locking the singleton twice.
	if (claimedInput) return claimedInput;
	const reader = Bun.stdin.stream().getReader();
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		try {
			reader.releaseLock();
		} catch {}
	};
	claimedInput = new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					release();
					controller.close();
				} else {
					controller.enqueue(result.value);
				}
			} catch (error) {
				release();
				controller.error(error);
			}
		},
		async cancel() {
			try {
				await reader.cancel();
			} finally {
				release();
			}
		},
	});
	return claimedInput;
}

/**
 * Parses newline-delimited RPC input without letting one malformed line stop
 * subsequent protocol frames.
 */
export async function readRpcInputFrames(
	input: ReadableStream<Uint8Array>,
	onFrame: (frame: unknown) => void,
	onParseError: (message: string) => void,
): Promise<void> {
	const decoder = new TextDecoder();
	for await (const line of readLines(input)) {
		const text = decoder.decode(line).trim();
		if (!text) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			onParseError(`Failed to parse command: ${message}`);
			continue;
		}
		onFrame(parsed);
	}
}
