export interface ModelMetadata {
  contextWindow?: number;
  maxTokens?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstPositiveInteger(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return undefined;
}

const CONTEXT_KEYS = [
  "contextWindow",
  "context_window",
  "contextLength",
  "context_length",
  "maxContextLength",
  "max_context_length",
  "maxInputTokens",
  "max_input_tokens",
  "inputTokenLimit",
  "input_token_limit",
] as const;

const OUTPUT_KEYS = [
  "maxTokens",
  "max_tokens",
  "maxOutputTokens",
  "max_output_tokens",
  "maxCompletionTokens",
  "max_completion_tokens",
  "outputTokenLimit",
  "output_token_limit",
] as const;

export function extractModelMetadata(value: unknown): ModelMetadata {
  if (!isRecord(value)) return {};

  const nestedRecords = [value.limits, value.capabilities, value.metadata].filter(isRecord);
  const records = [value, ...nestedRecords];
  let contextWindow: number | undefined;
  let maxTokens: number | undefined;

  for (const record of records) {
    contextWindow ??= firstPositiveInteger(record, CONTEXT_KEYS);
    maxTokens ??= firstPositiveInteger(record, OUTPUT_KEYS);
    if (contextWindow !== undefined && maxTokens !== undefined) break;
  }

  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

export function extractMatchingModelMetadata(payload: unknown, modelId: string): ModelMetadata {
  const models = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];
  const normalizedId = modelId.trim().toLowerCase();
  const match = models.find((model) => isRecord(model) && typeof model.id === "string" && model.id.toLowerCase() === normalizedId);
  return extractModelMetadata(match);
}
