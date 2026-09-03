import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import yaml from "yaml";
import { getOmpAgentDir } from "./file-paths";
import { getOmpAuthCredentials } from "./omp-auth";

let isAntiGravityInterceptorInstalled = false;

export function setupAntiGravityFetchInterceptor(): void {
  if (isAntiGravityInterceptorInstalled) return;
  isAntiGravityInterceptorInstalled = true;

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    if (
      urlStr.includes("cloudcode-pa.googleapis.com") ||
      urlStr.includes("daily-cloudcode-pa.googleapis.com") ||
      urlStr.includes("generativelanguage.googleapis.com")
    ) {
      const ompCreds = getOmpAuthCredentials();
      const gaCred = ompCreds.find((c) => c.provider === "google-antigravity");
      let token: string | undefined;
      let projectId: string | undefined;
      if (gaCred?.data) {
        try {
          const parsed = JSON.parse(gaCred.data) as Record<string, unknown>;
          token = typeof parsed.access === "string" ? parsed.access : undefined;
          projectId = typeof parsed.projectId === "string" ? parsed.projectId : undefined;
        } catch {
          // ignore parse error
        }
      }

      if (token) {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
        } catch {
          // ignore json parse error
        }

        let modelId = (parsedBody.model as string) || "gemini-3.6-flash";
        if (modelId === "gemini-3.6-flash") modelId = "gemini-3.6-flash-low";

        const effectiveProject = projectId
          ? (projectId.startsWith("projects/") ? projectId : `projects/${projectId}`)
          : "projects/resolute-altar-lt3g1";

        const antiGravityPayload = {
          project: effectiveProject,
          model: modelId,
          request: {
            contents: parsedBody.contents ?? [],
            ...(parsedBody.systemInstruction ? { systemInstruction: parsedBody.systemInstruction } : {}),
            ...(parsedBody.tools ? { tools: parsedBody.tools } : {}),
            ...(parsedBody.toolConfig ? { toolConfig: parsedBody.toolConfig } : {}),
            ...(parsedBody.generationConfig ? { generationConfig: parsedBody.generationConfig } : {}),
          },
          userAgent: "antigravity",
          requestType: "agent",
        };

        const realUrl = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
        const targetHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${token}`,
          "User-Agent": "antigravity/1.21.9",
        };

        const resp = await origFetch(realUrl, {
          method: "POST",
          headers: targetHeaders,
          body: JSON.stringify(antiGravityPayload),
        });

        if (!resp.ok || !resp.body) return resp;

        let buffer = "";
        const transformStream = new TransformStream({
          transform(chunk, controller) {
            buffer += new TextDecoder().decode(chunk, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            const outLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6).trim();
                try {
                  const parsed = JSON.parse(dataStr) as { response?: Record<string, unknown> };
                  if (parsed && typeof parsed === "object" && parsed.response) {
                    const respObj = parsed.response;
                    if (respObj.candidates && Array.isArray(respObj.candidates)) {
                      for (const cand of respObj.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }>) {
                        if (cand.content && Array.isArray(cand.content.parts)) {
                          cand.content.parts = cand.content.parts.map((p) => {
                            if (typeof p.text !== "string") {
                              return { text: "", ...p };
                            }
                            return p;
                          });
                        }
                      }
                    }
                    outLines.push(`data: ${JSON.stringify(respObj)}\n`);
                    continue;
                  }
                } catch {
                  // ignore json parse error
                }
              }
              if (line.trim()) {
                outLines.push(line);
              }
            }
            if (outLines.length > 0) {
              controller.enqueue(new TextEncoder().encode(outLines.join("\n") + "\n\n"));
            }
          },
          flush(controller) {
            if (buffer.trim()) {
              if (buffer.startsWith("data: ")) {
                const dataStr = buffer.slice(6).trim();
                try {
                  const parsed = JSON.parse(dataStr) as { response?: Record<string, unknown> };
                  if (parsed && typeof parsed === "object" && parsed.response) {
                    const respObj = parsed.response;
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(respObj)}\n\n`));
                    return;
                  }
                } catch {
                  // ignore json parse error
                }
              }
              controller.enqueue(new TextEncoder().encode(buffer + "\n\n"));
            }
          },
        });

        return new Response(resp.body.pipeThrough(transformStream), {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
      }
    }

    return origFetch(url, init);
  }) as typeof globalThis.fetch;
}

