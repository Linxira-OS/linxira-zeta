// Vibe mode: director drives fast/good worker sessions (pi -p subprocesses).
// Port of omp vibe mode onto pi extension API. Workers are persistent pi print
// sessions in a dedicated session dir; spawn/send/wait/kill/list tools mirror
// omp's vibe_* tools.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ModeManager } from "./shared.ts";

const VIBE_BASE_TOOLS = ["read", "todo"];
const STATE_ENTRY = "zeta-vibe";

export interface VibeWorker {
	id: string;
	name: string;
	model: "fast" | "good" | string;
	brief: string;
	spawnedAt: number;
	lastResult: string | undefined;
	lastResultAt: number | undefined;
	running: boolean;
	sessionDir: string;
}

interface VibeState {
	enabled: boolean;
	workers: Record<string, VibeWorker>;
	previousTools: string[] | undefined;
}

const DIRECTOR_CONTEXT = `[VIBE MODE ACTIVE]
Vibe mode is ON. You are the DIRECTOR. You do not edit, run, grep, or build anything yourself; your hands are off the keyboard. You drive worker CLI sessions (full coding agents, each pi in print mode) and verify their work by reading files.

Your toolset: read, todo, vibe_spawn, vibe_send, vibe_wait, vibe_kill, vibe_list.

# The workers

- fast: low-latency model. Mechanical, well-specified work: renames, small fixes, boilerplate, data collection, running tests and reporting output.
- good: strong model. Hard work: design, tricky debugging, multi-file refactors, anything needing judgment.

Workers are persistent conversations (pi print sessions). Spawn once per workstream, then keep talking to the SAME worker; never respawn for a follow-up on the same workstream.

# How to direct

1. Split the request into independent workstreams. One worker per workstream.
2. vibe_spawn with a complete, self-contained brief: files, constraints, acceptance criteria. Workers start blank; they never see this conversation.
3. Sends and spawns return immediately; results arrive when a worker finishes. Keep directing other workers meanwhile; call vibe_wait only when you cannot proceed without a result.
4. When a result arrives, judge it: read the touched files to verify claims before building on them. Follow up with vibe_send (corrections, next step, review request).
5. After verifying a worker result, use todo to maintain the parent session's list.
6. Route by difficulty: draft with fast, escalate to good when fast stalls; have good design and fast execute the mechanical parts.
7. vibe_kill a worker that is stuck or whose workstream is done; vibe_list when you lose track.

Run workers concurrently. You stay responsible for the final outcome: verify with read, do not take a worker's word for it.`;

function now(): number {
	return Date.now();
}

