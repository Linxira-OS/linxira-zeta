// /retry: re-submit the last user message (pi extension API has no session.retry;
// closest equivalent is re-sending the previous user prompt)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function lastUserPrompt(entries: readonly { type: string; message?: { role: string; content?: unknown } }[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "user") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const text = content
				.filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n");
			if (text.trim()) return text;
		}
		return undefined;
	}
	return undefined;
}

export function installRetry(api: ExtensionAPI): void {
	api.registerCommand("retry", {
		description: "Retry the last user prompt (re-submit the previous user message)",
		handler: async (_args, ctx) => {
			const prompt = lastUserPrompt(ctx.sessionManager.getEntries());
			if (!prompt) {
				ctx.ui.notify("Nothing to retry.", "warning");
				return;
			}
			void api.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}

export function lastUserPromptFromContext(ctx: ExtensionContext): string | undefined {
	return lastUserPrompt(ctx.sessionManager.getEntries());
}
