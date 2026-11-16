/**
 * Cross-process contract for the machine-global text-prediction daemon.
 *
 * One daemon per agent directory runs under the `text-predict` global daemon
 * broker (`zetacode ps --global text-predict`) and serves ghost-text word
 * completion to every omp process over newline-delimited JSON on a native IPC
 * endpoint (`ipcEndpoint`). Each request carries a numeric `id` echoed by its
 * response; responses may arrive out of order.
 */
import * as path from "node:path";
import { ipcEndpoint, type PredictedWord } from "@linxiraos/pi-natives";
export { TEXT_PREDICT_WORKER_ARG } from "../cli/worker-selectors";

/** Global broker scope owning the daemon. */
export const TEXT_PREDICT_BROKER_SCOPE = "text-predict";

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

/** Banner printed on stdout once the daemon accepts connections. */
export function textPredictReadyBanner(endpoint: string): string {
	return `zetacode text-predict listening on ${endpoint}`;
}

/**
 * Daemon identity for one agent directory: the broker daemon name and its
 * endpoint inside the broker runtime dir. Different agent directories (profiles,
 * tests) get separate daemons because history and learned state are per agent dir.
 */
export function textPredictDaemon(
	runtimeDir: string,
	agentDir: string,
	profile: TextPredictProfile = "default",
): { name: string; endpoint: string } {
	const identity = path.resolve(agentDir) + (profile === "studio" ? "|studio" : "");
	const key = Bun.hash.wyhash(identity).toString(16).padStart(16, "0").slice(0, 12);
	return { name: `zeta.text-predict.${key}`, endpoint: ipcEndpoint(runtimeDir, `text-predict-${key}`) };
}

/** Client → daemon request. */
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