export interface OmpModelItem {
  id: string;
  name: string;
  provider: string;
}

export interface OmpConfig {
  modelRoles?: {
    default?: string;
    plan?: string;
    slow?: string;
    [key: string]: string | undefined;
  };
  shellPath?: string;
  setupVersion?: number;
}

export function readOmpConfig(): OmpConfig {
  const configPath = join(getOmpAgentDir(), "config.yml");
  if (!existsSync(configPath)) return {};
  try {
    const content = readFileSync(configPath, "utf8");
    return (yaml.parse(content) as OmpConfig) || {};
  } catch {
    return {};
  }
}

export function readOmpModelsFromDb(): OmpModelItem[] {
  const dbPath = join(getOmpAgentDir(), "models.db");
  if (!existsSync(dbPath)) return [];

  // Strategy 1: Try better-sqlite3 if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT provider_id, models FROM model_cache").all() as Array<{ provider_id: string; models: string }>;
    db.close();

    const items: OmpModelItem[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.models) as Array<{ id: string; name?: string }>;
        if (Array.isArray(parsed)) {
          for (const m of parsed) {
            if (m && m.id) {
              items.push({
                id: m.id,
                name: m.name || m.id,
                provider: row.provider_id,
              });
            }
          }
        }
      } catch {
        // ignore row parse error
      }
    }
    if (items.length > 0) return items;
  } catch {
    // continue to fallback
  }

  // Strategy 2: Extract model JSON arrays directly from SQLite file buffer if native driver fails
  try {
    const fileBuffer = readFileSync(dbPath);
    const fileStr = fileBuffer.toString("utf8");
    const items: OmpModelItem[] = [];
    const jsonMatch = fileStr.match(/\[\s*\{\s*"id"\s*:[\s\S]*?\]/g);
    if (jsonMatch) {
      for (const block of jsonMatch) {
        try {
          const parsed = JSON.parse(block) as Array<{ id: string; name?: string; provider?: string }>;
          if (Array.isArray(parsed)) {
            for (const m of parsed) {
              if (m && m.id) {
                items.push({
                  id: m.id,
                  name: m.name || m.id,
                  provider: m.provider || "omp",
                });
              }
            }
          }
        } catch {
          // ignore invalid blocks
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function parseOmpDefaultModel(config: OmpConfig): { provider: string; modelId: string } | null {
  const defaultRef = config.modelRoles?.default;
  if (!defaultRef) return null;

  let cleanRef = defaultRef.trim();
  const colonIndex = cleanRef.lastIndexOf(":");
  if (colonIndex > 0) {
    cleanRef = cleanRef.slice(0, colonIndex);
  }

  const slashIndex = cleanRef.indexOf("/");
  if (slashIndex > 0) {
    return {
      provider: cleanRef.slice(0, slashIndex),
      modelId: cleanRef.slice(slashIndex + 1),
    };
  }
  return null;
}
function sanitizeObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject) as unknown as T;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null) continue;
    result[k] = sanitizeObject(v);
  }
  return result as T;
}
function inferContextWindow(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("gemini-1.5") || id.includes("gemini-2.5") || id.includes("gemini-3") || id.includes("gemini-3.5") || id.includes("gemini-3.6")) return 1048576;
  if (id.includes("claude-3-7") || id.includes("claude-sonnet-4") || id.includes("claude-sonnet-5") || id.includes("claude-opus-4") || id.includes("claude-fable")) return 1000000;
  if (id.includes("claude")) return 200000;
  if (id.includes("deepseek-v4") || id.includes("deepseek-v3.2") || id.includes("meituan") || id.includes("grok")) return 1000000;
  if (id.includes("kimi-k3") || id.includes("kimi-k2") || id.includes("qwen") || id.includes("doubao") || id.includes("ling-2.6") || id.includes("ring-2.6")) return 262144;
  if (id.includes("gpt-5") || id.includes("gpt-4.1") || id.includes("gpt-4o")) return 128000;
  return 128000;
}

