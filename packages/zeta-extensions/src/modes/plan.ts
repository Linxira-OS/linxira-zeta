// Plan mode: read-only planning + numbered plan steps + execution tracking.
// Based on pi's plan-mode example extension, extended with omp plan semantics:
// mode exclusivity, plan file (plans/<slug>-plan.md), execution-mode choice on
// approval (fresh context / compact / keep context), and /plan-review.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { ModeManager, type ZetaMode } from "./shared.ts";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./todo-utils.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);

interface PlanState {
	enabled: boolean;
	planFilePath: string | undefined;
	todos: TodoItem[];
	executing: boolean;
	toolsBefore: string[] | undefined;
	approved: boolean;
}

const PLAN_CONTEXT_TEMPLATE = `[PLAN MODE ACTIVE]
You are in plan mode. You MUST preserve read-only working-tree and system semantics:
- You NEVER create, edit, delete, or rename working-tree files.
- You NEVER run state-changing commands (git commit, npm install, migrations) or make any other system change.
- Bash is restricted to an allowlist of read-only commands.

Write the canonical plan to {{planFilePath}} using the write tool, keeping it decision-complete:
a competent implementer who never saw this conversation executes the file top to bottom and makes ZERO design decisions.

Ground every claim: every path, symbol, signature, and behavior you state as fact MUST come from something you actually read this session. Mark anything unverified as unverified.

Plan file sections:
- Context: restate the literal ask and intended end state (2-4 sentences).
- Approach: ordered steps grouped by behavior; each step states the concrete edit (verb + exact target + new behavior), names existing functions to reuse with paths, lists every callsite for renames/signature changes, and specifies edge/failure handling.
- Critical files & anchors: up to 5 files (path + symbol/region + one-line reason).
- Verification: exact commands that prove the change works end-to-end, exercising the NEW behavior.
- Assumptions & contingencies: only load-bearing decisions; pre-decide fallbacks.

When the plan is decision-complete, stop and report the plan file path. Do NOT attempt changes.`;

const EXECUTE_CONTEXT_TEMPLATE = `[EXECUTING PLAN - Full tool access enabled]

Plan file: {{planFilePath}}
Remaining steps:
{{todoList}}

Execute each step in order. After completing a step, include a [DONE:n] tag in your response.
If the plan has no numbered steps, work through the plan file top to bottom.`;

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function uniqueToolNames(toolNames: string[]): string[] {
	return [...new Set(toolNames)];
}