export function installVibeMode(api: ExtensionAPI, modes: ModeManager): () => VibeState {
	let state: VibeState = { enabled: false, workers: {}, previousTools: undefined };

	const getState = (): VibeState => state;

	const persist = (): void => {
		api.appendEntry(STATE_ENTRY, state);
	};

	const updateStatus = (ctx: ExtensionContext): void => {
		if (!state.enabled) {
			ctx.ui.setStatus("zeta-vibe", undefined);
			return;
		}
		const running = Object.values(state.workers).filter((w) => w.running).length;
		ctx.ui.setStatus("zeta-vibe", `Vibe: on (${Object.keys(state.workers).length} workers, ${running} running)`);
	};

	const workerSessionDir = (): string => {
		return ".pi/vibe-workers";
	};

	const runWorker = async (worker: VibeWorker, message: string, cwd: string): Promise<void> => {
		worker.running = true;
		worker.lastResult = undefined;
		persist();
		const args = ["-p", message, "--session-dir", worker.sessionDir, "--name", worker.name];
		if (worker.lastResultAt) args.push("--continue");
		const result = await api.exec("pi", args, { cwd });
		worker.running = false;
		worker.lastResult = `${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`.trim() || "(no output)";
		worker.lastResultAt = now();
		persist();
	};

	const spawnWorker = async (workerName: string, model: string, brief: string, cwd: string): Promise<VibeWorker> => {
		const id = `${workerName}-${now().toString(36)}`;
		const worker: VibeWorker = {
			id,
			name: workerName,
			model,
			brief,
			spawnedAt: now(),
			lastResult: undefined,
			lastResultAt: undefined,
			running: false,
			sessionDir: workerSessionDir(),
		};
		state.workers[id] = worker;
		persist();
		void runWorker(worker, brief, cwd);
		return worker;
	};

	const killWorker = async (id: string): Promise<boolean> => {
		const worker = state.workers[id];
		if (!worker) return false;
		delete state.workers[id];
		persist();
		return true;
	};

	api.registerCommand("vibe", {
		description: "Toggle vibe mode (director drives fast/good worker sessions; read-only toolset)",
		handler: async (args, ctx) => {
			if (state.enabled) {
				state.enabled = false;
				modes.restoreTools(state.previousTools);
				state.previousTools = undefined;
				if (modes.active() === "vibe") modes.clearMode();
				modes.updateStatus(ctx);
				updateStatus(ctx);
				persist();
				ctx.ui.notify(`Vibe mode disabled. ${Object.keys(state.workers).length} worker sessions left in ${workerSessionDir()}.`, "info");
				return;
			}
			const conflict = modes.conflictWith("vibe");
			if (conflict) {
				ctx.ui.notify(`Exit ${conflict} mode first.`, "warning");
				return;
			}
			state.previousTools = modes.saveTools();
			modes.setTools([...new Set([...VIBE_BASE_TOOLS, ...state.previousTools.filter((t) => VIBE_BASE_TOOLS.includes(t))])]);
			state.enabled = true;
			modes.setMode("vibe", state.previousTools);
			modes.updateStatus(ctx);
			updateStatus(ctx);
			persist();
			ctx.ui.notify("Vibe mode enabled. You direct fast/good worker sessions; toolset is read + todo + vibe tools.", "info");
			const prompt = args.trim();
			if (prompt) {
				void api.sendUserMessage(prompt, { deliverAs: "followUp" });
			}
		},
	});

	api.registerTool({
		name: "vibe_spawn",
		label: "Vibe Spawn",
		description:
			"Spawn a worker session with a complete self-contained brief. Worker starts blank; it never sees this conversation. Returns immediately; results arrive when the worker finishes.",
		parameters: Type.Object({
			worker: Type.Union([Type.Literal("fast"), Type.Literal("good")], { description: "fast: mechanical work; good: hard work" }),
			brief: Type.String({ description: "Self-contained brief: files, constraints, acceptance criteria" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state.enabled) {
				return {
					content: [{ type: "text", text: "Vibe mode is off. Run /vibe first." }],
					details: undefined,
				};
			}
			const worker = await spawnWorker(`vibe-${params.worker}`, params.worker, params.brief, ctx.cwd);
			return {
				content: [{ type: "text", text: `Spawned worker ${worker.id}. Result will arrive when it finishes.` }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "vibe_send",
		label: "Vibe Send",
		description: "Send a message to an existing worker session and await its turn result.",
		parameters: Type.Object({
			id: Type.String({ description: "Worker id from vibe_list" }),
			message: Type.String({ description: "Instructions, corrections, or next step for the worker" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const worker = state.workers[params.id];
			if (!worker) {
				return { content: [{ type: "text", text: `Unknown worker id: ${params.id}. Use vibe_list.` }], details: undefined };
			}
			await runWorker(worker, params.message, ctx.cwd);
			return {
				content: [{ type: "text", text: worker.lastResult ?? "(no result)" }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "vibe_wait",
		label: "Vibe Wait",
		description: "Wait for a specific worker's running turn to finish and return its result.",
		parameters: Type.Object({
			id: Type.String({ description: "Worker id from vibe_list" }),
			timeoutSeconds: Type.Optional(Type.Number({ description: "Max seconds to wait (default 300)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const worker = state.workers[params.id];
			if (!worker) {
				return { content: [{ type: "text", text: `Unknown worker id: ${params.id}.` }], details: undefined };
			}
			const deadline = now() + (params.timeoutSeconds ?? 300) * 1000;
			while (worker.running && now() < deadline) {
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "Aborted." }], details: undefined };
				}
				await new Promise((r) => setTimeout(r, 500));
			}
			return {
				content: [{ type: "text", text: worker.lastResult ?? "(worker finished without output)" }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "vibe_kill",
		label: "Vibe Kill",
		description: "Kill a worker session (stuck or workstream done).",
		parameters: Type.Object({
			id: Type.String({ description: "Worker id from vibe_list" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const ok = await killWorker(params.id);
			return {
				content: [{ type: "text", text: ok ? `Killed worker ${params.id}.` : `Unknown worker id: ${params.id}.` }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "vibe_list",
		label: "Vibe List",
		description: "List all worker sessions with status and last result.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const lines = Object.values(state.workers).map(
				(w) =>
					`${w.id} [${w.model}] ${w.running ? "running" : "idle"}${w.lastResultAt ? ` last ${w.lastResultAt}` : ""}\n  brief: ${w.brief.slice(0, 200)}`,
			);
			return {
				content: [{ type: "text", text: lines.length ? lines.join("\n") : "No workers." }],
				details: undefined,
			};
		},
	});

	api.on("before_agent_start", async () => {
		if (!state.enabled) return;
		return {
			message: {
				customType: "zeta-vibe-context",
				content: DIRECTOR_CONTEXT,
				display: false,
			},
		};
	});

	api.on("context", async (event) => {
		if (state.enabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as { customType?: string };
				return msg.customType !== "zeta-vibe-context";
			}),
		};
	});

	api.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY) {
				const data = entry.data as VibeState | undefined;
				if (data?.enabled) {
					state = data;
					state.workers = state.workers ?? {};
					if (modes.active() === undefined) {
						state.previousTools = state.previousTools ?? modes.saveTools();
						modes.setTools([...new Set([...VIBE_BASE_TOOLS, ...state.previousTools.filter((t) => VIBE_BASE_TOOLS.includes(t))])]);
						modes.setMode("vibe", state.previousTools);
					}
				}
				break;
			}
		}
		updateStatus(ctx);
	});

	return getState;
}
