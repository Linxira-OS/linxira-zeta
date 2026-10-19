/**
 * Catalog identity for a dashboard model row: merges provider and spelling
 * variants (`claude-opus-4.6`, `anthropic/claude-opus-4-6`) into one display
 * row, shared by the user-side frustration table and the model-side breakdown
 * table so both group and order identically.
 */
import { compareRevision, parseRevision } from "@linxiraos/pi-catalog/compat/revision";
import { classifyModel } from "@linxiraos/pi-catalog/compat/taxonomy";

export interface ModelIdentity {
	/** Stable key: `class/family/revision` when classified, else the raw model id. */
	key: string;
	/** Display label, e.g. `opus 4.5`; the raw model id when unclassified. */
	label: string;
	/** Catalog identity class, e.g. `anthropic`; `unknown` when unclassified. */
	modelClass: string;
	/** Catalog family within the class, e.g. `opus`. */
	family: string | null;
	/** Canonical `major.minor.patch`, e.g. `4.5.0`; null when unclassified. */
	revision: string | null;
}

/** Resolve the display identity of one persisted (provider, model) pair. */
export function modelIdentityOf(provider: string | null, model: string): ModelIdentity {
	const identity = classifyModel(provider ?? "", model, { lenient: true });
	const classified = identity.class !== "unknown" && identity.revision !== undefined;
	const family = identity.family ?? null;
	const revision = classified ? (identity.revision ?? null) : null;
	// `4.5.0` → `4.5`, `5.0.0` → `5`.
	const shortRevision = revision?.replace(/(?:\.0)+$/, "");
	return {
		key: classified ? `${identity.class}/${family ?? ""}/${identity.revision}` : model,
		label: shortRevision ? [family, shortRevision].filter(Boolean).join(" ") : model,
		modelClass: identity.class,
		family,
		revision,
	};
}

/**
 * Sort order shared by every model table: classified rows by class, then
 * revision ascending, then family; unclassified rows follow by first use.
 */
export function compareModelIdentity(
	a: { modelClass: string; family: string | null; revision: string | null; firstSeen: number },
	b: { modelClass: string; family: string | null; revision: string | null; firstSeen: number },
): number {
	const aRevision = a.revision ? parseRevision(a.revision) : undefined;
	const bRevision = b.revision ? parseRevision(b.revision) : undefined;
	if (!aRevision || !bRevision) {
		if (aRevision) return -1;
		if (bRevision) return 1;
		return a.firstSeen - b.firstSeen;
	}
	if (a.modelClass !== b.modelClass) return a.modelClass < b.modelClass ? -1 : 1;
	const byRevision = compareRevision(aRevision, bRevision);
	if (byRevision !== 0) return byRevision;
	const aFamily = a.family ?? "";
	const bFamily = b.family ?? "";
	return aFamily < bFamily ? -1 : aFamily > bFamily ? 1 : 0;
}
