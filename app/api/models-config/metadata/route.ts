import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { extractMatchingModelMetadata, extractModelMetadata, isRecord, type ModelMetadata } from "@/lib/model-metadata";

export const dynamic = "force-dynamic";

const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;

function hasMetadata(metadata: ModelMetadata): boolean {
  return metadata.contextWindow !== undefined || metadata.maxTokens !== undefined;
}

function providerMatches(model: { provider?: string }, providerName: string): boolean {
  return typeof model.provider === "string" && model.provider.toLowerCase() === providerName.toLowerCase();
}

function modelIdMatches(model: { id?: string }, modelId: string): boolean {
  return typeof model.id === "string" && model.id.toLowerCase() === modelId.toLowerCase();
}

function modelCatalogMetadata(runtime: ModelRuntime, providerName: string, modelId: string): ModelMetadata {
  const models = runtime.getModels();
  const exactProvider = models.filter((model) => providerMatches(model, providerName) && modelIdMatches(model, modelId));
  const exactId = models.filter((model) => modelIdMatches(model, modelId) && !exactProvider.includes(model));
  for (const model of [...exactProvider, ...exactId]) {
    const metadata = extractModelMetadata(model);
    if (hasMetadata(metadata)) return metadata;
  }
  return {};
}

function modelUrls(baseUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];

  const pathname = url.pathname.replace(/\/+$/u, "").replace(/\/chat\/completions$/u, "");
  const paths = pathname.endsWith("/v1")
    ? ["/models", "/v1/models"]
    : [`${pathname || ""}/models`, `${pathname || ""}/v1/models`];
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const candidate = new URL(url.toString());
    candidate.pathname = path.replace(/\/+/gu, "/") || "/models";
    candidate.search = "";
    candidate.hash = "";
    const value = candidate.toString();
    if (seen.has(value)) return [];
    seen.add(value);
    return [value];
  });
}

function requestHeaders(provider: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (isRecord(provider.headers)) {
    for (const [name, value] of Object.entries(provider.headers)) {
      if (typeof value === "string" && value.trim()) headers[name] = value;
    }
  }
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
  const configuredKey = provider.apiKey ?? provider.key;
  const apiKey = typeof configuredKey === "string" && configuredKey.trim() && !configuredKey.startsWith("$") && !configuredKey.startsWith("!")
    ? configuredKey.trim()
    : undefined;
  if (apiKey && !hasAuthorization) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchRemoteMetadata(provider: Record<string, unknown>, modelId: string): Promise<ModelMetadata> {
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
  if (!baseUrl) return {};
  const api = typeof provider.api === "string" ? provider.api : "";
  if (api && api !== "openai-completions" && api !== "openai-responses") return {};

  for (const url of modelUrls(baseUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers: requestHeaders(provider), signal: controller.signal });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) continue;
      const payload = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
      const metadata = extractMatchingModelMetadata(payload, modelId);
      if (hasMetadata(metadata)) return metadata;
    } catch {
      // Try the alternate /models URL, then fall back to the local catalog.
    } finally {
      clearTimeout(timeout);
    }
  }
  return {};
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; modelId?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    const provider = isRecord(body.provider) ? body.provider : null;
    if (!providerName || !modelId || !provider) {
      return Response.json({ ok: false, error: "providerName, provider, and modelId are required" }, { status: 400 });
    }

    try {
      const runtime = await ModelRuntime.create({ allowModelNetwork: false });
      const metadata = modelCatalogMetadata(runtime, providerName, modelId);
      if (hasMetadata(metadata)) {
        return Response.json({ ok: true, ...metadata, source: "Pi model catalog" });
      }
    } catch {
      // Continue with the provider's own catalog if the local runtime cannot load.
    }

    const remoteMetadata = await fetchRemoteMetadata(provider, modelId);
    if (hasMetadata(remoteMetadata)) {
      return Response.json({ ok: true, ...remoteMetadata, source: "Provider /models catalog" });
    }

    return Response.json({ ok: false, error: `No context or output limits found for ${providerName}/${modelId}` }, { status: 404 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
