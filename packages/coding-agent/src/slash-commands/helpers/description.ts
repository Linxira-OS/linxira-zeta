/**
 * Resolve a command description against the catalogue active *now*.
 *
 * Specs declare localized copy as `description: () => M.cmdFoo` so the value
 * follows `/language` at runtime; the plain-string form is still accepted for
 * copy that has no translation (or that is not user-facing). Never cache the
 * result — every consumer that renders a list must call this per read.
 */
export function resolveCommandDescription(description: string | (() => string)): string {
	return typeof description === "function" ? description() : description;
}
