/**
 * Contract between zetacode processes and the daemon's `predict` module
 * (`daemon/modules/predict.ts`).
 *
 * One daemon per agent directory runs under the `text-predict` global daemon
 * broker (`zetacode ps --global text-predict`) and serves ghost-text word
 * completion to every zetacode process over newline-delimited JSON on a native IPC
 * endpoint (`ipcEndpoint`). Each request carries a numeric `id` echoed by its
 * response; responses may arrive out of order. The same agent directory is one
 * `predict` unit, reachable through `call("predict", method, params, { unit })`.
 */
import * as path from "node:path";
import { ipcEndpoint, type PredictedWord } from "@linxiraos/pi-natives";
export { TEXT_PREDICT_WORKER_ARG } from "../cli/worker-selectors";

/** Daemon module kind and `call` module name. */
export const TEXT_PREDICT_KIND = "predict";

/** Environment key carrying the endpoint the daemon listens on. */
export const TEXT_PREDICT_SOCKET_ENV = "ZETA_TEXT_PREDICT_SOCKET";

/** Environment key carrying the agent directory whose history and state the daemon serves. */
export const TEXT_PREDICT_AGENT_DIR_ENV = "ZETA_TEXT_PREDICT_AGENT_DIR";
export const TEXT_PREDICT_PROFILE_ENV = "ZETA_TEXT_PREDICT_PROFILE";
export type TextPredictProfile = "default" | "studio";

/** Broker readiness regex matched against {@link textPredictReadyBanner}. */
export const TEXT_PREDICT_READY_PATTERN = String.raw`zetacode text-predict listening on \S+`;

/** Engines the daemon can open (`TextPredictor` methods); clients resolve `auto` before asking. */
export type TextPredictMethod = "ngram" | "smollm" | "apple";

/** Every engine, for per-method parameters. */
export const TEXT_PREDICT_METHODS: readonly TextPredictMethod[] = ["ngram", "smollm", "apple"];

/** Banner printed on stdout once the daemon accepts connections. */
export function textPredictReadyBanner(endpoint: string): string {
	return `zetacode text-predict listening on ${endpoint}`;
}

/**
 * Unit key for one agent directory. Different agent directories (profiles,
 * tests) get separate units because history and learned state are per agent dir.
 */
export function textPredictKey(agentDir: string): string {
	return Bun.hash.wyhash(path.resolve(agentDir)).toString(16).padStart(16, "0").slice(0, 12);
}

/**
 * `open` params. Paths are resolved by the opening client: the daemon's own
 * environment belongs to whichever client started it.
 */
export interface TextPredictOpenParams {
	agentDir: string;
	/** `history.db` whose prompts the learning engines ingest. */
	historyDbPath: string;
	/** SmolLM weights directory. */
	modelDir: string;
	/** Persisted learned state per engine. */
	stateDirs: Record<TextPredictMethod, string>;
}

/** Daemon identity and IPC endpoint for one agent directory (and profile). */
export function textPredictDaemon(
	runtimeDir: string,
	agentDir: string,
	profile: TextPredictProfile = "default",
): { name: string; endpoint: string } {
	const identity = path.resolve(agentDir) + (profile === "studio" ? "|studio" : "");
	const key = Bun.hash.wyhash(identity).toString(16).padStart(16, "0").slice(0, 12);
	return { name: `zeta.text-predict.${key}`, endpoint: ipcEndpoint(runtimeDir, `text-predict-${key}`) };
}

/** `call` methods and their params/results. */
export interface TextPredictCalls {
	complete: {
		params: { method: TextPredictMethod; before: string; prefix: string };
		result: PredictedWord | null;
	};
	feedback: {
		params: { method: TextPredictMethod; before: string; prefix: string; suggestion: string; accepted: boolean };
		result: null;
	};
	/** Ingest history rows newer than each open engine's cursor. */
	sync: { params: Record<string, never>; result: { ingested: number } };
}

export type TextPredictCallMethod = keyof TextPredictCalls;

/**
 * What every `call` resolves to. Engine and request failures come back as
 * `{ ok: false }`, so a rejected `call` only ever means the transport or the
 * unit is gone.
 */
export type TextPredictReply<R> = { ok: true; value: R } | { ok: false; error: string };

/** Daemon → client request (newline-delimited JSON, numeric `id` per request). */
export type TextPredictRequest =
	| { id: number; op: "ping" }
	| { id: number; op: "complete"; method: TextPredictMethod; before: string; prefix: string }
	| {
			id: number;
			op: "feedback";
			method: TextPredictMethod;
			before: string;
			prefix: string;
			suggestion: string;
			accepted: boolean;
	  }
	/** Ingest history rows newer than each open engine's cursor. */
	| { id: number; op: "sync" }
	/** Persist and exit (a client found a daemon from another zetacode version). */
	| { id: number; op: "shutdown" };

/** Daemon → client response. */
export type TextPredictResponse =
	| {
			id: number;
			ok: true;
			op: "ping";
			version: string;
			pid: number;
			engines: TextPredictMethod[];
			profile?: TextPredictProfile;
			protocol?: number;
	  }
	| { id: number; ok: true; op: "complete"; suggestion: PredictedWord | null }
	| { id: number; ok: true; op: "feedback" | "shutdown" }
	| { id: number; ok: true; op: "sync"; ingested: number }
	| { id: number; ok: false; error: string };
