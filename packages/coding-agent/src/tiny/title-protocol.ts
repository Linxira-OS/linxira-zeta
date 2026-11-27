import type { TinyLocalModelKey } from "./models";

/**
 * Wire protocol between `TinyTitleClient` and a tiny-model worker.
 *
 * One worker per local model: the ONNX worker (`worker.ts`, the zetacode binary
 * re-entered with {@link TINY_WORKER_ARG}) or the MLX worker (`mlx-server.py`),
 * each a child of the zetacode daemon's `infer` module. The worker speaks this
 * newline-delimited JSON over stdin/stdout; clients speak the same lines over
 * their daemon tunnel and the daemon rewrites request ids. Requests are
 * message-level so both workers render the chat template with their own
 * tokenizer; the client owns prompt construction and title extraction.
 */

/**
 * Hidden subcommand on the main CLI that boots the ONNX tiny-model worker.
 * Kept in sync with the dispatch in `cli.ts`.
 */
export const TINY_WORKER_ARG = "__zeta_worker_tiny_inference";
/** Env var carrying the endpoint the ONNX worker must own. */
export const TINY_WORKER_SOCKET_ENV = "ZETA_TINY_WORKER_SOCKET";
/** Env var naming the single local model the ONNX worker serves. */
export const TINY_WORKER_MODEL_ENV = "ZETA_TINY_WORKER_MODEL";
/** Env var carrying the launch tag the worker echoes in `pong` so stale workers get replaced. */
export const TINY_WORKER_TAG_ENV = "ZETA_TINY_WORKER_TAG";
/** Env var overriding the idle exit window (milliseconds); for tests. */
export const TINY_WORKER_IDLE_MS_ENV = "ZETA_TINY_WORKER_IDLE_MS";
/** Idle window (nothing in flight, no request received) after which a worker exits to free model memory. */
export const TINY_WORKER_IDLE_MS = 15 * 60 * 1_000;

/** Inference engine a worker runs; part of the unit key so ONNX and MLX workers for one model coexist. */
export type TinyWorkerBackend = "onnx" | "mlx";

/** Stable unit name for one local model on one inference backend. */
export function tinyWorkerName(model: string, backend: TinyWorkerBackend): string {
	return `tiny-${model}-${backend}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

export type TinyTitleProgressStatus =
	| "initiate"
	| "download"
	| "progress"
	| "progress_total"
	| "done"
	| "ready"
	| "error";

export interface TinyTitleProgressFileState {
	loaded: number;
	total: number;
}

export interface TinyTitleProgressEvent {
	modelKey: TinyLocalModelKey;
	status: TinyTitleProgressStatus;
	name?: string;
	file?: string;
	progress?: number;
	loaded?: number;
	total?: number;
	files?: Record<string, TinyTitleProgressFileState>;
	task?: string;
	model?: string;
}

/** Chat turn handed to a worker; the worker renders it with the model's own chat template. */
export interface TinyChatMessage {
	role: "system" | "user";
	content: string;
}

export type TinyWorkerRequest =
	| { type: "ping"; id: string }
	| { type: "shutdown"; id: string }
	/** Download (if needed) and load the worker's model, streaming `progress` then `loaded`. */
	| { type: "load"; id: string }
	/** One greedy generation; loads the model first when it is not resident. Replies with generated text only. */
	| {
			type: "chat";
			id: string;
			messages: readonly TinyChatMessage[];
			/** Appended verbatim after the generation prompt so the model continues it. */
			prefill?: string;
			/** Stop once this text appears in the generated output. */
			stop?: string;
			maxNewTokens: number;
	  };

export type TinyWorkerResponse =
	| { type: "pong"; id: string; tag?: string }
	| { type: "progress"; id: string; event: TinyTitleProgressEvent }
	| { type: "loaded"; id: string }
	| { type: "text"; id: string; text: string }
	| { type: "error"; id: string; error: string };
