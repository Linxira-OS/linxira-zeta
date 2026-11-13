/**
 * Picker-only model visibility rules, mirroring
 * `packages/catalog/src/models.ts` `isModelHiddenBySelectors`.
 *
 * `hiddenModels` never removes a model from the catalog or from model-config
 * settings: it only drops it from composer pickers and model selectors.
 *
 * Supported entries:
 * - `provider/model-id` — one exact selector (a trailing `:thinking` suffix is ignored)
 * - `provider/*` — every model of that provider
 * - `provider/vendor/*` — models whose id starts with `vendor/`
 * - `model-id` — that bare id under any provider
 * - `*` — every model
 */

const THINKING_SUFFIXES: Record<string, true> = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
	auto: true,
	inherit: true,
};

function stripThinkingSuffix(selector: string): string {
	const colon = selector.lastIndexOf(":");
	if (colon < 0) return selector;
	return THINKING_SUFFIXES[selector.slice(colon + 1)] === true ? selector.slice(0, colon) : selector;
}

export function isModelHidden(
	model: { readonly provider: string; readonly id: string },
	hiddenModels: ReadonlyArray<string> | undefined,
): boolean {
	if (!hiddenModels || hiddenModels.length === 0) return false;
	for (const raw of hiddenModels) {
		if (typeof raw !== "string") continue;
		const pattern = raw.trim();
		if (!pattern) continue;
		if (pattern === "*") return true;
		// Match the literal id first: a real catalog id may itself end in
		// `:high`/`:low`, and stripping it before the exact test would make a
		// per-provider bulk selector unable to hide that row. The normalized
		// comparison below still supports a copied role's thinking suffix.
		if (pattern === `${model.provider}/${model.id}`) return true;
		if (!pattern.includes("/") && pattern === model.id) return true;
		const base = stripThinkingSuffix(pattern);
		if (base === `${model.provider}/${model.id}`) return true;
		if (!base.includes("/") && base === model.id) return true;
		if (base.endsWith("/*")) {
			const scope = base.slice(0, -2);
			const slash = scope.indexOf("/");
			if (slash < 0) {
				if (scope === model.provider) return true;
				continue;
			}
			const provider = scope.slice(0, slash);
			const idPrefix = scope.slice(slash + 1);
			if (provider === model.provider && model.id.startsWith(`${idPrefix}/`)) return true;
		}
	}
	return false;
}

/** Selector without a copied `:thinking` suffix. */
export function selectorWithoutThinking(selector: string): string {
	return stripThinkingSuffix(selector.trim());
}

/** Whether any rule covers this model, ignoring exact per-model entries. */
export function hasProviderWideHiddenRule(
	model: { readonly provider: string; readonly id: string },
	hiddenModels: ReadonlyArray<string> | undefined,
): boolean {
	if (!hiddenModels) return false;
	return hiddenModels.some(raw => {
		if (typeof raw !== "string") return false;
		const base = stripThinkingSuffix(raw.trim());
		if (base === "*" || base === `${model.provider}/*`) return true;
		if (!base.endsWith("/*")) return false;
		const scope = base.slice(0, -2);
		const slash = scope.indexOf("/");
		if (slash < 0) return false;
		return scope.slice(0, slash) === model.provider && model.id.startsWith(`${scope.slice(slash + 1)}/`);
	});
}

/** Drop hidden models while preserving the incoming order. */
export function visibleModels<T extends { readonly provider: string; readonly id: string }>(
	models: ReadonlyArray<T>,
	hiddenModels: ReadonlyArray<string> | undefined,
): T[] {
	if (!hiddenModels || hiddenModels.length === 0) return [...models];
	return models.filter(model => !isModelHidden(model, hiddenModels));
}

/** Exact selector entries a per-provider "hide all" writes for `models`. */
export function hiddenSelectorsForProvider(
	models: ReadonlyArray<{ readonly provider: string; readonly id: string }>,
	providerId: string,
): string[] {
	return models
		.filter(model => model.provider === providerId && model.id.length > 0)
		.map(model => `${providerId}/${model.id}`);
}

/** Remove every hidden rule that covers `model` (used by "show this model"). */
export function revealModel(
	hiddenModels: ReadonlyArray<string>,
	model: { readonly provider: string; readonly id: string },
): string[] {
	const exact = `${model.provider}/${model.id}`;
	return hiddenModels.filter(raw => {
		if (typeof raw !== "string") return false;
		const pattern = raw.trim();
		if (!pattern) return false;
		// A literal id may end in a thinking-looking suffix; remove that exact
		// rule here as well as the normalized copy of a role selector.
		if (pattern === exact) return false;
		if (!pattern.includes("/") && pattern === model.id) return false;
		const base = stripThinkingSuffix(pattern);
		if (base === exact) return false;
		if (!base.includes("/") && base === model.id) return false;
		if (base === "*" || base === `${model.provider}/*`) return false;
		if (base.endsWith("/*")) {
			const scope = base.slice(0, -2);
			const slash = scope.indexOf("/");
			if (slash < 0) return true;
			const provider = scope.slice(0, slash);
			const idPrefix = scope.slice(slash + 1);
			if (provider === model.provider && model.id.startsWith(`${idPrefix}/`)) return false;
		}
		return true;
	});
}