export function syncOmpRuntimeModelsJson(agentDir: string = getOmpAgentDir()): string {
  setupAntiGravityFetchInterceptor();
  const runtimeModelsPath = join(agentDir, "omp-web-models.json");
  const dbPath = join(agentDir, "models.db");
  const modelsJsonPath = join(agentDir, "models.json");

  const providers: Record<string, Record<string, unknown>> = {};

  if (existsSync(dbPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare("SELECT provider_id, models FROM model_cache").all() as Array<{ provider_id: string; models: string }>;
      db.close();

      for (const row of rows) {
        try {
          const rawModels = JSON.parse(row.models) as Array<Record<string, unknown>>;
          if (Array.isArray(rawModels) && rawModels.length > 0) {
            const sanitizedModels = rawModels.map((m) => {
              const cleaned = sanitizeObject(m);
              delete cleaned.provider;
              if (!cleaned.contextWindow || typeof cleaned.contextWindow !== "number" || (cleaned.contextWindow as number) <= 0) {
                cleaned.contextWindow = inferContextWindow(String(cleaned.id || ""));
              }
              return cleaned;
            });
            const sample = sanitizedModels[0];
            const providerObj: Record<string, unknown> = { models: sanitizedModels };
            if (sample.api) providerObj.api = sample.api;
            if (sample.baseUrl) providerObj.baseUrl = sample.baseUrl;

            if (row.provider_id === "google-antigravity") {
              providerObj.api = "google-generative-ai";
              if (!providerObj.baseUrl) providerObj.baseUrl = "https://daily-cloudcode-pa.googleapis.com";
              for (const m of sanitizedModels) {
                m.api = "google-generative-ai";
              }
            }
            providers[row.provider_id] = providerObj;
          }
        } catch {
          // ignore row parse error
        }
      }
    } catch {
      // ignore sqlite read errors
    }
  }

  if (existsSync(modelsJsonPath)) {
    try {
      const customData = JSON.parse(readFileSync(modelsJsonPath, "utf8")) as { providers?: Record<string, Record<string, unknown>> };
      if (customData && customData.providers) {
        const sanitizedCustom = sanitizeObject(customData.providers);
        for (const [providerId, providerConfig] of Object.entries(sanitizedCustom)) {
          if (providerId === "google-antigravity" && providerConfig && typeof providerConfig === "object") {
            providerConfig.api = "google-generative-ai";
            if (!providerConfig.baseUrl) providerConfig.baseUrl = "https://daily-cloudcode-pa.googleapis.com";
            const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
            for (const model of models) {
              if (model && typeof model === "object") {
                (model as Record<string, unknown>).api = "google-generative-ai";
              }
            }
          }

          const dbModelList = (providers[providerId]?.models as Array<Record<string, unknown>>) ?? [];
          const customModelList = Array.isArray(providerConfig.models) ? (providerConfig.models as Array<Record<string, unknown>>) : [];
          const dbModelMap = new Map(dbModelList.map((m) => [String(m.id || ""), m]));
          const mergedModels: Array<Record<string, unknown>> = [];

          for (const customM of customModelList) {
            const customId = String(customM.id || "");
            const dbM = dbModelMap.get(customId);
            const merged = {
              ...dbM,
              ...customM,
            };
            if (!merged.contextWindow || typeof merged.contextWindow !== "number" || (merged.contextWindow as number) <= 0) {
              merged.contextWindow = inferContextWindow(customId);
            }
            mergedModels.push(merged);
            dbModelMap.delete(customId);
          }

          for (const dbM of dbModelMap.values()) {
            mergedModels.push(dbM);
          }

          providers[providerId] = {
            ...providers[providerId],
            ...providerConfig,
            models: mergedModels,
          };
        }
      }
    } catch {
      // ignore JSON parse error
    }
  }

  const dir = dirname(runtimeModelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ providers }, null, 2);
  writeFileSync(runtimeModelsPath, payload, "utf8");
  try {
    writeFileSync(modelsJsonPath, payload, "utf8");
  } catch {
    // ignore models.json write error
  }
  return runtimeModelsPath;
}
