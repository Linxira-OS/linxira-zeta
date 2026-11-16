import type { PredictionInput } from "../protocol/contracts/prediction-channel";

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
		throw new Error("Invalid prediction fields");
	return value as Record<string, unknown>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
		throw new Error("Invalid prediction number");
}
function text(value: unknown): asserts value is string {
	if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) throw new Error("Invalid prediction text");
}
function identifier(value: unknown): asserts value is string {
	if (typeof value !== "string" || !/^[a-f0-9-]{36}$/u.test(value)) throw new Error("Invalid prediction identity");
}
/** Private editor socket input, independent of the authenticated HTTP operation boundary. */
export function parsePredictionInput(value: unknown): PredictionInput {
	const row = record(value, ["kind", "revision", "empty", "text", "caret", "accepted", "rank", "requestId", "transferId"]);
	switch (row.kind) {
		case "ping":
			record(row, ["kind"]);
			return { kind: row.kind };
		case "next":
			record(row, ["kind", "revision", "empty", "text"]);
			integer(row.revision);
			if (typeof row.empty !== "boolean") throw new Error("Invalid next-message state");
			if (row.text !== undefined) {
				text(row.text);
				if (row.empty !== (row.text.trimEnd() === "")) throw new Error("Prediction draft state changed");
			}
			return { kind: row.kind, revision: row.revision, empty: row.empty, ...(row.text === undefined ? {} : { text: row.text }) };
		case "next.shown":
			record(row, ["kind", "revision"]);
			integer(row.revision);
			return { kind: row.kind, revision: row.revision };
		case "next.accepted":
			record(row, ["kind", "revision", "rank"]);
			integer(row.revision);
			integer(row.rank, 3);
			return { kind: row.kind, revision: row.revision, rank: row.rank };
		case "update":
			record(row, ["kind", "revision", "text", "caret"]);
			integer(row.revision);
			text(row.text);
			integer(row.caret, row.text.length);
			return { kind: row.kind, revision: row.revision, text: row.text, caret: row.caret };
		case "feedback":
			record(row, ["kind", "revision", "accepted"]);
			integer(row.revision);
			if (typeof row.accepted !== "boolean") throw new Error("Invalid prediction feedback");
			return { kind: row.kind, revision: row.revision, accepted: row.accepted };
		case "import":
			record(row, ["kind", "requestId", "transferId"]);
			identifier(row.requestId);
			identifier(row.transferId);
			return { kind: row.kind, requestId: row.requestId, transferId: row.transferId };
		default:
			throw new Error("Invalid prediction message");
	}
}
