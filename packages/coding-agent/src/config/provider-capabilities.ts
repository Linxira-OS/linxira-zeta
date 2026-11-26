/**
 * Product-facing capability policy for configured providers.
 *
 * The catalog knows every transport; the product decides which capabilities
 * this release exposes. TTS, STT and video stay paused until the owner reopens
 * them, so the model-control surface must not advertise them even when a
 * provider descriptor contains such rows.
 */

export const PAUSED_MODEL_CAPABILITIES = ["tts", "stt", "video"] as const;
export type PausedModelCapability = (typeof PAUSED_MODEL_CAPABILITIES)[number];

/** Kinds the product exposes for model control and fallback binding. */
export const PRODUCT_MODEL_CAPABILITIES = ["chat", "image", "embedding", "judge", "rerank", "search"] as const;

export type ProductModelCapability = (typeof PRODUCT_MODEL_CAPABILITIES)[number];

export interface CapabilityModelLike {
	readonly provider: string;
	readonly kind?: string;
}

export interface ProviderCapabilitySummary {
	readonly provider: string;
	/** Distinct product capabilities, in first-seen model order. */
	readonly capabilities: readonly ProductModelCapability[];
	readonly modelCount: number;
	/** Paused capabilities present in the catalog but hidden from this release. */
	readonly paused: readonly PausedModelCapability[];
}

/** Whether this release exposes a catalog kind. Absent kind means chat. */
export function isProductCapability(kind: string | undefined): kind is ProductModelCapability {
	return (PRODUCT_MODEL_CAPABILITIES as readonly string[]).includes(kind ?? "chat");
}

/** Whether this release suppresses a catalog kind. */
export function isPausedCapability(kind: string | undefined): kind is PausedModelCapability {
	return (PAUSED_MODEL_CAPABILITIES as readonly string[]).includes(kind ?? "");
}

/** Human-readable reason used by API/UI when a paused capability is requested. */
export function pausedCapabilityReason(kind: PausedModelCapability): string {
	switch (kind) {
		case "tts":
			return "Text-to-speech is paused for this release.";
		case "stt":
			return "Speech-to-text is paused for this release.";
		case "video":
			return "Video generation is paused for this release.";
	}
}

/**
 * Group models by provider and keep only product-visible capabilities.
 * Providers whose only models are paused are omitted from the visible list.
 */
export function summarizeProviderCapabilities(models: readonly CapabilityModelLike[]): ProviderCapabilitySummary[] {
	const byProvider = new Map<
		string,
		{ capabilities: ProductModelCapability[]; paused: PausedModelCapability[]; count: number }
	>();
	for (const model of models) {
		const provider = model.provider.trim();
		if (provider === "") continue;
		const state = byProvider.get(provider) ?? { capabilities: [], paused: [], count: 0 };
		state.count += 1;
		const kind = model.kind ?? "chat";
		if (isPausedCapability(kind)) {
			if (!state.paused.includes(kind)) state.paused.push(kind);
		} else if (isProductCapability(kind) && !state.capabilities.includes(kind)) {
			state.capabilities.push(kind);
		}
		byProvider.set(provider, state);
	}
	const result: ProviderCapabilitySummary[] = [];
	for (const [provider, state] of byProvider) {
		if (state.capabilities.length === 0) continue;
		result.push({
			provider,
			capabilities: state.capabilities,
			modelCount: state.count,
			paused: state.paused,
		});
	}
	return result;
}
