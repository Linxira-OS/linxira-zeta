import { isWordCompletionMethod } from "@linxiraos/pi-tui/prompt/word-completion";
import { invalid } from "../errors";
import type { PredictionChannelOperation, PredictionResultMap } from "../protocol/contracts/prediction-channel";
import type { StudioFamily, StudioHostContext } from "../registry";
import { predictionRuntime } from "../services/prediction-runtime";
import { snapshotFor } from "./session";

function check(operation: PredictionChannelOperation): void {
	if (typeof operation.sessionId !== "string" || !operation.sessionId || operation.sessionId.length > 512 || operation.sessionId.includes("\0"))
		throw invalid("Invalid prediction session");
	if (operation.kind === "prediction.configure" && (!isWordCompletionMethod(operation.method) || !["session", "global"].includes(operation.scope)))
		throw invalid("Invalid prediction setting");
	if (operation.kind === "prediction.prepare" && operation.protocolVersion !== undefined && operation.protocolVersion !== 2)
		throw invalid("Invalid prediction protocol");
	if (operation.kind === "prediction.release" && (typeof operation.channelId !== "string" || !/^[a-f0-9-]{36}$/u.test(operation.channelId)))
		throw invalid("Invalid prediction channel");
}
async function execute<K extends PredictionChannelOperation["kind"]>(kind: K, input: Omit<Extract<PredictionChannelOperation, { kind: K }>, "kind">, context: StudioHostContext) {
	const operation = { ...input, kind } as PredictionChannelOperation;
	check(operation);
	const runtime = await predictionRuntime(operation, context);
	runtime.assertCurrent();
	const result = await runtime.service.execute(operation, runtime.view) as PredictionResultMap[K];
	runtime.assertCurrent();
	const snapshot = await snapshotFor(operation.sessionId);
	runtime.assertCurrent();
	return { snapshot, result };
}
export const predictionOps: StudioFamily = {
	id: "prediction",
	queries: {
		"prediction.query": async (input, context) => {
			if (!Number.isSafeInteger(input.version) || input.version < 0 || typeof input.before !== "string" || input.before.length > 8192 || typeof input.prefix !== "string" || input.prefix.length > 256 || input.before.includes("\0") || input.prefix.includes("\0"))
				throw invalid("Invalid prediction query");
			const runtime = await predictionRuntime(input, context);
			const result = await runtime.service.query(input);
			runtime.assertCurrent();
			return result;
		},
	},
	commands: {
		"prediction.status": (input, context) => execute("prediction.status", input, context),
		"prediction.configure": (input, context) => execute("prediction.configure", input, context),
		"prediction.clearOverride": (input, context) => execute("prediction.clearOverride", input, context),
		"prediction.download.cancel": (input, context) => execute("prediction.download.cancel", input, context),
		"prediction.prepare": (input, context) => execute("prediction.prepare", input, context),
		"prediction.release": (input, context) => execute("prediction.release", input, context),
		"prediction.control": async (input, context) => {
			if (!["status", "clear", "import", "download", "cancel"].includes(input.action)) throw invalid("Invalid prediction action");
			const runtime = await predictionRuntime(input, context);
			const result = await runtime.service.control(input.action, runtime.assertCurrent);
			runtime.assertCurrent();
			const snapshot = await snapshotFor(input.sessionId);
			runtime.assertCurrent();
			return { snapshot, result };
		},
	},
};
