/**
 * Client half of text prediction: the unified daemon owns build/version
 * replacement (see `daemon/reexec.test.ts`); this client opens the `predict`
 * unit for its agent directory, leases it, and routes complete/feedback calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as daemonClient from "../src/daemon/client";
import type { DaemonClient } from "../src/daemon/protocol";
import { closeTextPrediction, requestTextPrediction, TextPredictionClient } from "../src/predict/client";
import { TEXT_PREDICT_KIND, type TextPredictReply } from "../src/predict/protocol";
import { rejectionOf } from "./helpers/rejection";

interface OpenRequest {
	kind: string;
	scope: string;
	key: string;
	params: {
		agentDir: string;
		historyDbPath: string;
		modelDir: string;
		stateDirs: Record<string, string>;
	};
}

interface CallRecord {
	method: string;
	params: unknown;
	unit: string;
}

function fakeDaemon(reply: (method: string, params: unknown) => TextPredictReply<unknown>) {
	const opens: OpenRequest[] = [];
	const calls: CallRecord[] = [];
	const released: string[] = [];
	const client = {
		async open(request: OpenRequest) {
			opens.push(request);
			return { unit: { id: "predict-unit" }, lease: "predict-lease" };
		},
		async call(kind: string, method: string, params: unknown, options: { unit: string }) {
			expect(kind).toBe(TEXT_PREDICT_KIND);
			calls.push({ method, params, unit: options.unit });
			return reply(method, params);
		},
		async release(lease: string) {
			released.push(lease);
		},
		onReconnect() {
			return () => {};
		},
	} as unknown as DaemonClient;
	return { client, opens, calls, released };
}

beforeEach(closeTextPrediction);

afterEach(() => {
	closeTextPrediction();
	vi.restoreAllMocks();
});

describe("text-predict client", () => {
	it("opens the predict unit for its agent directory and reuses it across calls", async () => {
		const daemon = fakeDaemon(() => ({
			ok: true,
			value: { suffix: "ady", confidence: 0.9 },
		}));
		const daemonSpy = vi.spyOn(daemonClient, "daemonClient").mockResolvedValue(daemon.client);
		const client = new TextPredictionClient({ agentDirectory: "/agent/dir", downloadWeights: false });

		try {
			const prediction = await client.complete("ngram", "please ", "re");
			expect(prediction).toEqual({
				engine: "ngram",
				suggestion: { suffix: "ady", confidence: 0.9 },
			});
			expect(daemon.opens).toHaveLength(1);
			expect(daemon.opens[0]).toMatchObject({
				kind: TEXT_PREDICT_KIND,
				params: { agentDir: "/agent/dir" },
			});
			expect(daemon.calls).toEqual([
				{
					method: "complete",
					params: { method: "ngram", before: "please ", prefix: "re" },
					unit: "predict-unit",
				},
			]);

			await client.complete("ngram", "please ", "re");
			expect(daemon.opens).toHaveLength(1);
			expect(daemon.calls).toHaveLength(2);
		} finally {
			daemonSpy.mockRestore();
		}
	});

	it("surfaces an engine error reply and keeps the unit open for the next call", async () => {
		const daemon = fakeDaemon(() => ({ ok: false, error: "ngram failed to load" }));
		const daemonSpy = vi.spyOn(daemonClient, "daemonClient").mockResolvedValue(daemon.client);
		const client = new TextPredictionClient({ agentDirectory: "/agent/dir", downloadWeights: false });

		try {
			const error = await rejectionOf(client.complete("ngram", "before ", "p"));
			expect(error).toMatchObject({ message: "text-predict complete: ngram failed to load" });

			await rejectionOf(client.complete("ngram", "before ", "p"));
			expect(daemon.opens).toHaveLength(1);
			expect(daemon.calls).toHaveLength(2);
		} finally {
			daemonSpy.mockRestore();
		}
	});

	it("releases the lease when the client closes", async () => {
		const daemon = fakeDaemon(() => ({ ok: true, value: null }));
		const daemonSpy = vi.spyOn(daemonClient, "daemonClient").mockResolvedValue(daemon.client);
		const client = new TextPredictionClient({ agentDirectory: "/agent/dir", downloadWeights: false });

		try {
			await client.complete("ngram", "before ", "p");
			client.close();
			expect(daemon.released).toEqual(["predict-lease"]);
		} finally {
			daemonSpy.mockRestore();
		}
	});

	it("does not retry a daemon that could not be reached", async () => {
		const daemonSpy = vi
			.spyOn(daemonClient, "daemonClient")
			.mockRejectedValue(new Error("The zetacode daemon did not answer"));
		try {
			const error = await rejectionOf(requestTextPrediction("ngram", "please ", "re"));
			expect(error).toMatchObject({ message: "The zetacode daemon did not answer" });

			const second = await rejectionOf(requestTextPrediction("ngram", "please ", "re"));
			expect(second).toMatchObject({ message: "text-predict unavailable" });
			expect(daemonSpy).toHaveBeenCalledTimes(1);
		} finally {
			daemonSpy.mockRestore();
		}
	});
});
