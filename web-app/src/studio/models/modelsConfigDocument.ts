/**
 * Parsing and serialization for a whole `models.yml` document.
 *
 * Two encodings are accepted, matching what the CLI and the old web panel
 * wrote over the years:
 *
 * - block-style YAML (`providers:` nested maps, `models:` sequences) — the
 *   format `docs/models.md` documents and the hand-written file uses;
 * - standard JSON (`{"providers": {...}}`) — the body the old `/api/models-config`
 *   PUT accepted and the legacy `models.json` migration read.
 *
 * Detection is explicit, never a silent fallback: text whose first non-space
 * character is `{` or `[` is parsed as JSON only, so malformed JSON (including
 * YAML flow-style maps) fails with `json-syntax` instead of quietly becoming
 * YAML. Everything else must parse as YAML. Duplicate mapping keys are an
 * error in both encodings.
 *
 * This module is pure and UI-free; the model-config page and tests share it.
 */

import { parseDocument, stringify as stringifyYaml, type Document, type YAMLError } from "yaml";

export type ModelsConfigFormat = "json" | "yaml";

export type ModelsConfigErrorCode =
  | "json-syntax"
  | "yaml-syntax"
  | "duplicate-key"
  | "root-not-object"
  | "root-array"
  | "unknown-root-key"
  | "providers-not-object"
  | "provider-not-object"
  | "models-not-array"
  | "model-not-object"
  | "model-id-missing";

export interface ModelsConfigParseError {
  readonly code: ModelsConfigErrorCode;
  /** Human-readable message, naming the dotted path where one exists. */
  readonly message: string;
  /** Dotted path into the document, e.g. `providers.acme.models[1].id`. */
  readonly path?: string;
  /** 1-based location for a syntax error, when the parser reports one. */
  readonly line?: number;
  readonly column?: number;
}

export interface ModelsConfigDocument {
  readonly providers: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export type ModelsConfigParseResult =
  | {
      readonly ok: true;
      readonly format: ModelsConfigFormat;
      readonly document: ModelsConfigDocument;
      /** The input text, unchanged; YAML saves can reuse it byte-for-byte. */
      readonly text: string;
    }
  | { readonly ok: false; readonly error: ModelsConfigParseError };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Text that starts with `{`/`[` must be JSON; YAML is tried only for the rest. */
function looksLikeJsonDocument(text: string): boolean {
  const first = text.trimStart()[0];
  return first === "{" || first === "[";
}

/**
 * Parse a whole models config document.
 *
 * Empty (or comments-only) YAML is an empty provider set. An empty JSON marker
 * document is still JSON syntax and is rejected.
 */
export function parseModelsConfigDocument(text: string): ModelsConfigParseResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, format: "yaml", document: { providers: {} }, text };
  }

  const parsed = looksLikeJsonDocument(text) ? parseJsonDocument(text) : parseYamlDocument(text);
  if (!parsed.ok) return parsed;
  return validateDocument(parsed.value, parsed.format, text);
}

/**
 * Serialize a parsed document as block-style YAML.
 *
 * The panel layer is a `.yml` file, so a JSON import is converted once on the
 * way in; a YAML import keeps its own text instead of being re-serialized.
 */
export function serializeModelsConfigDocument(document: ModelsConfigDocument): string {
  return stringifyYaml(document, { indent: 2, lineWidth: 0 });
}

/** The text an import should write: the original YAML, or JSON converted to YAML. */
export function modelsConfigWriteText(parsed: Extract<ModelsConfigParseResult, { ok: true }>): string {
  return parsed.format === "yaml" ? parsed.text : serializeModelsConfigDocument(parsed.document);
}

/**
 * Merge config layers the way the registry does: the hand-written user layer
 * wins per provider, and providers only in the panel layer survive.
 */
export function mergeModelsConfigLayers(
  user: ModelsConfigDocument | undefined,
  panel: ModelsConfigDocument | undefined,
): ModelsConfigDocument {
  return {
    providers: { ...(panel?.providers ?? {}), ...(user?.providers ?? {}) },
  };
}

type IntermediateParse =
  | { readonly ok: true; readonly value: unknown; readonly format: ModelsConfigFormat }
  | { readonly ok: false; readonly error: ModelsConfigParseError };