export function installPlanMode(api: ExtensionAPI, modes: ModeManager): () => { enabled: boolean; executing: boolean; todos: TodoItem[] } {
	let plan: PlanState = {
		enabled: false,
		planFilePath: undefined,
		todos: [],
		executing: false,
		toolsBefore: undefined,
		approved: false,
	};

	const getState = (): { enabled: boolean; executing: boolean; todos: TodoItem[] } => ({
		enabled: plan.enabled,
		executing: plan.executing,
		todos: plan.todos,
	});

	const persist = (): void => {
		api.appendEntry("zeta-plan", plan);
	};

	const updateStatus = (ctx: ExtensionContext): void => {
		if (plan.executing && plan.todos.length > 0) {
			const completed = plan.todos.filter((t) => t.completed).length;
			ctx.ui.setStatus("zeta-plan", `Plan: executing ${completed}/${plan.todos.length}`);
		} else if (plan.enabled) {
			ctx.ui.setStatus("zeta-plan", plan.planFilePath ? `Plan: on (${plan.planFilePath})` : "Plan: on");
		} else {
			ctx.ui.setStatus("zeta-plan", undefined);
		}
	};

	const planModeTools = (activeToolNames: string[]): string[] =>
		uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);

	const enterPlanMode = (ctx: ExtensionContext): boolean => {
		const conflict = modes.conflictWith("plan");
		if (conflict) {
			ctx.ui.notify(`Exit ${conflict} mode first.`, "warning");
			return false;
		}
		if (plan.enabled) return true;
		plan.toolsBefore = modes.saveTools();
		modes.setTools(planModeTools(plan.toolsBefore));
		plan.enabled = true;
		plan.executing = false;
		plan.approved = false;
		modes.setMode("plan", plan.toolsBefore);
		modes.updateStatus(ctx);
		updateStatus(ctx);
		persist();
		return true;
	};

	const exitPlanMode = (ctx: ExtensionContext, notify: string | undefined): void => {
		if (plan.enabled) {
			modes.restoreTools(plan.toolsBefore);
		}
		plan.enabled = false;
		plan.executing = false;
		plan.toolsBefore = undefined;
		if (modes.active() === "plan") modes.clearMode();
		modes.updateStatus(ctx);
		updateStatus(ctx);
		persist();
		if (notify) ctx.ui.notify(notify);
	};

	const startExecution = (ctx: ExtensionContext, freshContext: boolean): void => {
		plan.enabled = false;
		plan.executing = true;
		plan.approved = true;
		modes.restoreTools(plan.toolsBefore);
		plan.toolsBefore = undefined;
		if (modes.active() === "plan") modes.clearMode();
		updateStatus(ctx);
		persist();

		const todoList = plan.todos.map((t) => `${t.step}. ${t.text}`).join("\n");
		const execMessage = EXECUTE_CONTEXT_TEMPLATE.replaceAll("{{planFilePath}}", plan.planFilePath ?? "")
			.replaceAll("{{todoList}}", todoList || "(no numbered steps; follow the plan file)");
		const planMessage = { customType: "zeta-plan", content: `**Plan approved**\n\n${plan.planFilePath ?? ""}`, display: true };

		if (freshContext) {
			void (ctx as ExtensionCommandContext).newSession({
				setup: async (sm) => {
					await sm.appendMessage({ role: "user", content: execMessage, timestamp: Date.now() });
				},
			});
			void api.sendMessage(planMessage, { deliverAs: "followUp" });
			return;
		}
		void api.sendMessage(planMessage, { deliverAs: "followUp" });
		void api.sendUserMessage(execMessage, { deliverAs: "followUp" });
	};

	const openPlanReview = async (ctx: ExtensionCommandContext): Promise<void> => {
		if (!plan.enabled) {
			ctx.ui.notify("Plan review: plan mode inactive. Run /plan first.", "warning");
			return;
		}
		if (plan.todos.length === 0) {
			ctx.ui.notify("No plan steps detected yet. Ask the agent to produce a plan.", "info");
			return;
		}
		const todoListText = plan.todos.map((t) => `${t.step}. ${t.text}`).join("\n");
		const choice = await ctx.ui.select("Plan review - what next?", [
			"Approve and execute (fresh context)",
			"Approve and execute (keep context)",
			"Approve and compact context",
			"Stay in plan mode",
			"Refine the plan",
		]);
		if (!choice) return;
		if (choice.startsWith("Approve and execute (fresh")) {
			startExecution(ctx, true);
		} else if (choice.startsWith("Approve and execute (keep")) {
			startExecution(ctx, false);
		} else if (choice.startsWith("Approve and compact")) {
			plan.enabled = false;
			plan.executing = true;
			plan.approved = true;
			modes.restoreTools(plan.toolsBefore);
			plan.toolsBefore = undefined;
			if (modes.active() === "plan") modes.clearMode();
			updateStatus(ctx);
			persist();
			void ctx.compact({ customInstructions: "The plan below was approved; execute it. Preserve the plan steps in the summary." });
			const todoList = plan.todos.map((t) => `${t.step}. ${t.text}`).join("\n");
			void api.sendUserMessage(
				EXECUTE_CONTEXT_TEMPLATE.replaceAll("{{planFilePath}}", plan.planFilePath ?? "")
					.replaceAll("{{todoList}}", todoList || "(no numbered steps; follow the plan file)"),
				{ deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.input("Refine the plan:", "What should change?");
			if (refinement?.trim()) {
				void api.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	};

	api.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	api.registerCommand("plan", {
		description: "Toggle plan mode (agent plans before executing)",
		handler: async (args, ctx) => {
			if (plan.enabled) {
				exitPlanMode(ctx, "Plan mode disabled. Full access restored.");
				return;
			}
			if (enterPlanMode(ctx)) {
				ctx.ui.notify("Plan mode enabled. Write tools disabled.", "info");
				const prompt = args.trim();
				if (prompt) {
					void api.sendUserMessage(prompt, { deliverAs: "followUp" });
				}
			}
		},
	});

	api.registerCommand("plan-review", {
		description: "Re-open the plan review for the latest plan (plan mode only)",
		handler: async (_args, ctx) => {
			await openPlanReview(ctx);
		},
	});

	api.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			if (plan.enabled) {
				exitPlanMode(ctx, "Plan mode disabled.");
			} else if (enterPlanMode(ctx)) {
				ctx.ui.notify("Plan mode enabled.");
			}
		},
	});

	api.on("tool_call", async (event) => {
		if (!plan.enabled || event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command;
		if (command && !isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	api.on("context", async (event) => {
		if (plan.enabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "zeta-plan-context") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	api.on("before_agent_start", async () => {
		if (plan.enabled) {
			const filePath = plan.planFilePath ?? "plans/<slug>-plan.md (choose a short kebab-case slug for this task)";
			return {
				message: {
					customType: "zeta-plan-context",
					content: PLAN_CONTEXT_TEMPLATE.replaceAll("{{planFilePath}}", filePath),
					display: false,
				},
			};
		}
		if (plan.executing && plan.todos.length > 0) {
			const remaining = plan.todos.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "zeta-plan-context",
					content: EXECUTE_CONTEXT_TEMPLATE.replaceAll("{{planFilePath}}", plan.planFilePath ?? "")
						.replaceAll("{{todoList}}", todoList),
					display: false,
				},
			};
		}
	});

	api.on("turn_end", async (event, ctx) => {
		if (!plan.executing || plan.todos.length === 0) return;
		if (!isAssistantMessage(event.message)) return;
		const text = getTextContent(event.message);
		if (markCompletedSteps(text, plan.todos) > 0) {
			updateStatus(ctx);
		}
		persist();
	});

	api.on("agent_end", async (event, ctx) => {
		if (plan.executing && plan.todos.length > 0 && plan.todos.every((t) => t.completed)) {
			const completedList = plan.todos.map((t) => `- [x] ${t.text}`).join("\n");
			void api.sendMessage(
				{ customType: "zeta-plan", content: `**Plan complete!**\n\n${completedList}`, display: true },
				{ triggerTurn: false },
			);
			plan.executing = false;
			plan.todos = [];
			updateStatus(ctx);
			persist();
			return;
		}

		if (!plan.enabled || !ctx.hasUI) return;
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) plan.todos = extracted;
		}
		if (plan.todos.length === 0) return;
		persist();
		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Approve and execute (fresh context)",
			"Approve and execute (keep context)",
			"Approve and compact context",
			"Stay in plan mode",
			"Refine the plan",
		]);
		if (!choice) return;
		if (choice.startsWith("Approve and execute (fresh")) {
			startExecution(ctx, true);
		} else if (choice.startsWith("Approve and execute (keep")) {
			startExecution(ctx, false);
		} else if (choice.startsWith("Approve and compact")) {
			plan.enabled = false;
			plan.executing = true;
			plan.approved = true;
			modes.restoreTools(plan.toolsBefore);
			plan.toolsBefore = undefined;
			if (modes.active() === "plan") modes.clearMode();
			updateStatus(ctx);
			persist();
			void ctx.compact({
				customInstructions:
					"The plan below was approved; execute it. Preserve the plan steps in the summary.",
			});
			const todoList = plan.todos.map((t) => `${t.step}. ${t.text}`).join("\n");
			void api.sendUserMessage(
				EXECUTE_CONTEXT_TEMPLATE.replaceAll("{{planFilePath}}", plan.planFilePath ?? "")
					.replaceAll("{{todoList}}", todoList || "(no numbered steps; follow the plan file)"),
				{ deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.input("Refine the plan:", "What should change?");
			if (refinement?.trim()) {
				void api.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	api.on("session_start", async (event, ctx) => {
		if (api.getFlag("plan") === true && !plan.enabled) {
			enterPlanMode(ctx);
		}
		const entries = ctx.sessionManager.getEntries();
		const saved = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "zeta-plan")
			.pop() as { data?: PlanState } | undefined;
		if (saved?.data) {
			const data = saved.data;
			plan.enabled = data.enabled ?? plan.enabled;
			plan.todos = data.todos ?? plan.todos;
			plan.executing = data.executing ?? plan.executing;
			plan.toolsBefore = data.toolsBefore ?? plan.toolsBefore;
			plan.planFilePath = data.planFilePath ?? plan.planFilePath;
			if (data.enabled && modes.active() === undefined) {
				plan.toolsBefore = plan.toolsBefore ?? modes.saveTools();
				modes.setTools(planModeTools(plan.toolsBefore));
				modes.setMode("plan", plan.toolsBefore);
			}
		}
		updateStatus(ctx);
	});

	return getState;
}

export type { PlanState, ZetaMode };
