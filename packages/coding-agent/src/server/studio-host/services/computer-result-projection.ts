import type { JsonValue } from "../protocol/contracts/conversation.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0");
}
export function hasComputerResultDetails(value: unknown): boolean {
	return record(value) && ("computerFrames" in value || "screenshots" in value);
}
/** Computer pixels and native screenshot paths remain in private transport, even inside Eval metadata. */
export function computerResultProjection(value: unknown): JsonValue | undefined {
	if (!record(value) || !Array.isArray(value.computerFrames) || value.computerFrames.length > 200) return undefined;
	const references: JsonValue[] = [];
	for (const item of value.computerFrames) {
		if (
			!record(item) ||
			typeof item.frameId !== "string" ||
			!UUID.test(item.frameId) ||
			!text(item.sessionId) ||
			!text(item.toolCallId) ||
			typeof item.delivered !== "boolean"
		)
			return undefined;
		references.push({
			frameId: item.frameId,
			sessionId: item.sessionId,
			toolCallId: item.toolCallId,
			delivered: item.delivered,
		});
	}
	const result: Record<string, JsonValue> = { computerFrames: references };
	for (const key of ["language", "notice", "code"])
		if (typeof value[key] === "string" && value[key].length <= 128 * 1024) result[key] = value[key];
	if (Array.isArray(value.cells) && value.cells.length <= 100) {
		result.cells = value.cells.filter(record).map(cell => {
			const safe: Record<string, JsonValue> = {};
			for (const key of ["title", "code", "language", "output", "status"])
				if (typeof cell[key] === "string" && cell[key].length <= 128 * 1024) safe[key] = cell[key];
			for (const key of ["index", "durationMs", "exitCode"])
				if (typeof cell[key] === "number" && Number.isFinite(cell[key])) safe[key] = cell[key];
			return safe;
		});
	}
	return result;
}
