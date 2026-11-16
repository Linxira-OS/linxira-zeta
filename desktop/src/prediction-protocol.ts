// Desktop's private socket boundary; public contract types mirror Studio v0.2.1.
export type PredictionInput =
	| { kind: "next"; revision: number; empty: boolean; text?: string }
	| { kind: "next.shown"; revision: number }
	| { kind: "next.accepted"; revision: number; rank: number }
	| { kind: "update"; revision: number; text: string; caret: number }
	| { kind: "feedback"; revision: number; accepted: boolean }
	| { kind: "ping" }
	| { kind: "import"; requestId: string; transferId: string };
export type PredictionEvent =
	| { kind: "next"; channelId: string; revision: number; suffix: string | null; choices?: readonly string[]; rank?: number }
	| { kind: "suggestion"; channelId: string; revision: number; suffix: string | null }
	| { kind: "error"; channelId: string; message: string; requestId?: string }
	| { kind: "closed"; channelId: string }
	| { kind: "imported"; channelId: string; requestId: string; count: number; truncated: boolean };
export interface PredictionChannel { channelId: string; sessionId: string; expiresAt: number; protocolVersion?: 2 }
export const PREDICTION_CHANNELS = {
	attach: "zeta-studio:desktop:prediction-attach",
	input: "zeta-studio:desktop:prediction-input",
	detach: "zeta-studio:desktop:prediction-detach",
	import: "zeta-studio:desktop:prediction-import",
	event: "zeta-studio:desktop:prediction-event",
} as const;
export interface PredictionResult { ok: boolean; cancelled?: boolean; message?: string; count?: number; truncated?: boolean }

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error("Invalid prediction fields");
	return value as Record<string, unknown>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error("Invalid prediction number");
}
function text(value: unknown, max: number): asserts value is string {
	if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("Invalid prediction text");
}
function identifier(value: unknown): asserts value is string {
	if (typeof value !== "string" || !/^[a-f0-9-]{36}$/u.test(value)) throw new Error("Invalid prediction identity");
}
export function parsePredictionInput(value: unknown): PredictionInput {
	const row = record(value, ["kind", "revision", "empty", "text", "caret", "accepted", "rank", "requestId", "transferId"]);
	switch (row.kind) {
		case "ping": record(row, ["kind"]); return { kind: row.kind };
		case "next":
			record(row, ["kind", "revision", "empty", "text"]); integer(row.revision);
			if (typeof row.empty !== "boolean") throw new Error("Invalid next-message state");
			if (row.text !== undefined) { text(row.text, 4096); if (row.empty !== (row.text.trimEnd() === "")) throw new Error("Prediction draft state changed"); }
			return { kind: row.kind, revision: row.revision, empty: row.empty, ...(row.text === undefined ? {} : { text: row.text }) };
		case "next.shown": record(row, ["kind", "revision"]); integer(row.revision); return { kind: row.kind, revision: row.revision };
		case "next.accepted": record(row, ["kind", "revision", "rank"]); integer(row.revision); integer(row.rank, 3); return { kind: row.kind, revision: row.revision, rank: row.rank };
		case "update": record(row, ["kind", "revision", "text", "caret"]); integer(row.revision); text(row.text, 4096); integer(row.caret, row.text.length); return { kind: row.kind, revision: row.revision, text: row.text, caret: row.caret };
		case "feedback":
			record(row, ["kind", "revision", "accepted"]); integer(row.revision);
			if (typeof row.accepted !== "boolean") throw new Error("Invalid prediction feedback");
			return { kind: row.kind, revision: row.revision, accepted: row.accepted };
		case "import": record(row, ["kind", "requestId", "transferId"]); identifier(row.requestId); identifier(row.transferId); return { kind: row.kind, requestId: row.requestId, transferId: row.transferId };
		default: throw new Error("Invalid prediction message");
	}
}
export function parsePredictionEvent(value: unknown): PredictionEvent {
	const row = record(value, ["kind", "channelId", "revision", "suffix", "choices", "rank", "requestId", "message", "count", "truncated"]);
	identifier(row.channelId);
	switch (row.kind) {
		case "next":
		case "suggestion": {
			record(row, row.kind === "next" ? ["kind", "channelId", "revision", "suffix", "choices", "rank"] : ["kind", "channelId", "revision", "suffix"]);
			integer(row.revision);
			if (row.suffix !== null) { text(row.suffix, row.kind === "next" ? 500 : 256); if (/[\r\n]/u.test(row.suffix)) throw new Error("Invalid prediction suffix"); }
			if (row.choices !== undefined) {
				if (!Array.isArray(row.choices) || row.choices.length > 4) throw new Error("Invalid prediction alternatives");
				for (const choice of row.choices) { text(choice, 500); if (!choice || /[\r\n]/u.test(choice)) throw new Error("Invalid prediction alternative"); }
			}
			if (row.rank !== undefined) { integer(row.rank, 3); if (!Array.isArray(row.choices) || row.rank >= row.choices.length) throw new Error("Invalid prediction rank"); }
			break;
		}
		case "closed": record(row, ["kind", "channelId"]); break;
		case "error": record(row, ["kind", "channelId", "message", "requestId"]); text(row.message, 1024); if (row.requestId !== undefined) identifier(row.requestId); break;
		case "imported": record(row, ["kind", "channelId", "requestId", "count", "truncated"]); identifier(row.requestId); integer(row.count, 2000); if (typeof row.truncated !== "boolean") throw new Error("Invalid prediction import result"); break;
		default: throw new Error("Invalid prediction event");
	}
	return row as unknown as PredictionEvent;
}
