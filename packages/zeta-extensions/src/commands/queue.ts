// /queue: queue a message for after the agent yields (port of omp queue command)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_ENTRY = "zeta-queue";

export function installQueue(api: ExtensionAPI): void {
	let queue: string[] = [];

	const persist = (): void => {
		api.appendEntry(STATE_ENTRY, queue);
	};

	api.registerCommand("queue", {
		description: "Queue a message for after the agent yields. Usage: /queue <message>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify(queue.length ? `Queued: ${queue.map((m) => `\n- ${m.slice(0, 80)}`).join("")}` : "Queue is empty.", "info");
				return;
			}
			queue.push(trimmed);
			persist();
			ctx.ui.notify(`Queued (${queue.length}): ${trimmed.slice(0, 80)}`, "info");
		},
	});

	api.on("agent_settled", () => {
		const next = queue.shift();
		if (next) {
			persist();
			void api.sendUserMessage(next, { deliverAs: "followUp" });
		}
	});

	api.on("session_start", async (_event, ctx: ExtensionContext) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY) {
				queue = Array.isArray(entry.data) ? (entry.data as string[]) : [];
				break;
			}
		}
	});
}
