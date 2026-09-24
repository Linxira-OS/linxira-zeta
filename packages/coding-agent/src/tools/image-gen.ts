import * as os from "node:os";
import * as path from "node:path";
import { type } from "@linxiraos/pi-omptype";
import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import {
	generateImage,
	type ImageGenerationRequest,
	type ImageGenerationResult,
	isImageGenerationApi,
	type Model,
	parseAntigravityCredentials,
} from "@linxiraos/pi-ai";
import { ProviderHttpError } from "@linxiraos/pi-ai/error";
import { isEnoent, logger, parseImageMetadata, prompt, ptree, Snowflake, untilAborted } from "@linxiraos/pi-utils";
import { resolveModelRoleValue, resolveRoleChain } from "../config/model-resolver";
import { roleCandidatePool } from "../config/model-roles";
import { isAuthenticated, type ModelRegistry } from "../config/model-registry";
import { settings } from "../config/settings";
import type { CustomTool } from "../extensibility/custom-tools/types";
import { resolveXAIHttpCredentials } from "../lib/xai-http";
import imageGenDescription from "../prompts/tools/image-gen.md" with { type: "text" };
import { AUTO_IMAGE_PROVIDER_ORDER, type ImageProvider, isImageProviderId } from "./image-providers";
import { resolveReadPath } from "./path-utils";
import { getCodexAccountId } from "@linxiraos/pi-catalog/wire/codex";

const IMAGE_TIMEOUT = 3 * 60 * 1000;
const MAX_IMAGE_SIZE = 35 * 1024 * 1024;

const aspectRatioSchema = type.enumerated(...XAI_IMAGE_ASPECT_RATIOS).describe("aspect ratio");
const imageSizeSchema = type('"1024x1024" | "1536x1024" | "1024x1536"').describe("image size");
const inputImageSchema = type({
	"path?": type("string").describe("input image path"),
	"data?": type("string").describe("base64 image data"),
	"mime_type?": type("string").describe("mime type"),
});

export const imageGenSchema = type({
	subject: type("string").describe("main subject"),
	"action?": type("string").describe("what subject is doing"),
	"scene?": type("string").describe("location or environment"),
	"composition?": type("string").describe("camera angle and framing"),
	"lighting?": type("string").describe("lighting setup"),
	"style?": type("string").describe("artistic style"),
	"text?": type("string").describe("text to render"),
	"changes?": type("string[]").describe("edits to make"),
	"aspect_ratio?": aspectRatioSchema,
	"image_size?": imageSizeSchema,
	"input?": inputImageSchema.array().describe("input images"),
	"model?": type("string").describe("image model selector for this request"),
});
export type ImageGenParams = typeof imageGenSchema.infer;

interface ImageGenToolDetails {
	provider: ImageProvider;
	model: string;
	imageCount: number;
	imagePaths: string[];
	images: Array<{ data: string; mimeType: string }>;
	responseText?: string;
	usage?: ImageGenerationResult["usage"];
}

interface ImageInput {
	path?: string;
	data?: string;
	mime_type?: string;
}

function assemblePrompt(params: ImageGenParams): string {
	const parts: string[] = [];
	const subjectParts = [params.subject];
	if (params.action) subjectParts.push(params.action);
	if (params.scene) subjectParts.push(params.scene);
	parts.push(subjectParts.join(", "));
	if (params.composition) parts.push(params.composition);
	if (params.lighting) parts.push(params.lighting);
	if (params.style) parts.push(params.style);
	let result = `${parts.map(part => part.replace(/[.!,;:]+$/, "")).join(". ")}.`;
	if (params.text) result += `\n\nText: ${params.text}`;
	if (params.changes?.length) result += `\n\nChanges:\n${params.changes.map(change => `- ${change}`).join("\n")}`;
	return result;
}

function normalizeDataUrl(data: string): { data: string; mimeType?: string } {
	const match = data.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) return { data };
	return { data: match[2] ?? "", mimeType: match[1] };
}

