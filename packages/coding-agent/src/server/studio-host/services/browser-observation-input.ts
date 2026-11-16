import type { BrowserObservationInput } from "../protocol/contracts/browser-observation.js";

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some(key => !keys.includes(key))
	)
		throw new Error("Invalid browser observation payload");
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 4096): asserts value is string {
	if (typeof value !== "string" || value.length > max || value.includes("\0"))
		throw new Error("Invalid browser observation text");
}
function number(value: unknown, min: number, max: number): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
		throw new Error("Invalid browser observation number");
}

/** Untrusted private-socket input; public protocol contracts contain types only. */
export function parseBrowserObservationInput(value: unknown): BrowserObservationInput {
	const row = object(value, [
		"kind",
		"sequence",
		"url",
		"x",
		"y",
		"button",
		"deltaX",
		"deltaY",
		"key",
		"code",
		"modifiers",
		"text",
	]);
	const keys: Record<string, string[]> = {
		ping: [],
		take: [],
		release: [],
		ack: ["sequence"],
		navigate: ["url"],
		click: ["sequence", "x", "y", "button"],
		wheel: ["sequence", "x", "y", "deltaX", "deltaY"],
		key: ["sequence", "key", "code", "modifiers"],
		text: ["sequence", "text"],
	};
	if (typeof row.kind !== "string" || !Object.hasOwn(keys, row.kind)) throw new Error("Unknown browser action");
	object(row, ["kind", ...keys[row.kind]!]);
	if (keys[row.kind]!.includes("sequence")) {
		number(row.sequence, 1, Number.MAX_SAFE_INTEGER);
		if (!Number.isSafeInteger(row.sequence)) throw new Error("Invalid browser frame sequence");
	}
	if (row.kind === "navigate") {
		text(row.url);
		const url = new URL(row.url);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
			throw new Error("Browser navigation requires an HTTP(S) URL without embedded credentials");
	}
	if (row.kind === "click" || row.kind === "wheel") {
		number(row.x, 0, 1);
		number(row.y, 0, 1);
	}
	if (row.kind === "click" && row.button !== "left" && row.button !== "right") throw new Error("Invalid mouse button");
	if (row.kind === "wheel") {
		number(row.deltaX, -2048, 2048);
		number(row.deltaY, -2048, 2048);
	}
	if (row.kind === "key") {
		text(row.key, 64);
		text(row.code, 64);
		number(row.modifiers, 0, 15);
		if (!Number.isInteger(row.modifiers)) throw new Error("Invalid keyboard modifiers");
	}
	if (row.kind === "text") text(row.text, 16384);
	return row as BrowserObservationInput;
}
