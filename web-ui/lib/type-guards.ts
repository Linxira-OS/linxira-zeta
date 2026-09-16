/**
 * Canonical runtime type guards for web-ui boundary data (localStorage,
 * network JSON). One module, one export — do not recreate these inline.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