async function loadImageFromPath(imagePath: string, cwd: string): Promise<{ data: string; mimeType: string }> {
	const resolved = resolveReadPath(imagePath, cwd);
	try {
		const buffer = await Bun.file(resolved).bytes();
		if (buffer.length > MAX_IMAGE_SIZE) throw new Error(`Image file too large: ${imagePath}`);
		const mimeType = parseImageMetadata(buffer)?.mimeType;
		if (!mimeType) throw new Error(`Unsupported image type: ${imagePath}`);
		return { data: buffer.toBase64(), mimeType };
	} catch (error) {
		if (isEnoent(error)) throw new Error(`Image file not found: ${imagePath}`);
		throw error;
	}
}

async function resolveInputImage(input: ImageInput, cwd: string): Promise<{ data: string; mimeType: string }> {
	if (input.path) return loadImageFromPath(input.path, cwd);
	if (input.data) {
		const normalized = normalizeDataUrl(input.data.trim());
		const mimeType = normalized.mimeType ?? input.mime_type;
		if (!mimeType) throw new Error("mime_type is required when providing raw base64 data.");
		if (!normalized.data) throw new Error("Image data is empty.");
		return { data: normalized.data, mimeType };
	}
	throw new Error("input entries must include either path or data.");
}

function imageExtension(mimeType: string): string {
	const extensions: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
	};
	return extensions[mimeType] ?? "png";
}

async function saveImagesToTemp(images: ImageGenerationResult["images"]): Promise<string[]> {
	return Promise.all(
		images.map(async image => {
			const filepath = path.join(os.tmpdir(), `omp-image-${Snowflake.next()}.${imageExtension(image.mimeType)}`);
			await Bun.write(filepath, Buffer.from(image.data, "base64"));
			return filepath;
		}),
	);
}

function isOpenAIHostedImageModel(model: Model | undefined): model is Model {
	if (!model) return false;
	if (model.provider !== "openai" && model.provider !== "openai-codex") return false;
	if (model.api !== "openai-responses" && model.api !== "openai-codex-responses") return false;
	const modelId = model.id.toLowerCase();
	return modelId.startsWith("gpt-") || modelId === "o3" || modelId.startsWith("o3-");
}

async function findXAIImageCredentials(modelRegistry?: ModelRegistry): Promise<ImageApiKey | null> {
	if (modelRegistry) {
		const creds = await resolveXAIHttpCredentials(modelRegistry);
		if (creds) return { provider: "xai", apiKey: creds.apiKey };
		return null;
	}
	const apiKey = $env.XAI_API_KEY;
	if (apiKey) return { provider: "xai", apiKey };
	return null;
}

async function findOpenRouterImageCredentials(
	modelRegistry?: ModelRegistry,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	if (modelRegistry) {
		// AuthStorage.getApiKey already falls back to env keys, so this covers OPENROUTER_API_KEY too.
		const apiKey = await modelRegistry.getApiKeyForProvider("openrouter", sessionId);
		if (apiKey) return { provider: "openrouter", apiKey: modelRegistry.resolver("openrouter", { sessionId }) };
		return null;
	}
	const apiKey = getEnvApiKey("openrouter");
	if (apiKey) return { provider: "openrouter", apiKey };
	return null;
}

async function findDeepInfraImageCredentials(
	modelRegistry?: ModelRegistry,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	if (modelRegistry) {
		// AuthStorage.getApiKey already falls back to env keys, so this covers DEEPINFRA_API_KEY too.
		const apiKey = await modelRegistry.getApiKeyForProvider("deepinfra", sessionId);
		if (apiKey) return { provider: "deepinfra", apiKey: modelRegistry.resolver("deepinfra", { sessionId }) };
		return null;
	}
	const apiKey = getEnvApiKey("deepinfra");
	if (apiKey) return { provider: "deepinfra", apiKey };
	return null;
}