function parseJsonDocument(text: string): IntermediateParse {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ok: false,
      error: { code: "json-syntax", message: jsonSyntaxMessage(error) },
    };
  }
  // JSON.parse accepts duplicate names by taking the last one. YAML's
  // unique-key check catches the same text, so the document cannot hide a
  // conflicting provider definition behind the parse order.
  const duplicate = yamlDuplicateKeyError(text);
  if (duplicate) return { ok: false, error: duplicate };
  return { ok: true, value, format: "json" };
}

function parseYamlDocument(text: string): IntermediateParse {
  let doc: Document;
  try {
    doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    return { ok: false, error: yamlSyntaxError(error) };
  }
  const first = doc.errors[0];
  if (first) return { ok: false, error: yamlErrorToParseError(first) };
  if (doc.contents === null) return { ok: true, value: undefined, format: "yaml" };
  try {
    return { ok: true, value: doc.toJS(), format: "yaml" };
  } catch (error) {
    return { ok: false, error: yamlSyntaxError(error) };
  }
}

function validateDocument(
  value: unknown,
  format: ModelsConfigFormat,
  text: string,
): ModelsConfigParseResult {
  if (Array.isArray(value)) {
    return fail("root-array", "models.yml root must be an object with a providers mapping, not an array");
  }
  if (value === undefined && format === "yaml") {
    return { ok: true, format, document: { providers: {} }, text };
  }
  if (!isPlainRecord(value)) {
    return fail("root-not-object", "models.yml root must be an object with a providers mapping");
  }

  for (const key of Object.keys(value)) {
    if (key !== "providers") {
      return fail("unknown-root-key", `models.yml does not accept the top-level key "${key}"`, key);
    }
  }

  const providersValue = value.providers;
  if (providersValue === undefined) {
    return { ok: true, format, document: { providers: {} }, text };
  }
  if (!isPlainRecord(providersValue)) {
    return fail("providers-not-object", "models.yml providers must be a mapping", "providers");
  }

  const providers: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [id, node] of Object.entries(providersValue)) {
    const path = `providers.${id}`;
    if (!isPlainRecord(node)) {
      return fail("provider-not-object", `models.yml ${path} must be a mapping`, path);
    }
    const models = node.models;
    if (models !== undefined) {
      if (!Array.isArray(models)) {
        return fail("models-not-array", `models.yml ${path}.models must be a list`, `${path}.models`);
      }
      for (let index = 0; index < models.length; index += 1) {
        const entry = models[index];
        if (!isPlainRecord(entry)) {
          return fail("model-not-object", `models.yml ${path}.models[${index}] must be a mapping`, `${path}.models[${index}]`);
        }
        if (typeof entry.id !== "string" || entry.id.trim() === "") {
          return fail("model-id-missing", `models.yml ${path}.models[${index}].id must be a non-empty string`, `${path}.models[${index}].id`);
        }
      }
    }
    providers[id] = node;
  }
  return { ok: true, format, document: { providers }, text };
}

function fail(
  code: ModelsConfigErrorCode,
  message: string,
  path?: string,
): { readonly ok: false; readonly error: ModelsConfigParseError } {
  return { ok: false, error: { code, message, ...(path ? { path } : {}) } };
}

/** Re-run YAML's unique-key check on JSON-looking text. `undefined` means clean. */
function yamlDuplicateKeyError(text: string): ModelsConfigParseError | undefined {
  let doc: Document;
  try {
    doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  } catch {
    return undefined;
  }
  const duplicate = doc.errors.find(error => /unique/i.test(error.message));
  if (!duplicate) return undefined;
  return yamlErrorToParseError(duplicate);
}

function yamlErrorToParseError(error: YAMLError): ModelsConfigParseError {
  const message = error.message.replace(/^YAML(?:ParseError|Warning):\s*/i, "");
  const position = error.linePos?.[0];
  return {
    code: /unique/i.test(message) ? "duplicate-key" : "yaml-syntax",
    message: position ? `${message} (line ${position.line}, column ${position.col})` : message,
    ...(position ? { line: position.line, column: position.col } : {}),
  };
}

function yamlSyntaxError(error: unknown): ModelsConfigParseError {
  const raw = error instanceof Error ? error.message : "YAML could not be parsed";
  return { code: "yaml-syntax", message: raw.replace(/^YAML(?:ParseError|Warning):\s*/i, "") };
}

function jsonSyntaxMessage(error: unknown): string {
  if (error instanceof SyntaxError && error.message) return error.message.replace(/^JSON\.parse:\s*/i, "");
  if (error instanceof Error && error.message) return error.message;
  return "JSON could not be parsed";
}
