/**
 * Tiny-model UI labels for spawned subagents.
 */
import { logger, prompt } from "@linxiraos/pi-utils";
import { cfgOffline } from "../config/auxiliary-model-policy";
import type { ModelRegistry } from "../config/model-registry";
import type { ZetaLanguage } from "../i18n";
import { resolveModelOverride } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import taskLabelSystemPrompt from "../prompts/system/task-label.md" with { type: "text" };
import { generateSessionTitle, generatedNameLanguage } from "../utils/title-generator";

const TASK_LABEL_SYSTEM_PROMPTS = {
	en: prompt.render(taskLabelSystemPrompt),
	zh: prompt.render(taskLabelSystemPrompt, { zh: true }),
};

/** True when a generated label is just the spawn handle, including `Name-2`. */
export function labelEchoesHandle(handle: string | undefined, label: string): boolean {
	if (!handle) return false;
	if (label.localeCompare(handle, undefined, { sensitivity: "accent" }) === 0) return true;
	const separator = handle.lastIndexOf("-");
	if (separator <= 0) return false;
	const prefix = handle.slice(0, separator);
	const suffix = handle.slice(separator + 1);
	return /^\d+$/.test(suffix) && prefix.localeCompare(label, undefined, { sensitivity: "accent" }) === 0;
}

/** Compresses a delegated assignment into a one-sentence UI label via the tiny title model — fired by the executor spawn path because the task wire schema no longer carries a `description`; null on empty input or failure. */
export async function generateTaskLabel(
	assignment: string,
	registry: ModelRegistry,
	settings: Settings,
	sessionId?: string,
	signal?: AbortSignal,
	language?: ZetaLanguage,
	parentActiveModelPattern?: string,
	parentActiveProvider?: string,
): Promise<string | null> {
	const text = assignment.trim();
	if (!text) return null;
	// Resolve once, before the request: the prompt branch and the generation
	// override must agree even if another view reloads settings meanwhile.
	const resolvedLanguage = language ?? generatedNameLanguage(settings);
	try {
		const resolvedModel =
			cfgOffline.get(settings) && parentActiveModelPattern
				? resolveModelOverride([parentActiveModelPattern], registry, settings, { exactOnly: true }).model
				: undefined;
		const currentModel =
			resolvedModel && (!parentActiveProvider || resolvedModel.provider === parentActiveProvider)
				? resolvedModel
				: undefined;
		const label = await generateSessionTitle(
			text,
			registry,
			settings,
			sessionId,
			currentModel,
			undefined,
			TASK_LABEL_SYSTEM_PROMPTS[resolvedLanguage],
			signal,
			undefined,
			undefined,
			resolvedLanguage,
		);
		if (!label || labelEchoesHandle(sessionId, label)) return null;
		return label;
	} catch (err) {
		logger.debug("task-label: generation failed", {
			titleSessionId: sessionId,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}