async function findGeminiImageCredentials(
	modelRegistry?: ModelRegistry,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	if (modelRegistry) {
		// AuthStorage.getApiKey already falls back to env keys (GEMINI_API_KEY), so only
		// GOOGLE_API_KEY needs the explicit check below.
		const apiKey = await modelRegistry.getApiKeyForProvider("google", sessionId);
		if (apiKey) return { provider: "gemini", apiKey: modelRegistry.resolver("google", { sessionId }) };
	} else {
		const envKey = getEnvApiKey("google");
		if (envKey) return { provider: "gemini", apiKey: envKey };
	}
	const googleKey = $env.GOOGLE_API_KEY;
	if (googleKey) return { provider: "gemini", apiKey: googleKey };
	return null;
}

async function findOpenAIHostedImageCredentials(
	modelRegistry: ModelRegistry | undefined,
	activeModel: Model | undefined,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	if (!modelRegistry || !isOpenAIHostedImageModel(activeModel)) return null;
	const apiKey = await modelRegistry.getApiKey(activeModel, sessionId);
	if (!isAuthenticated(apiKey)) return null;
	return {
		provider: getOpenAIHostedImageProvider(activeModel),
		apiKey,
		model: activeModel,
	};
}

// Codex (ChatGPT subscription) chat models that carry OpenAI's hosted
// `image_generation` tool. Priority: newest general model first, then Codex
// variants; any available openai-codex hosted-image model is the last resort.
const CODEX_IMAGE_MODEL_PRIORITY = ["gpt-5.5", "gpt-5.4", "gpt-5.1", "gpt-5", "gpt-5-codex"] as const;

function resolveDefaultCodexImageModel(modelRegistry: ModelRegistry): Model | undefined {
	for (const id of CODEX_IMAGE_MODEL_PRIORITY) {
		const model = modelRegistry.find("openai-codex", id);
		if (model && isOpenAIHostedImageModel(model)) return model;
	}
	return modelRegistry.getAll().find(model => model.provider === "openai-codex" && isOpenAIHostedImageModel(model));
}

/**
 * Codex image credentials — engages OpenAI's hosted `image_generation` tool
 * through a connected ChatGPT account or custom Codex-compatible endpoint,
 * independent of the active chat model. The active-model-is-codex case is
 * already served by {@link findOpenAIHostedImageCredentials}, so it is skipped
 * here to avoid a duplicate resolution.
 */
async function findCodexSubscriptionImageCredentials(
	modelRegistry: ModelRegistry | undefined,
	activeModel: Model | undefined,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	if (!modelRegistry) return null;
	if (isOpenAIHostedImageModel(activeModel) && getOpenAIHostedImageProvider(activeModel) === "openai-codex") {
		return null;
	}
	const token = await modelRegistry.getApiKeyForProvider("openai-codex", sessionId);
	if (!token) return null;
	const model = resolveDefaultCodexImageModel(modelRegistry);
	if (!model) return null;
	const acceptsOpaqueCredentials = !isOfficialCodexApiUrl(getOpenAIResponsesUrl(model));
	if (!acceptsOpaqueCredentials && !getCodexAccountId(token)) return null;
	const apiKey = await modelRegistry.getApiKey(model, sessionId);
	if (!isAuthenticated(apiKey) || (!acceptsOpaqueCredentials && !getCodexAccountId(apiKey))) return null;
	return { provider: "openai-codex", apiKey, model };
}

function activeImageProvider(model: Model | undefined): Exclude<ImageProviderPreference, "auto"> | null {
	switch (model?.provider) {
		case "openai":
		case "openai-codex":
			return "openai";
		case "google-antigravity":
			return "antigravity";
		case "xai":
		case "xai-oauth":
			return "xai";
		case "openrouter":
			return "openrouter";
		case "deepinfra":
			return "deepinfra";
		case "google":
			return "gemini";
		default:
			return null;
	}
}

function imageProviderOrder(activeModel: Model | undefined, requested?: ImageProviderPreference): ImageProvider[] {
	const providers: ImageProvider[] = [];
	const added = new Set<ImageProvider>();
	const add = (provider: ImageProvider | null): void => {
		if (!provider || added.has(provider)) return;
		added.add(provider);
		providers.push(provider);
	};

	// Per-request provider wins, then the configured priority list, then the
	// active session's provider, then the built-in auto order.
	if (requested !== undefined && requested !== "auto") add(requested);
	for (const provider of configuredImageProviderOrder) add(provider);
	add(activeImageProvider(activeModel));
	for (const provider of AUTO_IMAGE_PROVIDER_ORDER) add(provider);
	return providers;
}

