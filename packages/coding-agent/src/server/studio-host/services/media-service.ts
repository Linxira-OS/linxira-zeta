/**
 * Studio image and video jobs.
 *
 * Ported from the official Studio v0.2.1 media state machine, narrowed to the
 * kinds Zeta owns natively. Speech and transcription stay with the audio owner
 * and are rejected before any model, credential or device is touched.
 *
 * Invariants:
 * - only an explicit `media.start` submits billable provider work;
 * - a restart marks unfinished jobs interrupted and never resubmits them;
 * - only a confirmed remote video job may resume polling;
 * - closing a terminal job waits for its writers, then removes outputs and
 *   metadata;
 * - bytes flow through the exact session's artifact owner, never a media
 *   library, renderer path or public transfer grant.
 */
import { randomUUID } from "node:crypto";
import { generateImage, isImageGenerationApi, type Model } from "@linxiraos/pi-ai";
import { ProviderHttpError } from "@linxiraos/pi-ai/error";
import type { ImageGenerationRequest } from "@linxiraos/pi-ai/images";
import { downloadVideo, pollVideo, submitVideo, type VideoGenerationRequest } from "@linxiraos/pi-ai/video";
import { modelKind } from "@linxiraos/pi-catalog/types";
import { isRecord } from "@linxiraos/pi-utils";
import { resolveRoleChain } from "../../../config/model-resolver.js";
import { roleCandidatePool } from "../../../config/model-roles.js";
import type { ModelRegistry } from "../../../config/model-registry.js";
import type { Settings } from "../../../config/settings.js";
import { resolveHostedImageCarrier } from "../../../tools/image-gen.js";
import {
	type MediaDetail,
	type MediaJob,
	type MediaModelChoice,
	type MediaOperation,
	type MediaOutput,
	type MediaRequest,
	mediaInputArtifacts,
} from "../protocol/contracts/media.js";
import {
	type SessionMediaArtifactPort,
	STUDIO_MEDIA_ARTIFACT_MAX_BYTES,
	type StudioMediaJobStore,
} from "./media-files.js";

export type MediaServiceErrorCode = "INVALID_ARGUMENT" | "COMMAND_BLOCKED";

/** A native refusal with a public-safe sentence; raw causes never reach the client. */
export class MediaServiceError extends Error {
	constructor(
		readonly code: MediaServiceErrorCode,
		message: string,
	) {
		super(message);
		this.name = "MediaServiceError";
	}
}

interface StoredJob extends MediaDetail {
	schemaVersion: 1;
	instance: string;
	remoteJobId?: string;
}

interface Task {
	stored: StoredJob;
	controller: AbortController;
	tail: Promise<void>;
	promise?: Promise<void>;
}

/** Exact live session facts; an AgentSession satisfies this without its full surface. */
export interface StudioMediaSession {
	readonly sessionId: string;
	readonly settings: Settings;
	readonly modelRegistry: Pick<
		ModelRegistry,
		"getAvailable" | "getAll" | "getError" | "resolver" | "resolveModelHeaders"
	>;
	readonly model?: Model | undefined;
	readonly isDisposed: boolean;
}

export interface StudioMediaDependencies {
	/** Session-bound native artifact port. */
	port?: SessionMediaArtifactPort;
	/** Private, bounded job metadata store. */
	jobs?: StudioMediaJobStore;
	generateImage?: typeof generateImage;
	submitVideo?: typeof submitVideo;
	pollVideo?: typeof pollVideo;
	downloadVideo?: typeof downloadVideo;
	pollIntervalMs?: number;
	/** Native identity fence; the runtime binds it to the resident session. */
	isCurrent?: () => boolean;
}

const ACTIVE_STATES: readonly MediaJob["state"][] = ["queued", "running", "waiting"];
const MAX_ACTIVE_JOBS = 4;
const MAX_RETAINED_JOBS = 50;
const MAX_IMAGE_OUTPUTS = 4;
const MAX_TEXT = 60_000;
const JOB_ID = /^[a-f0-9-]{36}$/u;
const ARTIFACT_REF = /^[A-Za-z0-9_-]{1,512}$/u;
const SPECIAL_KEYS: readonly string[] = ["__proto__", "prototype", "constructor"];
const EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"video/mp4": "mp4",
	"video/webm": "webm",
};
const active = (job: MediaJob) => ACTIVE_STATES.includes(job.state);

export function isMediaJobId(value: unknown): value is string {
	return typeof value === "string" && value.length === 36 && JOB_ID.test(value);
}

function fail(message: string): never {
	throw new MediaServiceError("INVALID_ARGUMENT", message);
}

