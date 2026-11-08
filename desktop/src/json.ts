/** Canonical JSON boundary guards for the standalone desktop package. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One field of an untrusted JSON value, or `undefined` when the value is not an object. */
export function fieldOf(value: unknown, field: string): unknown {
	return isRecord(value) ? value[field] : undefined;
}
