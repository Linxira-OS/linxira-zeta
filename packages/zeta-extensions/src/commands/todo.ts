// /todo + todo tool: task list shared with the agent (port of omp todo command)
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TodoItem } from "../modes/todo-utils.ts";

const STATE_ENTRY = "zeta-todo";

export function installTodo(api: ExtensionAPI): void {
	let todos: TodoItem[] = [];
	let nextStep = 1;

	const persist = (): void => {
		api.appendEntry(STATE_ENTRY, todos);
	};

	const statusText = (): string => {
		if (todos.length === 0) return "Todo: empty";
		const done = todos.filter((t) => t.completed).length;
		return `Todo: ${done}/${todos.length} done`;
	};

	const updateStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus("zeta-todo", statusText());
	};

	api.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Manage the shared todo list. List current items (op=list), add new items (op=add), mark items done (op=done), clear completed (op=clear).",
		parameters: Type.Object({
			op: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("done"), Type.Literal("clear")]),
			text: Type.Optional(Type.String({ description: "Item text (required for op=add)" })),
			step: Type.Optional(Type.Number({ description: "Step number (required for op=done)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.op) {
				case "list": {
					if (todos.length === 0) {
						return { content: [{ type: "text", text: "Todo list is empty." }], details: undefined };
					}
					const lines = todos.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.step}. ${t.text}`).join("\n");
					return { content: [{ type: "text", text: lines }], details: undefined };
				}
				case "add": {
					if (!params.text?.trim()) {
						return { content: [{ type: "text", text: "op=add requires text." }], details: undefined };
					}
					const item: TodoItem = { step: nextStep, text: params.text.trim(), completed: false };
					todos.push(item);
					nextStep += 1;
					persist();
					updateStatus(ctx);
					return { content: [{ type: "text", text: `Added todo ${item.step}: ${item.text}` }], details: undefined };
				}
				case "done": {
					const item = todos.find((t) => t.step === params.step);
					if (!item) {
						return { content: [{ type: "text", text: `No todo step ${params.step}.` }], details: undefined };
					}
					item.completed = true;
					persist();
					updateStatus(ctx);
					return { content: [{ type: "text", text: `Done: ${item.step}. ${item.text}` }], details: undefined };
				}
				case "clear": {
					todos = todos.filter((t) => !t.completed);
					persist();
					updateStatus(ctx);
					return { content: [{ type: "text", text: "Cleared completed items." }], details: undefined };
				}
			}
		},
	});

	api.registerCommand("todo", {
		description: "Manage todo list. Usage: /todo [list|add <text>|done <n>|clear]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed === "list") {
				const lines =
					todos.length === 0
						? ["(empty)"]
						: todos.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.step}. ${t.text}`);
				void api.sendMessage({ customType: "zeta-todo", content: lines.join("\n"), display: true });
				return;
			}
			const [verb, ...rest] = trimmed.split(/\s+/);
			if (verb === "add") {
				const text = rest.join(" ").trim();
				if (!text) {
					ctx.ui.notify("Usage: /todo add <text>", "warning");
					return;
				}
				const item: TodoItem = { step: nextStep, text, completed: false };
				todos.push(item);
				nextStep += 1;
				persist();
				updateStatus(ctx);
				ctx.ui.notify(`Added todo ${item.step}.`, "info");
				return;
			}
			if (verb === "done") {
				const step = Number(rest[0]);
				const item = todos.find((t) => t.step === step);
				if (!item) {
					ctx.ui.notify(`No todo step ${step}.`, "warning");
					return;
				}
				item.completed = true;
				persist();
				updateStatus(ctx);
				ctx.ui.notify(`Done: ${item.step}. ${item.text}`, "info");
				return;
			}
			if (verb === "clear") {
				todos = todos.filter((t) => !t.completed);
				persist();
				updateStatus(ctx);
				ctx.ui.notify("Cleared completed items.", "info");
				return;
			}
			ctx.ui.notify("Usage: /todo [list|add <text>|done <n>|clear]", "warning");
		},
	});

	api.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY) {
				const data = Array.isArray(entry.data) ? (entry.data as TodoItem[]) : [];
				if (data.length > 0) {
					todos = data;
					nextStep = Math.max(...data.map((t) => t.step), 0) + 1;
				}
				break;
			}
		}
		updateStatus(ctx);
	});
}
