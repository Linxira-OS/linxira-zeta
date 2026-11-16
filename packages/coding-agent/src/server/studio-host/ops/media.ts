/**
 * `media.*` — Studio image and video jobs, one family for all seven commands.
 *
 * The semantic operation names already exist in `protocol/contracts/media.ts`;
 * this file supplies the Host side. Inputs arrive as `CommandInput` without a
 * `kind`, so every handler builds the known operation itself. Nothing here
 * accepts renderer paths, transfer grants, provider endpoints or audio work:
 * speech/transcription and video audio generation are owner-held and refused.
 */
import { isRecord } from "@linxiraos/pi-utils";
import { invalid, unavailable } from "../errors.js";
import type { MediaOperation, MediaRequest, MediaResultMap } from "../protocol/contracts/media.js";
import type { OperatorStateSnapshot } from "../protocol/index.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { snapshotFor } from "./session.js";
import { isMediaJobId, MediaServiceError, validateMediaRequest } from "../services/media-service.js";
import { studioMediaRuntime } from "../services/media-runtime.js";

type OperationKind = MediaOperation["kind"];
type OperationInput<K extends OperationKind> = Omit<Extract<MediaOperation, { kind: K }>, "kind" | "inputTransfers">;
const SPECIAL_KEYS: readonly string[] = ["__proto__", "prototype", "constructor"];

function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!isRecord(value)) throw invalid("Expected a media command object");
	for (const key of Object.keys(value)) {
		if (SPECIAL_KEYS.includes(key) || !keys.includes(key)) throw invalid("Unknown media command field");
	}
	return value;
}

function textValue(value: unknown, max: number): string {
	if (typeof value !== "string" || value.trim() === "" || value.includes("\u0000") || value.length > max) {
		throw invalid("Invalid media text");
	}
	return value;
}

function opError(error: unknown): Error {
	if (error instanceof MediaServiceError) {
		return error.code === "INVALID_ARGUMENT" ? invalid(error.message) : unavailable(error.message);
	}
	// Native filesystem/provider causes may carry paths or endpoints; never echo them.
	return unavailable("Media operation failed");
}

function buildOperation<K extends OperationKind>(
	kind: K,
	input: OperationInput<K>,
): Extract<MediaOperation, { kind: K }> {
	const fields =
		kind === "media.models"
			? ["sessionId", "cursor"]
			: kind === "media.start"
				? ["sessionId", "request"]
				: kind === "media.list"
					? ["sessionId"]
					: ["sessionId", "id"];
	const row = closedObject(input, fields);
	const sessionId = textValue(row.sessionId, 512);
	if (kind === "media.models") {
		const cursor = row.cursor === undefined ? undefined : textValue(row.cursor, 512);
		return { kind, sessionId, ...(cursor === undefined ? {} : { cursor }) } as Extract<MediaOperation, { kind: K }>;
	}
	if (kind === "media.list") return { kind, sessionId } as Extract<MediaOperation, { kind: K }>;
	if (kind === "media.start") {
		try {
			validateMediaRequest(row.request);
		} catch (error) {
			throw opError(error);
		}
		return { kind, sessionId, request: row.request as MediaRequest } as Extract<MediaOperation, { kind: K }>;
	}
	if (!isMediaJobId(row.id)) throw invalid("Invalid media task id");
	return { kind, sessionId, id: row.id } as Extract<MediaOperation, { kind: K }>;
}

async function execute<K extends OperationKind>(
	kind: K,
	input: OperationInput<K>,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: MediaResultMap[K] }> {
	const operation = buildOperation(kind, input);
	const runtime = await studioMediaRuntime({ sessionId: operation.sessionId }, context);
	runtime.assertCurrent();
	let result: MediaResultMap[K];
	try {
		result = (await runtime.service.execute(operation)) as MediaResultMap[K];
	} catch (error) {
		throw opError(error);
	}
	runtime.assertCurrent();
	const snapshot = await snapshotFor(operation.sessionId);
	runtime.assertCurrent();
	return { snapshot, result };
}

export const mediaOps: StudioFamily = {
	id: "media",
	commands: {
		"media.models": (input, context) => execute("media.models", input, context),
		"media.list": (input, context) => execute("media.list", input, context),
		"media.start": (input, context) => execute("media.start", input, context),
		"media.read": (input, context) => execute("media.read", input, context),
		"media.cancel": (input, context) => execute("media.cancel", input, context),
		"media.resume": (input, context) => execute("media.resume", input, context),
		"media.close": (input, context) => execute("media.close", input, context),
	},
};
