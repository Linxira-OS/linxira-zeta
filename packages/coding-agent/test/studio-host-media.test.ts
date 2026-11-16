/**
 * Isolated media state machine: provider injection only, no network, no Host
 * listener and no audio. Covers cancellation, restart without replay, confirmed
 * video resume, removal after writers settle, foreign artifact refusal, audio
 * holds and both retained/active limits.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { buildModel } from "@linxiraos/pi-catalog/build";
import type { ImageGenerationResult } from "@linxiraos/pi-ai/images";
import type { generateImage } from "@linxiraos/pi-ai";
import type { downloadVideo, pollVideo, submitVideo } from "@linxiraos/pi-ai/video";
import { Settings } from "../src/config/settings";
import type {
	MediaDetail,
	MediaModelChoice,
	MediaOutput,
	MediaResultMap,
} from "../src/server/studio-host/protocol/contracts/media";
import {
	MediaServiceError,
	StudioMediaService,
	type StudioMediaSession,
} from "../src/server/studio-host/services/media-service";
import { StudioMediaJobStore, type SessionMediaArtifactPort } from "../src/server/studio-host/services/media-files";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function directory(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "zeta-studio-media-"));
	directories.push(root);
	return root;
}

const SESSION_ID = "media-session-1";
const USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const IMAGE_RESULT: ImageGenerationResult = {
	images: [
		{ data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString("base64"), mimeType: "image/png" },
	],
	usage: USAGE,
	model: "image-1",
};
const IMAGE_MODEL = buildModel({
	id: "image-1",
	name: "Image One",
	api: "openai-images",
	provider: "test",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 1024,
	kind: "image",
});
const VIDEO_MODEL = buildModel({
	id: "video-1",
	name: "Video One",
	api: "openrouter-video",
	provider: "test",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 1024,
	kind: "video",
});
const REGISTRY = {
	getAvailable: () => [IMAGE_MODEL, VIDEO_MODEL],
	getAll: () => [IMAGE_MODEL, VIDEO_MODEL],
	getError: () => undefined,
	resolver: () => () => "test-key",
	resolveModelHeaders: async () => undefined,
} as unknown as StudioMediaSession["modelRegistry"];
const SESSION_SETTINGS = Settings.isolated({ modelRoles: { image: "test/image-1" } });
const SESSION: StudioMediaSession = {
	sessionId: SESSION_ID,
	settings: SESSION_SETTINGS,
	modelRegistry: REGISTRY,
	isDisposed: false,
};

class FakePort implements SessionMediaArtifactPort {
	readonly outputs = new Map<string, { bytes: Uint8Array; meta: MediaOutput }>();
	#next = 0;
	async read(
		artifactId: string,
		kind?: "image" | "video" | "audio",
	): Promise<{ bytes: Uint8Array; meta: MediaOutput }> {
		const value = this.outputs.get(artifactId);
		if (!value || (kind !== undefined && value.meta.kind !== kind)) throw new Error("artifact is foreign");
		return { bytes: value.bytes.slice(), meta: { ...value.meta } };
	}
	async write(meta: Pick<MediaOutput, "name" | "kind" | "mimeType">, bytes: Uint8Array): Promise<MediaOutput> {
		const artifactId = `artifact-${++this.#next}`;
		const output: MediaOutput = {
			...meta,
			artifactId,
			bytes: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
		this.outputs.set(artifactId, { bytes: bytes.slice(), meta: output });
		return output;
	}
	async remove(artifactId: string): Promise<void> {
		this.outputs.delete(artifactId);
	}
}

async function readJob(service: StudioMediaService, id: string): Promise<MediaDetail> {
	return (await service.execute({ kind: "media.read", sessionId: SESSION_ID, id })) as MediaDetail;
}

async function expectHold(run: Promise<unknown>): Promise<void> {
	try {
		await run;
		throw new Error("audio work must be refused");
	} catch (error) {
		expect(error).toBeInstanceOf(MediaServiceError);
		expect((error as MediaServiceError).code).toBe("COMMAND_BLOCKED");
		expect((error as Error).message).toContain("held by the audio owner");
	}
}

describe("Studio media state machine", () => {
	test("ports image/video state through the session artifact boundary without replay or audio", async () => {
		const root = await directory();
		const port = new FakePort();
		const jobs = new StudioMediaJobStore(path.join(root, "profile"));
		let imageCalls = 0;
		const generate: typeof generateImage = async () => {
			imageCalls++;
			return IMAGE_RESULT;
		};
		let submitCalls = 0;
		let pollCalls = 0;
		const submit: typeof submitVideo = async () => {
			submitCalls++;
			return { id: "remote-video-1", status: "queued" };
		};
		const pollStarted = Promise.withResolvers<void>();
		const poll: typeof pollVideo = async (_model, jobId, options) => {
			pollCalls++;
			if (pollCalls === 1) {
				pollStarted.resolve();
				const stopped = Promise.withResolvers<void>();
				options.signal?.addEventListener("abort", () => stopped.resolve(), { once: true });
				if (options.signal?.aborted) stopped.resolve();
				await stopped.promise;
				options.signal?.throwIfAborted();
			}
			return { id: jobId, status: "completed" };
		};
		const download: typeof downloadVideo = async () => {
			const bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50]);
			return { body: new Blob([bytes]).stream(), contentType: "video/mp4", contentLength: bytes.byteLength };
		};
		let service = new StudioMediaService(SESSION, {
			port,
			jobs,
			generateImage: generate,
			submitVideo: submit,
			pollVideo: poll,
			downloadVideo: download,
			pollIntervalMs: 1,
		});

		const catalog = (await service.execute({
			kind: "media.models",
			sessionId: SESSION_ID,
		})) as MediaResultMap["media.models"];
		expect(catalog.available).toBe(true);
		expect(catalog.models.map((model: MediaModelChoice) => `${model.kind}:${model.selector}`)).toEqual([
			"image:test/image-1",
			"video:test/video-1",
		]);

		const imageStart = (await service.execute({
			kind: "media.start",
			sessionId: SESSION_ID,
			request: { type: "image", prompt: "draw a tree" },
		})) as MediaResultMap["media.start"];
		await service.settle();
		const image = await readJob(service, imageStart.job.id);
		expect(image.job.state).toBe("completed");
		expect(image.outputs).toHaveLength(1);
		expect(image.outputs[0]?.kind).toBe("image");
		expect(image.outputs[0]?.name.endsWith(".png")).toBe(true);
		expect(imageCalls).toBe(1);
		expect(port.outputs.size).toBe(1);
		expect(
			(await service.execute({
				kind: "media.close",
				sessionId: SESSION_ID,
				id: imageStart.job.id,
			})) as MediaResultMap["media.close"],
		).toEqual({ closed: true });
		expect(port.outputs.size).toBe(0);

		const videoStart = (await service.execute({
			kind: "media.start",
			sessionId: SESSION_ID,
			request: { type: "video", model: "test/video-1", prompt: "animate" },
		})) as MediaResultMap["media.start"];
		await pollStarted.promise;
		await service.execute({ kind: "media.cancel", sessionId: SESSION_ID, id: videoStart.job.id });
		await service.settle();
		const stopped = await readJob(service, videoStart.job.id);
		expect(stopped.job.canResume).toBe(true);
		expect(submitCalls).toBe(1);
		service.dispose();
		await service.settle();

		service = new StudioMediaService(SESSION, {
			port,
			jobs,
			generateImage: generate,
			submitVideo: submit,
			pollVideo: poll,
			downloadVideo: download,
			pollIntervalMs: 1,
		});
		const restarted = (await service.execute({
			kind: "media.list",
			sessionId: SESSION_ID,
		})) as MediaResultMap["media.list"];
		const resumedJob = restarted.jobs.find(job => job.id === videoStart.job.id);
		expect(resumedJob?.canResume).toBe(true);
		await service.execute({ kind: "media.resume", sessionId: SESSION_ID, id: videoStart.job.id });
		await service.settle();
		const resumed = await readJob(service, videoStart.job.id);
		expect(resumed.job.state).toBe("completed");
		expect(resumed.outputs[0]?.kind).toBe("video");
		expect(submitCalls).toBe(1);
		expect(pollCalls).toBe(2);
		expect(
			(await service.execute({
				kind: "media.close",
				sessionId: SESSION_ID,
				id: videoStart.job.id,
			})) as MediaResultMap["media.close"],
		).toEqual({ closed: true });
		expect(port.outputs.size).toBe(0);

		const beforeForeign = imageCalls;
		const foreign = (await service.execute({
			kind: "media.start",
			sessionId: SESSION_ID,
			request: { type: "image", prompt: "edit", inputArtifacts: ["artifact-foreign"] },
		})) as MediaResultMap["media.start"];
		await service.settle();
		const failed = await readJob(service, foreign.job.id);
		expect(failed.job.state).toBe("failed");
		expect(failed.job.error ?? "").not.toContain("artifact-foreign");
		expect(imageCalls).toBe(beforeForeign);

		await expectHold(
			service.execute({
				kind: "media.start",
				sessionId: SESSION_ID,
				request: { type: "speech", text: "hello", format: "mp3" },
			}),
		);
		await expectHold(
			service.execute({
				kind: "media.start",
				sessionId: SESSION_ID,
				request: { type: "video", model: "test/video-1", generateAudio: true },
			}),
		);
		service.dispose();
		await service.settle();
	});

	test("enforces four active jobs and fifty retained jobs", async () => {
		const root = await directory();
		const gate = Promise.withResolvers<void>();
		const generate: typeof generateImage = async (_model, _request, options) => {
			const stopped = Promise.withResolvers<void>();
			options.signal?.addEventListener("abort", () => stopped.resolve(), { once: true });
			if (options.signal?.aborted) stopped.resolve();
			await Promise.race([gate.promise, stopped.promise]);
			options.signal?.throwIfAborted();
			return IMAGE_RESULT;
		};
		const activeService = new StudioMediaService(SESSION, {
			port: new FakePort(),
			jobs: new StudioMediaJobStore(path.join(root, "active")),
			generateImage: generate,
		});
		for (let index = 0; index < 4; index++) {
			await activeService.execute({
				kind: "media.start",
				sessionId: SESSION_ID,
				request: { type: "image", prompt: `image ${index}` },
			});
		}
		await expect(
			activeService.execute({
				kind: "media.start",
				sessionId: SESSION_ID,
				request: { type: "image", prompt: "too many" },
			}),
		).rejects.toThrow(/4 active/);
		activeService.dispose();
		gate.resolve();
		await activeService.settle();

		const retained = new StudioMediaJobStore(path.join(root, "retained"));
		for (let index = 0; index < 50; index++) {
			const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
			await retained.saveJob(SESSION_ID, id, {
				schemaVersion: 1,
				instance: "seed",
				job: {
					id,
					sessionId: SESSION_ID,
					type: "image",
					state: "completed",
					createdAt: index + 1,
					updatedAt: index + 1,
					canResume: false,
					outputCount: 0,
				},
				request: { type: "image", prompt: "seed" },
				outputs: [],
			});
		}
		const retainedService = new StudioMediaService(SESSION, {
			port: new FakePort(),
			jobs: retained,
			generateImage: generate,
		});
		const listed = (await retainedService.execute({
			kind: "media.list",
			sessionId: SESSION_ID,
		})) as MediaResultMap["media.list"];
		expect(listed.jobs).toHaveLength(50);
		await expect(
			retainedService.execute({
				kind: "media.start",
				sessionId: SESSION_ID,
				request: { type: "image", prompt: "too many" },
			}),
		).rejects.toThrow(/50 retained/);
		retainedService.dispose();
		await retainedService.settle();
	});
});