function held(message: string): never {
	throw new MediaServiceError("COMMAND_BLOCKED", message);
}

function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!isRecord(value)) fail("Expected a media object");
	for (const key of Object.keys(value)) {
		if (SPECIAL_KEYS.includes(key) || !keys.includes(key)) fail("Unknown media field");
	}
	return value;
}

function text(value: unknown, max: number, empty = false): string {
	if (typeof value !== "string" || (!empty && value.trim() === "") || value.includes("\u0000") || value.length > max) {
		fail("Invalid media text");
	}
	return value;
}

function artifactRef(value: unknown): string {
	if (typeof value !== "string" || !ARTIFACT_REF.test(value)) fail("Invalid media artifact");
	return value;
}

function numberValue(value: unknown, min: number, max: number, integer = false): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isSafeInteger(value))
	) {
		fail("Invalid media number");
	}
	return value;
}

function jsonValue(value: unknown, depth = 0): void {
	if (depth > 8) fail("Media options are too deeply nested");
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "string") {
		if (value.length > 8000 || value.includes("\u0000")) fail("Media option is too large");
		return;
	}
	if (typeof value === "number") {
		numberValue(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 64) fail("Too many media options");
		for (const item of value) jsonValue(item, depth + 1);
		return;
	}
	if (!isRecord(value)) fail("Invalid media option");
	const keys = Object.keys(value);
	if (keys.some(key => SPECIAL_KEYS.includes(key)) || keys.length > 64) fail("Invalid media option");
	for (const item of Object.values(value)) jsonValue(item, depth + 1);
}

/**
 * Untrusted request validation, invoked by the operation layer and again by
 * the native worker before a job is recorded.
 */
export function validateMediaRequest(value: unknown): asserts value is MediaRequest {
	const kind = isRecord(value) ? value.type : undefined;
	if (kind === "speech" || kind === "transcription") {
		held("Speech and transcription are held by the audio owner in this build");
	}
	if (kind !== "image" && kind !== "video") fail("Unknown media kind");
	const fields =
		kind === "image"
			? ["prompt", "inputArtifacts", "aspectRatio", "imageSize", "count"]
			: [
					"prompt",
					"duration",
					"resolution",
					"aspectRatio",
					"size",
					"firstFrame",
					"lastFrame",
					"references",
					"generateAudio",
					"seed",
					"creativity",
					"upscaleFactor",
					"providerOptions",
				];
	const input = closedObject(value, ["type", "model", ...fields]);
	if (input.model !== undefined || kind === "video") text(input.model, 512);
	if (kind === "image" || input.prompt !== undefined) text(input.prompt, 32000);
	for (const field of ["aspectRatio", "imageSize", "resolution", "size"]) {
		if (input[field] !== undefined) text(input[field], 128);
	}
	if (kind === "image") {
		if (input.count !== undefined) numberValue(input.count, 1, 4, true);
		if (input.inputArtifacts !== undefined) {
			if (!Array.isArray(input.inputArtifacts) || input.inputArtifacts.length > 8) {
				fail("Use at most 8 input images");
			}
			for (const artifact of input.inputArtifacts) artifactRef(artifact);
		}
		return;
	}
	for (const field of ["firstFrame", "lastFrame"]) {
		if (input[field] !== undefined) artifactRef(input[field]);
	}
	if (input.references !== undefined) {
		if (!Array.isArray(input.references) || input.references.length > 8) fail("Too many video references");
		for (const reference of input.references) {
			const row = closedObject(reference, ["artifactId", "type"]);
			artifactRef(row.artifactId);
			if (row.type === "audio") {
				held("Audio references are held by the audio owner in this build");
			}
			if (row.type !== "image" && row.type !== "video") fail("Invalid video reference");
		}
	}
	if (input.duration !== undefined) numberValue(input.duration, 1, 120);
	if (input.seed !== undefined) numberValue(input.seed, 0, 2_147_483_647, true);
	if (input.creativity !== undefined) numberValue(input.creativity, 0, 1);
	if (input.upscaleFactor !== undefined) numberValue(input.upscaleFactor, 1, 4);
	if (input.generateAudio !== undefined) {
		if (typeof input.generateAudio !== "boolean") fail("Invalid video audio flag");
		if (input.generateAudio) held("Video audio generation is held by the audio owner in this build");
	}
	if (input.providerOptions !== undefined) {
		if (!isRecord(input.providerOptions)) fail("Invalid provider options");
		jsonValue(input.providerOptions);
		if (JSON.stringify(input.providerOptions).length > 16_000) fail("Provider options exceed 16 KB");
	}
}

