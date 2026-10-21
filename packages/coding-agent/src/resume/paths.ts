/**
 * Canonical path identity for the resume directory. Session cwds, project
 * roots and preference keys must agree even when a path is spelled with
 * different separators, symlinks or Windows drive-letter casing.
 */

import { normalizePathForComparison } from "@linxiraos/pi-utils/dirs";

/** Canonical comparison key for a filesystem path ("" for an absent path). */
export function resumePathKey(value: string | null | undefined): string {
	if (!value) return "";
	return normalizePathForComparison(value);
}

/** True when both paths denote the same filesystem location. */
export function sameResumePath(a: string | null | undefined, b: string | null | undefined): boolean {
	const left = resumePathKey(a);
	const right = resumePathKey(b);
	return left !== "" && left === right;
}