async function findImageApiKey(
	provider: Exclude<ImageProviderPreference, "auto">,
	modelRegistry?: ModelRegistry,
	activeModel?: Model,
	sessionId?: string,
): Promise<ImageApiKey | null> {
	switch (provider) {
		case "openai":
			return findOpenAIHostedImageCredentials(modelRegistry, activeModel, sessionId);
		case "openai-codex":
			return findCodexSubscriptionImageCredentials(modelRegistry, activeModel, sessionId);
		case "antigravity":
			return modelRegistry ? findAntigravityCredentials(modelRegistry, sessionId) : null;
		case "xai":
			return findXAIImageCredentials(modelRegistry);
		case "openrouter":
			return findOpenRouterImageCredentials(modelRegistry, sessionId);
		case "deepinfra":
			return findDeepInfraImageCredentials(modelRegistry, sessionId);
		case "gemini":
			return findGeminiImageCredentials(modelRegistry, sessionId);
	}
}

async function buildToolResult(
	model: Model,
	result: ImageGenerationResult,
): Promise<AgentToolResult<ImageGenToolDetails, ImageGenParams>> {
	const imagePaths = await saveImagesToTemp(result.images);
	if (imagePaths.length === 0) {
		return {
			content: [{ type: "text", text: `No image data returned.${result.text ? `\n\n${result.text}` : ""}` }],
			details: {
				provider: model.provider,
				model: model.id,
				imageCount: 0,
				imagePaths: [],
				images: [],
				responseText: result.text,
				usage: result.usage,
			},
		};
	}
	const lines = [`Provider: ${model.provider}`, `Model: ${model.id}`, `Generated ${imagePaths.length} image(s):`];
	for (const imagePath of imagePaths) lines.push(`  ${imagePath}`);
	if (result.text) lines.push("", result.text.trim());
	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: {
			provider: model.provider,
			model: model.id,
			imageCount: result.images.length,
			imagePaths,
			images: result.images,
			responseText: result.text,
			usage: result.usage,
		},
	};
}