/** Model choices shown to Studio. Audio roles are deliberately absent. */
export function describeMediaModel(model: Model): MediaModelChoice | undefined {
	const base = {
		selector: `${model.provider}/${model.id}`,
		name: model.name.slice(0, 512),
		api: model.api,
		local: model.api === "local-inference",
	};
	if (modelKind(model) === "image" && isImageGenerationApi(model.api)) {
		return {
			...base,
			kind: "image",
			parameters: [
				"prompt",
				"inputArtifacts",
				"aspectRatio",
				"imageSize",
				...(["openai-responses", "openai-codex-responses"].includes(model.api) ? [] : ["count"]),
			],
		};
	}
	if (modelKind(model) === "video" && model.api === "openrouter-video") {
		return {
			...base,
			kind: "video",
			parameters: [
				"prompt",
				"duration",
				"resolution",
				"aspectRatio",
				"size",
				"firstFrame",
				"lastFrame",
				"references",
				"generateAudio",
				"seed",
				"creativity",
				"upscaleFactor",
				"providerOptions",
			],
		};
	}
	return undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	if (signal.aborted) {
		reject(signal.reason);
		return promise;
	}
	const aborted = () => {
		clearTimeout(timer);
		reject(signal.reason);
	};
	const timer = setTimeout(() => {
		signal.removeEventListener("abort", aborted);
		resolve();
	}, ms);
	signal.addEventListener("abort", aborted, { once: true });
	return promise;
}

function errorText(cause: unknown): string {
	if (cause instanceof MediaServiceError) return cause.message;
	if (cause instanceof ProviderHttpError) {
		return `Provider request failed (HTTP ${cause.status ?? "error"}). Check the selected model, supported parameters and account status.`;
	}
	return "Media processing failed. Check the model, its credentials, input format and available local dependencies.";
}

function storedJob(value: unknown, sessionId: string): StoredJob | undefined {
	if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
	const instance = value.instance;
	const job = value.job;
	const outputs = value.outputs;
	if (typeof instance !== "string" || !isRecord(job) || !Array.isArray(outputs)) return undefined;
	const id = job.id;
	const rawKind = job.type;
	const state = job.state;
	const createdAt = job.createdAt;
	const updatedAt = job.updatedAt;
	const canResume = job.canResume;
	const outputCount = job.outputCount;
	const model = job.model;
	const cost = job.cost;
	const jobError = job.error;
	const remoteJobId = value.remoteJobId;
	const text = value.text;
	const textTruncated = value.textTruncated;
	if (!isMediaJobId(id) || job.sessionId !== sessionId) return undefined;
	if (rawKind !== "image" && rawKind !== "video") return undefined;
	const kind = rawKind;
	if (
		typeof state !== "string" ||
		(!ACTIVE_STATES.includes(state as MediaJob["state"]) &&
			!["paused", "completed", "cancelled", "failed", "interrupted"].includes(state)) ||
		typeof createdAt !== "number" ||
		!Number.isSafeInteger(createdAt) ||
		createdAt < 0 ||
		typeof updatedAt !== "number" ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt < 0 ||
		typeof canResume !== "boolean" ||
		typeof outputCount !== "number" ||
		!Number.isSafeInteger(outputCount) ||
		outputCount < 0 ||
		outputCount > MAX_IMAGE_OUTPUTS ||
		outputs.length > MAX_IMAGE_OUTPUTS
	) {
		return undefined;
	}
	if (model !== undefined && (typeof model !== "string" || model.length > 512)) return undefined;
	if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost))) return undefined;
	if (jobError !== undefined && (typeof jobError !== "string" || jobError.length > 2000)) return undefined;
	if (text !== undefined && (typeof text !== "string" || text.length > MAX_TEXT)) return undefined;
	if (textTruncated !== undefined && typeof textTruncated !== "boolean") return undefined;
	if (
		remoteJobId !== undefined &&
		(typeof remoteJobId !== "string" || remoteJobId === "" || remoteJobId.length > 512)
	) {
		return undefined;
	}
	const request = value.request;
	if (!isRecord(request)) return undefined;
	try {
		validateMediaRequest(request);
	} catch {
		return undefined;
	}
	if (request.type !== kind) return undefined;
	const checkedOutputs: MediaOutput[] = [];
	for (const output of outputs) {
		if (!isRecord(output)) return undefined;
		const outputId = output.artifactId;
		const outputKind = output.kind;
		const outputName = output.name;
		const outputMime = output.mimeType;
		const outputBytes = output.bytes;
		const outputSha = output.sha256;
		if (outputKind !== "image" && outputKind !== "video") return undefined;
		if (outputKind !== kind) return undefined;
		if (typeof outputId !== "string" || !ARTIFACT_REF.test(outputId)) return undefined;
		if (typeof outputName !== "string" || outputName === "" || outputName.length > 512) return undefined;
		if (typeof outputMime !== "string" || !outputMime.startsWith(`${outputKind}/`)) return undefined;
		if (
			typeof outputBytes !== "number" ||
			!Number.isSafeInteger(outputBytes) ||
			outputBytes < 1 ||
			outputBytes > STUDIO_MEDIA_ARTIFACT_MAX_BYTES
		) {
			return undefined;
		}
		if (typeof outputSha !== "string" || !/^[a-f0-9]{64}$/u.test(outputSha)) return undefined;
		checkedOutputs.push({
			artifactId: outputId,
			kind: outputKind,
			name: outputName,
			mimeType: outputMime,
			bytes: outputBytes,
			sha256: outputSha,
		});
	}
	return {
		schemaVersion: 1,
		instance,
		...(typeof remoteJobId === "string" ? { remoteJobId } : {}),
		job: {
			id,
			sessionId,
			type: kind,
			state: state as MediaJob["state"],
			createdAt,
			updatedAt,
			...(typeof model === "string" ? { model } : {}),
			...(typeof cost === "number" ? { cost } : {}),
			...(typeof jobError === "string" ? { error: jobError } : {}),
			canResume,
			outputCount,
		},
		request,
		outputs: checkedOutputs,
		...(typeof text === "string" ? { text } : {}),
		...(typeof textTruncated === "boolean" ? { textTruncated } : {}),
	};
}

