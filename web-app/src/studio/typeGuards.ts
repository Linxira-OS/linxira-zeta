/**
 * The renderer's canonical runtime-shape guard.
 *
 * Every value that crosses a network or storage boundary is `unknown`; code
 * that inspects its own fields should narrow through this one export instead of
 * growing a local copy per module.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
