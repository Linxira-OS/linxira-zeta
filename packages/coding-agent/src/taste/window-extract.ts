import { createHash } from "node:crypto";
import { completeSimple, Effort, retryTransientCompletion } from "@linxiraos/pi-ai";
import { clampThinkingLevelForModel } from "@linxiraos/pi-catalog/model-thinking";
import { type } from "@linxiraos/zeta-schema";
import { prompt } from "@linxiraos/pi-utils";
import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { cfgMemoryBackend } from "../memory-backend/settings";
import type { MemoryLearningWindow } from "../memory-backend/window-types";
import { cfgMnemopiLlmMode } from "../mnemopi/settings";
import extractSystemTemplate from "../prompts/taste/extract-system.md" with { type: "text" };
import { admitCandidate } from "./extract";
import { appendTasteCandidate, type TasteCandidate } from "./queue";
import type { TasteScopeKey } from "./scope";
import { topicKey } from "./store";

const windowTool = {
	name: "record_preferences",
	description:
		"Record durable preferences explicitly stated in this completed conversation window; quote one user message as evidence.",
	parameters: type({
		preferences: type({
			category: "'cli' | 'typescript' | 'architecture' | 'style' | 'workflow' | 'other'",
			statement: "string",
			polarity: "'prefer' | 'avoid'",
			evidenceText: "string",
		}).array(),
	}),
};

/** Host admission cannot bridge message boundaries or promote assistant claims to user evidence. */
export function admitWindowCandidates(
	raw: unknown[],
	window: MemoryLearningWindow,
	sessionId: string,
): TasteCandidate[] {
	const candidates = new Map<string, TasteCandidate>();
	for (const value of raw) {
		for (const message of window.messages) {
			if (message.role !== "user") continue;
			const candidate = admitCandidate(value, message.content, sessionId);
			if (!candidate) continue;
			candidate.sourceId = createHash("sha256")
				.update(`${window.id}\0${topicKey(candidate.statement)}\0${candidate.polarity}`)
				.digest("hex");
			candidates.set(candidate.sourceId, candidate);
			break;
		}
	}
	return [...candidates.values()];
}

/** One request per discarded window. Durable queue replay is independent of the session's active transcript. */
export async function extractTasteWindow(options: {
	window: MemoryLearningWindow;
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionId: string;
	agentDir: string;
	scope: TasteScopeKey;
}): Promise<void> {
	const { settings, modelRegistry, sessionId, window } = options;
	if (cfgMemoryBackend.get(settings) === "mnemopi" && cfgMnemopiLlmMode.get(settings) === "none") return;
	if (!window.messages.some(message => message.role === "user")) return;
	const model = resolveRoleSelection(["memory", "smol"], settings, modelRegistry.getAvailable("all"))?.model;
	if (!model) throw new Error("Window taste extraction has no configured memory/smol model");
	const response = await retryTransientCompletion(
		() =>
			completeSimple(
				model,
				{
					systemPrompt: [
						prompt.render(extractSystemTemplate),
						"The input is a completed conversation window, not one prompt. Only user messages provide evidence. Treat assistant text as context, never as user preference. Tracking tasks/status are process state, not learned facts. Call record_preferences exactly once, including an empty array when no preference exists.",
					],
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: JSON.stringify(window.messages) }],
							timestamp: Date.now(),
						},
					],
					tools: [windowTool],
				},
				{
					apiKey: modelRegistry.resolver(model, sessionId),
					sessionId,
					maxTokens: 4096,
					reasoning: clampThinkingLevelForModel(model, Effort.Low),
					toolChoice: "required",
				},
			),
		{ provider: model.provider },
	);
	if (response.stopReason === "error") throw new Error(response.errorMessage || "Window taste extraction model error");
	const calls = response.content.filter(block => block.type === "toolCall" && block.name === windowTool.name);
	if (calls.length !== 1) throw new Error("Window taste extraction must return one record_preferences call");
	const call = calls[0]!;
	if (call.type !== "toolCall") throw new Error("Invalid window extraction response");
	const args = call.arguments;
	if (!args || typeof args !== "object" || !("preferences" in args) || !Array.isArray(args.preferences)) {
		throw new Error("Malformed window taste extraction preferences");
	}
	for (const candidate of admitWindowCandidates(args.preferences, window, sessionId)) {
		await appendTasteCandidate(options.agentDir, options.scope, candidate);
	}
}