export const imageGenTool: CustomTool<typeof imageGenSchema, ImageGenToolDetails> = {
	name: "generate_image",
	label: "GenerateImage",
	strict: false,
	approval: "write",
	description: prompt.render(imageGenDescription),
	parameters: imageGenSchema,
	async execute(_toolCallId, params, _onUpdate, ctx, signal) {
		return untilAborted(signal, async () => {
			const sessionId = ctx.sessionManager.getSessionId();
			const providerOrder = imageProviderOrder(ctx.model, params.provider);
			const cwd = ctx.sessionManager.getCwd();
			const requestSignal = ptree.combineSignals(signal, IMAGE_TIMEOUT);
			const effectiveSettings = ctx.settings ?? settings;
			const pool = roleCandidatePool("image", effectiveSettings, ctx.modelRegistry);
			let candidates: Model[];
			if (params.model) {
				const selected = resolveModelRoleValue(params.model, pool, { settings: effectiveSettings }).model;
				if (!selected)
					throw new Error(`Image model selector did not match an available image model: ${params.model}`);
				candidates = [selected];
			} else {
				candidates = resolveRoleChain("image", effectiveSettings, pool, {
					hoistProvider: ctx.model?.provider,
				}).map(candidate => candidate.model);
			}

			const failures: ProviderHttpError[] = [];
			const skipped: string[] = [];
			let inputImages: ImageGenerationRequest["inputImages"];
			for (const model of candidates) {
				if (!isImageGenerationApi(model.api)) {
					logger.warn("Skipping unsupported image model API", {
						provider: model.provider,
						model: model.id,
						api: model.api,
					});
					skipped.push(`${model.provider}/${model.id} (unsupported ${model.api})`);
					continue;
				}

				const initialKey = await ctx.modelRegistry.getApiKey(model, sessionId, { signal: requestSignal });
				if (!isAuthenticated(initialKey)) {
					skipped.push(`${model.provider}/${model.id} (credentials unavailable)`);
					continue;
				}
				if (model.api === "google-gemini-cli" && !parseAntigravityCredentials(initialKey)) {
					skipped.push(`${model.provider}/${model.id} (invalid credentials)`);
					continue;
				}

				let carrier: Model | undefined;
				let apiKey = ctx.modelRegistry.resolver(model, sessionId);
				if (model.api === "openai-responses" || model.api === "openai-codex-responses") {
					carrier = resolveHostedImageCarrier(ctx.modelRegistry, model, ctx.model);
					if (!carrier) {
						skipped.push(`${model.provider}/${model.id} (hosted chat carrier unavailable)`);
						continue;
					}
					const carrierKey = await ctx.modelRegistry.getApiKey(carrier, sessionId, { signal: requestSignal });
					if (!isAuthenticated(carrierKey)) {
						skipped.push(`${model.provider}/${model.id} (carrier credentials unavailable)`);
						continue;
					}
					apiKey = ctx.modelRegistry.resolver(carrier, sessionId);
				}

				if (!inputImages) {
					inputImages = [];
					for (const input of params.input ?? []) {
						inputImages.push(await resolveInputImage(input, ctx.sessionManager.getCwd()));
					}
				}
				const request: ImageGenerationRequest = {
					prompt: assemblePrompt(params),
					inputImages,
					aspectRatio: params.aspect_ratio,
					imageSize: params.image_size,
					count: 1,
				};
				const resolvedModel = {
					...model,
					resolveHeaders: (headerSignal?: AbortSignal) =>
						ctx.modelRegistry.resolveModelHeaders(model, headerSignal),
				};
				const resolvedCarrier = carrier
					? {
							...carrier,
							resolveHeaders: (headerSignal?: AbortSignal) =>
								ctx.modelRegistry.resolveModelHeaders(carrier, headerSignal),
						}
					: undefined;
				try {
					const result = await generateImage(resolvedModel, request, {
						apiKey,
						fetch: ctx.fetch ?? fetch,
						signal: requestSignal,
						carrier: resolvedCarrier,
						sessionId,
					});
					return buildToolResult(model, result);
				} catch (error) {
					if (!(error instanceof ProviderHttpError) || requestSignal?.aborted) {
						throw error;
					}
					failures.push({ provider, error });
				}
			}

			if (!foundCredentials) {
				throw new Error(
					"No image API credentials found. Connect a Codex (ChatGPT) subscription, use a GPT Responses/Codex model with OpenAI credentials, log in with google-antigravity or xAI Grok OAuth, or set OPENAI_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or DEEPINFRA_API_KEY.",
				);
			}

			if (failures.length === 0 && unsupportedAspectRatioProvider) {
				assertImageAspectRatioSupported(unsupportedAspectRatioProvider, params.aspect_ratio);
			}

			if (failures.length === 0 && editUnsupportedProvider) {
				throw new Error(
					`${editUnsupportedProvider} image generation is text-to-image only and cannot edit input images. Configure an edit-capable provider (openai, openai-codex, antigravity, xai, openrouter, gemini) or retry without input images.`,
				);
			}

			throw new AggregateError(
				failures.map(failure => failure.error),
				`Image generation failed for all credentialed providers: ${failures.map(failure => failure.provider).join(", ")}`,
			);
		});
	},
};

export async function getImageGenTools(
	_modelRegistry?: ModelRegistry,
	_activeModel?: Model,
): Promise<Array<CustomTool<typeof imageGenSchema, ImageGenToolDetails>>> {
	return [imageGenTool];
}

export async function getImageGenToolsWithRegistry(
	_modelRegistry: ModelRegistry,
	_activeModel?: Model,
): Promise<Array<CustomTool<typeof imageGenSchema, ImageGenToolDetails>>> {
	return [imageGenTool];
}