/** Media remains owned by this AgentSession. Only explicit start submits billable work. */
export class StudioMediaService {
	readonly #instance = randomUUID();
	readonly #sessionId: string;
	readonly #tasks = new Map<string, Task>();
	readonly #port: SessionMediaArtifactPort | undefined;
	readonly #jobs: StudioMediaJobStore | undefined;
	#loaded: Promise<void> | undefined;
	#disposed = false;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(
		readonly session: StudioMediaSession,
		readonly dependencies: StudioMediaDependencies = {},
	) {
		this.#sessionId = session.sessionId;
		this.#port = dependencies.port;
		this.#jobs = dependencies.jobs;
	}

	get running(): boolean {
		return [...this.#tasks.values()].some(task => active(task.stored.job));
	}

	/** Stop every writer. The caller awaits {@link settle} for shutdown. */
	dispose(): void {
		this.#disposed = true;
		for (const task of this.#tasks.values()) task.controller.abort();
	}

	/** Wait until every worker has persisted its terminal state. */
	async settle(): Promise<void> {
		const tasks = [...this.#tasks.values()];
		await Promise.allSettled(tasks.map(task => task.promise));
		await Promise.allSettled(tasks.map(task => task.tail));
	}

	#current(): boolean {
		try {
			return (
				!this.#disposed &&
				!this.session.isDisposed &&
				this.session.sessionId === this.#sessionId &&
				(this.dependencies.isCurrent?.() ?? true)
			);
		} catch {
			return false;
		}
	}

	#assertCurrent(): void {
		if (!this.#current()) throw new MediaServiceError("COMMAND_BLOCKED", "Media session is no longer current");
	}

	async #load(): Promise<void> {
		if (!this.#jobs) return;
		this.#loaded ??= (async () => {
			for (const value of await this.#jobs!.readJobs(this.#sessionId)) {
				try {
					const record = storedJob(value, this.#sessionId);
					if (!record || this.#tasks.has(record.job.id)) continue;
					if (active(record.job)) {
						record.job.state = "interrupted";
						record.job.canResume = record.job.type === "video" && !!record.remoteJobId;
						record.job.error = record.job.canResume
							? "Runtime stopped while waiting. Resume queries the same remote video task."
							: "Runtime stopped before completion was confirmed. Check provider history before submitting again; a request may have been accepted and billed.";
					}
					this.#tasks.set(record.job.id, {
						stored: record,
						controller: new AbortController(),
						tail: Promise.resolve(),
					});
				} catch {
					/* Do not execute malformed stored jobs. */
				}
			}
		})();
		await this.#loaded;
	}

	#persist(task: Task): Promise<void> {
		task.stored.job.updatedAt = Date.now();
		const snapshot = structuredClone(task.stored);
		task.tail = task.tail.catch(() => {}).then(() => this.#jobs!.saveJob(this.#sessionId, snapshot.job.id, snapshot));
		return task.tail;
	}

	execute(operation: MediaOperation): Promise<unknown> {
		const work = this.#operations.then(() => this.#executeFenced(operation));
		this.#operations = work.catch(() => {});
		return work;
	}

	async #executeFenced(operation: MediaOperation): Promise<unknown> {
		if (this.#disposed || operation.sessionId !== this.#sessionId) {
			throw new MediaServiceError("COMMAND_BLOCKED", "Media actions require the current session");
		}
		await this.#load();
		this.#assertCurrent();
		const result = await this.#execute(operation);
		return structuredClone(result);
	}

	async #execute(operation: MediaOperation): Promise<unknown> {
		if (operation.kind === "media.models") {
			const models = this.session.modelRegistry
				.getAvailable("all")
				.map(describeMediaModel)
				.filter((model): model is MediaModelChoice => !!model)
				.sort((left, right) => left.selector.localeCompare(right.selector));
			const start = operation.cursor ? models.findIndex(model => model.selector > operation.cursor!) : 0;
			const page = start < 0 ? [] : models.slice(start, start + 100);
			return {
				available: !!this.#port && !!this.#jobs,
				models: page,
				...(start >= 0 && start + page.length < models.length && page.length
					? { nextCursor: page[page.length - 1]!.selector }
					: {}),
			};
		}
		const own = [...this.#tasks.values()].filter(task => task.stored.job.sessionId === operation.sessionId);
		if (operation.kind === "media.list") {
			return {
				available: !!this.#port && !!this.#jobs,
				jobs: own
					.map(task => task.stored.job)
					.sort((left, right) => right.createdAt - left.createdAt)
					.slice(0, MAX_RETAINED_JOBS),
			};
		}
		if (!this.#port || !this.#jobs) {
			throw new MediaServiceError(
				"COMMAND_BLOCKED",
				"The authenticated native media artifact channel is unavailable",
			);
		}
		if (operation.kind === "media.start") {
			validateMediaRequest(operation.request);
			if (own.length >= MAX_RETAINED_JOBS || own.filter(task => active(task.stored.job)).length >= MAX_ACTIVE_JOBS) {
				throw new MediaServiceError(
					"COMMAND_BLOCKED",
					`Keep at most ${MAX_ACTIVE_JOBS} active and ${MAX_RETAINED_JOBS} retained media tasks; close old tasks first`,
				);
			}
			mediaInputArtifacts(operation.request);
			this.#candidates(operation.request);
			const id = randomUUID();
			const task: Task = {
				stored: {
					schemaVersion: 1,
					instance: this.#instance,
					job: {
						id,
						sessionId: operation.sessionId,
						type: operation.request.type,
						state: "queued",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						canResume: false,
						outputCount: 0,
					},
					request: structuredClone(operation.request),
					outputs: [],
				},
				controller: new AbortController(),
				tail: Promise.resolve(),
			};
			this.#tasks.set(id, task);
			try {
				await this.#persist(task);
			} catch (error) {
				this.#tasks.delete(id);
				throw error;
			}
			this.#launch(task);
			return { job: task.stored.job };
		}
		const task = this.#tasks.get(operation.id);
		if (!task || task.stored.job.sessionId !== operation.sessionId) {
			throw new MediaServiceError("INVALID_ARGUMENT", "Media task is not available in this session");
		}
		if (operation.kind === "media.read") {
			const { job, request, outputs, text, textTruncated } = task.stored;
			return {
				job,
				request,
				outputs,
				...(text ? { text } : {}),
				...(textTruncated === undefined ? {} : { textTruncated }),
			};
		}
		if (operation.kind === "media.cancel") {
			task.controller.abort();
			if (!task.promise) task.stored.job.state = task.stored.remoteJobId ? "paused" : "cancelled";
			await this.#persist(task);
			return { job: task.stored.job };
		}
		if (operation.kind === "media.resume") {
			if (!active(task.stored.job)) await task.promise;
			if (
				!task.stored.remoteJobId ||
				!task.stored.job.canResume ||
				task.stored.job.type !== "video" ||
				active(task.stored.job)
			) {
				throw new MediaServiceError(
					"COMMAND_BLOCKED",
					"Only a stopped video task with a confirmed remote job can resume polling",
				);
			}
			this.#assertCurrent();
			task.controller = new AbortController();
			task.stored.job.state = "queued";
			delete task.stored.job.error;
			await this.#persist(task);
			this.#launch(task);
			return { job: task.stored.job };
		}
		if (active(task.stored.job)) {
			throw new MediaServiceError("COMMAND_BLOCKED", "Stop the task before closing it");
		}
		await task.promise;
		// Operations are serialized and the worker has settled: no writer can resurrect this job.
		await task.tail;
		this.#assertCurrent();
		// An output already gone (or removed with its session) must not strand metadata.
		for (const output of task.stored.outputs) await this.#port.remove(output.artifactId).catch(() => {});
		await this.#jobs.removeJob(operation.sessionId, operation.id);
		this.#tasks.delete(operation.id);
		return { closed: true };
	}

	#candidates(request: MediaRequest): Model[] {
		const role = "image";
		const pool =
			request.type === "video"
				? this.session.modelRegistry.getAvailable("all").filter(model => modelKind(model) === "video")
				: roleCandidatePool(role, this.session.settings, this.session.modelRegistry);
		const candidates = request.model
			? pool.filter(model => `${model.provider}/${model.id}` === request.model)
			: resolveRoleChain(role, this.session.settings, pool).map(candidate => candidate.model);
		const supported = candidates.filter(model => describeMediaModel(model)?.kind === request.type);
		if (!supported.length) {
			throw new MediaServiceError(
				"INVALID_ARGUMENT",
				"No supported model is available for this media role or selector",
			);
		}
		return supported;
	}

	#launch(task: Task): void {
		task.promise = this.#run(task).finally(() => {
			delete task.promise;
			if (!this.#current()) this.#tasks.delete(task.stored.job.id);
		});
		void task.promise.catch(() => {});
	}

	#checkedOutput(output: MediaOutput, kind: "image" | "video", written: number): MediaOutput {
		if (
			!output ||
			output.kind !== kind ||
			output.bytes !== written ||
			written < 1 ||
			written > STUDIO_MEDIA_ARTIFACT_MAX_BYTES ||
			!ARTIFACT_REF.test(output.artifactId) ||
			output.name === "" ||
			output.name.length > 512 ||
			output.name.includes("\u0000") ||
			!output.mimeType.startsWith(`${kind}/`) ||
			!EXTENSIONS[output.mimeType] ||
			!/^[a-f0-9]{64}$/u.test(output.sha256)
		) {
			throw new MediaServiceError("INVALID_ARGUMENT", "The native artifact owner rejected the media output");
		}
		return output;
	}

	async #run(task: Task): Promise<void> {
		const { stored, controller } = task;
		const { request, job } = stored;
		const signal = controller.signal;
		const port = this.#port!;
		const inputs = new Map<string, Promise<{ bytes: Uint8Array; meta: MediaOutput }>>();
		const input = (id: string, kind: "image" | "video"): Promise<{ bytes: Uint8Array; meta: MediaOutput }> => {
			let result = inputs.get(id);
			if (!result) {
				result = port.read(id, kind).then(value => {
					this.#assertCurrent();
					if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0) {
						throw new MediaServiceError("INVALID_ARGUMENT", "Media input is empty");
					}
					if (value.bytes.byteLength > STUDIO_MEDIA_ARTIFACT_MAX_BYTES) {
						throw new MediaServiceError("INVALID_ARGUMENT", "Media input exceeds the 28 MiB artifact limit");
					}
					const meta = value.meta;
					if (
						!meta ||
						meta.artifactId !== id ||
						meta.bytes !== value.bytes.byteLength ||
						meta.kind !== kind ||
						!meta.mimeType.startsWith(`${kind}/`) ||
						meta.name === "" ||
						meta.name.length > 512 ||
						meta.name.includes("\u0000")
					) {
						throw new MediaServiceError(
							"INVALID_ARGUMENT",
							"Media input does not match the requested artifact kind",
						);
					}
					return value;
				});
				inputs.set(id, result);
			}
			return result;
		};
		try {
			job.state = "running";
			await this.#persist(task);
			const candidates = this.#candidates(request);
			let succeeded = false;
			for (const model of candidates) {
				signal.throwIfAborted();
				this.#assertCurrent();
				const descriptor = describeMediaModel(model);
				if (!descriptor || descriptor.kind !== request.type) continue;
				for (const key of Object.keys(request)) {
					if (!["type", "model"].includes(key) && !descriptor.parameters.includes(key)) {
						throw new MediaServiceError(
							"INVALID_ARGUMENT",
							`The selected ${model.api} transport does not support ${key}`,
						);
					}
				}
				job.model = `${model.provider}/${model.id}`;
				await this.#persist(task);
				const resolved = {
					...model,
					resolveHeaders: (headerSignal?: AbortSignal) =>
						this.session.modelRegistry.resolveModelHeaders(model, headerSignal),
				};
				const apiKey = this.session.modelRegistry.resolver(model, job.sessionId);
				try {
					if (request.type === "image") {
						const imageInputs = await Promise.all(
							(request.inputArtifacts ?? []).map(async id => {
								const value = await input(id, "image");
								return {
									data: Buffer.from(value.bytes).toString("base64"),
									mimeType: value.meta.mimeType,
								};
							}),
						);
						this.#assertCurrent();
						const carrier = ["openai-responses", "openai-codex-responses"].includes(model.api)
							? resolveHostedImageCarrier(this.session.modelRegistry, model, this.session.model)
							: undefined;
						const imageRequest: ImageGenerationRequest = {
							prompt: request.prompt,
							inputImages: imageInputs,
							aspectRatio: request.aspectRatio,
							imageSize: request.imageSize,
							count: request.count ?? 1,
						};
						const result = await (this.dependencies.generateImage ?? generateImage)(resolved, imageRequest, {
							apiKey: carrier ? this.session.modelRegistry.resolver(carrier, job.sessionId) : apiKey,
							signal,
							sessionId: job.sessionId,
							...(carrier
								? {
										carrier: {
											...carrier,
											resolveHeaders: (headerSignal?: AbortSignal) =>
												this.session.modelRegistry.resolveModelHeaders(carrier, headerSignal),
										},
									}
								: {}),
						});
						this.#assertCurrent();
						if (result.images.length > MAX_IMAGE_OUTPUTS) throw new Error("Provider returned too many images");
						if (result.model?.trim()) {
							job.model = `${model.provider}/${result.model.replace(/[\u0000-\u001f]/g, "").slice(0, 512)}`;
						}
						for (const [index, image] of result.images.entries()) {
							if (typeof image.data !== "string" || image.data === "") {
								throw new Error("Provider returned an empty image");
							}
							const bytes = Buffer.from(image.data, "base64");
							if (bytes.byteLength === 0 || bytes.byteLength > STUDIO_MEDIA_ARTIFACT_MAX_BYTES) {
								throw new MediaServiceError(
									"INVALID_ARGUMENT",
									"Image output exceeds the 28 MiB artifact limit",
								);
							}
							const mimeType = image.mimeType;
							const extension = EXTENSIONS[mimeType];
							if (!extension || !mimeType.startsWith("image/")) {
								throw new MediaServiceError("INVALID_ARGUMENT", "Provider returned an unsupported image type");
							}
							const output = await port.write(
								{ kind: "image", name: `${job.id}-${index + 1}.${extension}`, mimeType },
								bytes,
							);
							this.#assertCurrent();
							stored.outputs.push(this.#checkedOutput(output, "image", bytes.byteLength));
						}
						if (result.text?.trim()) {
							stored.text = result.text.slice(0, MAX_TEXT);
							stored.textTruncated = result.text.length > MAX_TEXT;
						}
						job.cost = result.usage.cost.total;
					} else if (request.type === "video") {
						if (!stored.remoteJobId) {
							const url = async (id: string, kind: "image" | "video") => {
								const value = await input(id, kind);
								return `data:${value.meta.mimeType};base64,${Buffer.from(value.bytes).toString("base64")}`;
							};
							const frameImages: NonNullable<VideoGenerationRequest["frameImages"]> = [];
							if (request.firstFrame) {
								frameImages.push({
									type: "image_url",
									imageUrl: { url: await url(request.firstFrame, "image") },
									frameType: "first_frame",
								});
							}
							if (request.lastFrame) {
								frameImages.push({
									type: "image_url",
									imageUrl: { url: await url(request.lastFrame, "image") },
									frameType: "last_frame",
								});
							}
							const references: NonNullable<VideoGenerationRequest["inputReferences"]> = [];
							for (const reference of request.references ?? []) {
								if (reference.type === "audio") {
									throw new MediaServiceError(
										"COMMAND_BLOCKED",
										"Audio references are held by the audio owner in this build",
									);
								}
								const value = await url(reference.artifactId, reference.type);
								references.push(
									reference.type === "image"
										? { type: "image_url", imageUrl: { url: value } }
										: { type: "video_url", videoUrl: { url: value } },
								);
							}
							this.#assertCurrent();
							const remote = await (this.dependencies.submitVideo ?? submitVideo)(
								resolved,
								{
									prompt: request.prompt,
									duration: request.duration,
									resolution: request.resolution as VideoGenerationRequest["resolution"],
									aspectRatio: request.aspectRatio as VideoGenerationRequest["aspectRatio"],
									size: request.size,
									generateAudio: request.generateAudio,
									seed: request.seed,
									creativity: request.creativity,
									upscaleFactor: request.upscaleFactor,
									frameImages,
									inputReferences: references,
									...(request.providerOptions ? { provider: { options: request.providerOptions } } : {}),
									sessionId: job.sessionId,
								},
								{ apiKey, signal },
							);
							this.#assertCurrent();
							if (
								typeof remote.id !== "string" ||
								remote.id === "" ||
								remote.id.length > 512 ||
								remote.id.includes("\u0000")
							) {
								throw new Error("Provider did not return a usable video job id");
							}
							stored.remoteJobId = remote.id;
							job.canResume = true;
							await this.#persist(task);
						}
						job.state = "waiting";
						await this.#persist(task);
						for (;;) {
							signal.throwIfAborted();
							this.#assertCurrent();
							const remote = await (this.dependencies.pollVideo ?? pollVideo)(resolved, stored.remoteJobId!, {
								apiKey,
								signal,
							});
							this.#assertCurrent();
							if (remote.usage) job.cost = remote.usage.cost.total;
							if (remote.status === "completed") break;
							if (["failed", "cancelled", "expired"].includes(remote.status)) {
								throw new MediaServiceError(
									"INVALID_ARGUMENT",
									`The provider reports this video task as ${remote.status}`,
								);
							}
							await delay(this.dependencies.pollIntervalMs ?? 5000, signal);
						}
						const content = await (this.dependencies.downloadVideo ?? downloadVideo)(
							resolved,
							stored.remoteJobId!,
							{ apiKey, signal },
						);
						this.#assertCurrent();
						const mimeType = (content.contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
						if (!["video/mp4", "video/webm"].includes(mimeType)) {
							await content.body.cancel();
							throw new MediaServiceError("INVALID_ARGUMENT", "Provider returned an unsupported video type");
						}
						if (content.contentLength !== undefined && content.contentLength > STUDIO_MEDIA_ARTIFACT_MAX_BYTES) {
							await content.body.cancel();
							throw new MediaServiceError("INVALID_ARGUMENT", "Video output exceeds the 28 MiB artifact limit");
						}
						const reader = content.body.getReader();
						const chunks: Uint8Array[] = [];
						let total = 0;
						try {
							for (;;) {
								this.#assertCurrent();
								const next = await reader.read();
								if (next.done) break;
								total += next.value.byteLength;
								if (total > STUDIO_MEDIA_ARTIFACT_MAX_BYTES) {
									throw new MediaServiceError(
										"INVALID_ARGUMENT",
										"Video output exceeds the 28 MiB artifact limit",
									);
								}
								chunks.push(next.value);
							}
						} catch (error) {
							await reader.cancel().catch(() => {});
							throw error;
						}
						if (total === 0) throw new Error("Provider returned an empty video");
						const bytes = new Uint8Array(total);
						let offset = 0;
						for (const chunk of chunks) {
							bytes.set(chunk, offset);
							offset += chunk.byteLength;
						}
						const extension = EXTENSIONS[mimeType];
						const output = await port.write({ kind: "video", name: `${job.id}.${extension}`, mimeType }, bytes);
						this.#assertCurrent();
						stored.outputs.push(this.#checkedOutput(output, "video", bytes.byteLength));
					} else {
						throw new MediaServiceError("COMMAND_BLOCKED", "This media kind is owner-held");
					}
					succeeded = true;
					break;
				} catch (error) {
					if (
						!(error instanceof ProviderHttpError) ||
						signal.aborted ||
						request.type === "video" ||
						request.model
					) {
						throw error;
					}
				}
			}
			if (!succeeded) throw new Error("All media role candidates failed");
			job.outputCount = stored.outputs.length;
			job.state = "completed";
			job.canResume = false;
		} catch (cause) {
			job.outputCount = stored.outputs.length;
			job.state = signal.aborted
				? stored.remoteJobId
					? "paused"
					: request.type === "video"
						? "interrupted"
						: "cancelled"
				: "failed";
			job.canResume = request.type === "video" && !!stored.remoteJobId;
			job.error = signal.aborted
				? request.type === "video"
					? stored.remoteJobId
						? "Stopped waiting locally. The provider may still be processing and charging for this video."
						: "Stopped before a remote job ID was confirmed. Check provider history before submitting again."
					: "Stopped locally. Requests already accepted by the provider may still be billed."
				: errorText(cause);
		} finally {
			await this.#persist(task).catch(() => {
				job.error = "Unable to persist media job state; save any available outputs before exiting.";
			});
		}
	}
}
