/**
 * Agent pages — manifest parsing, page-root resolution, and containment.
 *
 * A page lives at `<agent-pages root>/<id>/page.json`. The loader resolves the
 * root, the page directory, and the manifest entry with `realpath` before
 * accepting them, so a symlink or a `..` segment cannot point the host outside
 * the root. `page.json` itself is parsed strictly: unknown keys, malformed
 * permissions, and unsafe step paths are rejected instead of silently ignored.
 */

import type { Stats } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import {
	AGENT_PAGE_MANIFEST_FILE,
	AGENT_PAGE_MAX_STEPS,
	AGENT_PAGE_MAX_WORKFLOWS,
	AGENT_PAGE_ROOT_DIR_NAME,
	AGENT_PAGE_SCHEMA,
	AgentPageError,
	type AgentPageJsonValue,
	type AgentPageListResult,
	type AgentPageListWarning,
	type AgentPageLocation,
	type AgentPageManifest,
	type AgentPageOutputType,
	type AgentPagePermission,
	type AgentPagePermissions,
	type AgentPageStep,
	type AgentPageWorkflow,
} from "./types";

/** One segment-safe page or workflow id; the gateway uses the same pattern. */
export const AGENT_PAGE_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
const AGENT_PAGE_ID_RE = new RegExp(`^${AGENT_PAGE_ID_PATTERN}$`);
const STEP_PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const TEMPLATE_INPUT_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ENTRY_EXTENSIONS: Readonly<Record<string, true>> = {
	".html": true,
	".htm": true,
	".mjs": true,
	".js": true,
};
const OUTPUT_TYPES: Readonly<Record<AgentPageOutputType, true>> = {
	text: true,
	json: true,
	number: true,
	boolean: true,
};
const MAX_MANIFEST_BYTES = 1024 * 1024;
// Windows resolves these names to devices even under a directory, so they are
// not page-relative files at all.
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isAgentPageId(value: unknown): value is string {
	return typeof value === "string" && AGENT_PAGE_ID_RE.test(value);
}

export function isAgentPagePathWithin(
	root: string,
	target: string,
	options: { readonly allowRoot?: boolean } = {},
): boolean {
	const from = process.platform === "win32" ? root.toLowerCase() : root;
	const to = process.platform === "win32" ? target.toLowerCase() : target;
	const rel = path.relative(from, to);
	if (rel === "") return options.allowRoot === true;
	return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/**
 * The agent-pages root: an explicit argument (tests) wins, then
 * `ZETA_AGENT_PAGES_DIR`, then `<agent dir>/agent-pages`.
 */
export function resolveAgentPagesRoot(explicit?: string): string {
	const requested = explicit?.trim();
	if (requested) return path.resolve(requested);
	const fromEnv = process.env.ZETA_AGENT_PAGES_DIR?.trim();
	if (fromEnv) return path.resolve(fromEnv);
	return path.join(getAgentDir(), AGENT_PAGE_ROOT_DIR_NAME);
}

function invalidManifest(message: string, details?: Record<string, unknown>): AgentPageError {
	return new AgentPageError("invalid_manifest", message, 422, details);
}

function unknownPage(pageId: string): AgentPageError {
	return new AgentPageError("unknown_page", `Unknown agent page: ${pageId}`, 404, { pageId });
}

function isNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw invalidManifest(`${field} must be an object`, { field });
	}
	return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			throw invalidManifest(`${field}.${key} is not supported`, { field: `${field}.${key}` });
		}
	}
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function stringValue(value: unknown, field: string, maxLength = 512): string {
	if (typeof value !== "string") throw invalidManifest(`${field} must be a string`, { field });
	if (value.length === 0 || value.length > maxLength) {
		throw invalidManifest(`${field} must contain 1-${maxLength} characters`, { field });
	}
	return value;
}

function parseId(value: unknown, field: string): string {
	const id = stringValue(value, field, 64);
	if (!AGENT_PAGE_ID_RE.test(id)) {
		throw invalidManifest(`${field} must match ${AGENT_PAGE_ID_PATTERN}`, { field });
	}
	return id;
}

function parseJsonValue(value: unknown, field: string, depth = 0): AgentPageJsonValue {
	if (depth > 32) throw invalidManifest(`${field} is nested too deeply`, { field });
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw invalidManifest(`${field} must be a finite number`, { field });
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => parseJsonValue(entry, `${field}[${index}]`, depth + 1));
	}
	if (typeof value === "object") {
		const source = value as Record<string, unknown>;
		const result: Record<string, AgentPageJsonValue> = {};
		for (const [key, entry] of Object.entries(source)) {
			Object.defineProperty(result, key, {
				value: parseJsonValue(entry, `${field}.${key}`, depth + 1),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return result;
	}
	throw invalidManifest(`${field} must be a JSON value`, { field });
}

function inferOutputType(value: AgentPageJsonValue): AgentPageOutputType {
	if (typeof value === "string") return "text";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	return "json";
}

function parseOutputType(value: unknown, field: string): AgentPageOutputType | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !Object.hasOwn(OUTPUT_TYPES, value)) {
		throw invalidManifest(`${field} must be text, json, number, or boolean`, { field });
	}
	return value as AgentPageOutputType;
}

function requireOutputType(
	declared: AgentPageOutputType | undefined,
	expected: AgentPageOutputType,
	field: string,
): AgentPageOutputType | undefined {
	if (declared !== undefined && declared !== expected) {
		throw invalidManifest(`${field} must be "${expected}" for this step kind`, { field });
	}
	return declared;
}

/**
 * Normalize a page-relative path. Absolute paths, drive/UNC spellings,
 * backslashes, query/hash markers, wildcard characters, empty segments, and
 * `.`/`..` segments are all rejected: the string is a literal path, never a
 * glob or a URL.
 */
export function normalizePageRelativePath(
	value: unknown,
	field: string,
	options: { readonly allowTrailingSlash?: boolean } = {},
): string {
	const raw = stringValue(value, field, 512);
	if (raw !== raw.trim()) throw invalidManifest(`${field} must not start or end with whitespace`, { field });
	if (/[\u0000-\u001f\\:?#*]/.test(raw)) {
		throw invalidManifest(`${field} contains a forbidden character`, { field });
	}
	if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
		throw invalidManifest(`${field} must be relative to the page root`, { field });
	}
	const trailingSlash = raw.endsWith("/");
	if (trailingSlash && options.allowTrailingSlash !== true) {
		throw invalidManifest(`${field} must name a file, not a directory`, { field });
	}
	const body = trailingSlash ? raw.slice(0, -1) : raw;
	if (body === "") throw invalidManifest(`${field} must name a file or directory`, { field });
	const segments = body.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") {
			throw invalidManifest(`${field} must not contain empty, "." or ".." segments`, { field });
		}
		if (process.platform === "win32") {
			if (/[. ]$/.test(segment) || WINDOWS_RESERVED_NAME_RE.test(segment)) {
				throw invalidManifest(`${field} contains a Windows-reserved path segment`, { field });
			}
		}
	}
	const normalized = segments.join("/");
	return trailingSlash ? `${normalized}/` : normalized;
}

function parseEntry(value: unknown): string {
	const entry = normalizePageRelativePath(value, "manifest.entry");
	const extension = path.posix.extname(entry).toLowerCase();
	if (!(extension in ENTRY_EXTENSIONS)) {
		throw invalidManifest("manifest.entry must be an .html, .htm, .mjs, or .js file", { field: "manifest.entry" });
	}
	return entry;
}

function normalizeNetworkGrant(value: unknown, field: string): string {
	const raw = stringValue(value, field, 253);
	if (raw !== raw.trim()) throw invalidManifest(`${field} must not start or end with whitespace`, { field });
	const host = raw.toLowerCase();
	const withoutWildcard = host.startsWith("*.") ? host.slice(2) : host;
	if (withoutWildcard === "") throw invalidManifest(`${field} must name a host`, { field });
	if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(withoutWildcard) || withoutWildcard.includes("..")) {
		throw invalidManifest(`${field} must name a host without a port, path, or scheme`, { field });
	}
	return host;
}

function parsePermissions(value: unknown): AgentPagePermissions {
	if (value === undefined) return { read: [], write: [], network: [], spawn: [] };
	const source = recordValue(value, "manifest.permissions");
	assertKnownKeys(source, ["read", "write", "network", "spawn"], "manifest.permissions");
	const parseList = (key: AgentPagePermission): readonly string[] => {
		const raw = source[key];
		if (raw === undefined) return [];
		if (!Array.isArray(raw)) throw invalidManifest(`manifest.permissions.${key} must be an array`, { field: key });
		if (raw.length > 64) throw invalidManifest(`manifest.permissions.${key} has too many entries`, { field: key });
		const normalized: string[] = [];
		for (const entry of raw) {
			if (key === "network") normalized.push(normalizeNetworkGrant(entry, `manifest.permissions.${key}`));
			else if (key === "spawn") normalized.push(parseId(entry, `manifest.permissions.${key}`));
			else {
				normalized.push(
					normalizePageRelativePath(entry, `manifest.permissions.${key}`, { allowTrailingSlash: true }),
				);
			}
		}
		return [...new Set(normalized)];
	};
	return {
		read: parseList("read"),
		write: parseList("write"),
		network: parseList("network"),
		spawn: parseList("spawn"),
	};
}

function parseStepIds(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) throw invalidManifest(`${field} must be an array`, { field });
	if (value.length > AGENT_PAGE_MAX_STEPS) throw invalidManifest(`${field} has too many entries`, { field });
	return value.map((entry, index) => parseId(entry, `${field}[${index}]`));
}

function parseStepInputs(value: unknown, field: string): Record<string, string> {
	const source = recordValue(value, field);
	const inputs: Record<string, string> = {};
	for (const [name, stepId] of Object.entries(source)) {
		if (!TEMPLATE_INPUT_NAME_RE.test(name)) {
			throw invalidManifest(`${field}.${name} must be a template input name`, { field });
		}
		Object.defineProperty(inputs, name, {
			value: parseId(stepId, `${field}.${name}`),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return inputs;
}

function parseTemplatePlaceholders(template: string, field: string): string[] {
	const names: string[] = [];
	for (const match of template.matchAll(STEP_PLACEHOLDER_RE)) {
		const name = match[1];
		if (name !== undefined) names.push(name);
	}
	for (const name of names) {
		if (!TEMPLATE_INPUT_NAME_RE.test(name)) {
			throw invalidManifest(`${field} contains an invalid placeholder name`, { field });
		}
	}
	return names;
}

/**
 * Parse one step. The union is discriminated by `kind`; every kind has a
 * closed key list so a typo cannot silently become an ignored capability.
 */
function parseStep(value: unknown, field: string): AgentPageStep {
	const source = recordValue(value, field);
	const kind = stringValue(source.kind, `${field}.kind`, 32);
	const id = parseId(source.id, `${field}.id`);
	const dependsOn = source.dependsOn === undefined ? undefined : parseStepIds(source.dependsOn, `${field}.dependsOn`);
	const output = parseOutputType(source.output, `${field}.output`);
	const common = ["id", "kind", "dependsOn", "output"] as const;
	const withBase = <T extends object>(
		step: T,
	): T & { id: string; dependsOn?: readonly string[]; output?: AgentPageOutputType } => ({
		id,
		...(dependsOn === undefined ? {} : { dependsOn }),
		...(output === undefined ? {} : { output }),
		...step,
	});

	switch (kind) {
		case "constant": {
			assertKnownKeys(source, [...common, "value"], field);
			if (!hasOwn(source, "value")) throw invalidManifest(`${field}.value is required`, { field });
			const constant = parseJsonValue(source.value, `${field}.value`);
			const inferred = inferOutputType(constant);
			requireOutputType(output, inferred, `${field}.output`);
			return withBase({ kind: "constant" as const, value: constant });
		}
		case "template": {
			assertKnownKeys(source, [...common, "template", "inputs"], field);
			const template = stringValue(source.template, `${field}.template`, 16 * 1024);
			const inputs = source.inputs === undefined ? {} : parseStepInputs(source.inputs, `${field}.inputs`);
			for (const name of parseTemplatePlaceholders(template, `${field}.template`)) {
				if (!Object.hasOwn(inputs, name)) {
					throw invalidManifest(`${field}.template references undeclared input "${name}"`, { field });
				}
			}
			requireOutputType(output, "text", `${field}.output`);
			return withBase({
				kind: "template" as const,
				template,
				...(Object.keys(inputs).length === 0 ? {} : { inputs }),
			});
		}
		case "read": {
			assertKnownKeys(source, [...common, "path"], field);
			const stepPath = normalizePageRelativePath(source.path, `${field}.path`);
			requireOutputType(output, "text", `${field}.output`);
			return withBase({ kind: "read" as const, path: stepPath });
		}
		case "write": {
			assertKnownKeys(source, [...common, "path", "input", "value"], field);
			const stepPath = normalizePageRelativePath(source.path, `${field}.path`);
			const hasInput = hasOwn(source, "input");
			const hasValue = hasOwn(source, "value");
			if (hasInput === hasValue) {
				throw invalidManifest(`${field} must have exactly one of input or value`, { field });
			}
			requireOutputType(output, "text", `${field}.output`);
			if (hasInput) {
				return withBase({ kind: "write" as const, path: stepPath, input: parseId(source.input, `${field}.input`) });
			}
			return withBase({
				kind: "write" as const,
				path: stepPath,
				value: parseJsonValue(source.value, `${field}.value`),
			});
		}
		case "fetch": {
			assertKnownKeys(source, [...common, "url"], field);
			parseAgentPageHttpUrl(source.url, `${field}.url`);
			requireOutputType(output, "text", `${field}.output`);
			return withBase({ kind: "fetch" as const, url: stringValue(source.url, `${field}.url`, 2048) });
		}
		case "spawn": {
			assertKnownKeys(source, [...common, "workflow"], field);
			requireOutputType(output, "json", `${field}.output`);
			return withBase({ kind: "spawn" as const, workflow: parseId(source.workflow, `${field}.workflow`) });
		}
		default:
			throw invalidManifest(`${field}.kind "${kind}" is not supported`, { field });
	}
}

/** Parse an HTTP(S) fetch target; credentials in the URL are refused. */
export function parseAgentPageHttpUrl(value: unknown, field: string): URL {
	const raw = stringValue(value, field, 2048);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw invalidManifest(`${field} must be an absolute HTTP(S) URL`, { field });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw invalidManifest(`${field} must use http or https`, { field });
	}
	if (url.username !== "" || url.password !== "") {
		throw invalidManifest(`${field} must not contain credentials`, { field });
	}
	return url;
}

function parseWorkflows(value: unknown): AgentPageWorkflow[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw invalidManifest("manifest.workflows must be an array", { field: "workflows" });
	if (value.length > AGENT_PAGE_MAX_WORKFLOWS) {
		throw invalidManifest(`manifest.workflows may contain at most ${AGENT_PAGE_MAX_WORKFLOWS} entries`, {
			field: "workflows",
		});
	}
	const workflows: AgentPageWorkflow[] = [];
	const workflowIds = new Set<string>();
	for (const [index, raw] of value.entries()) {
		const field = `manifest.workflows[${index}]`;
		const source = recordValue(raw, field);
		assertKnownKeys(source, ["id", "name", "steps"], field);
		const id = parseId(source.id, `${field}.id`);
		if (workflowIds.has(id)) throw invalidManifest(`duplicate workflow id "${id}"`, { field });
		workflowIds.add(id);
		const name = source.name === undefined ? undefined : stringValue(source.name, `${field}.name`, 120).trim();
		if (name === "") throw invalidManifest(`${field}.name must not be blank`, { field: `${field}.name` });
		const rawSteps = source.steps;
		if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
			throw invalidManifest(`${field}.steps must be a non-empty array`, { field: `${field}.steps` });
		}
		if (rawSteps.length > AGENT_PAGE_MAX_STEPS) {
			throw invalidManifest(`${field}.steps may contain at most ${AGENT_PAGE_MAX_STEPS} entries`, {
				field: `${field}.steps`,
			});
		}
		const steps = rawSteps.map((step, stepIndex) => parseStep(step, `${field}.steps[${stepIndex}]`));
		const stepIds = new Set<string>();
		for (const step of steps) {
			if (stepIds.has(step.id)) throw invalidManifest(`duplicate step id "${step.id}"`, { field: `${field}.steps` });
			stepIds.add(step.id);
		}
		for (const step of steps) {
			const references = new Set<string>(step.dependsOn ?? []);
			if (step.kind === "template") {
				for (const inputStep of Object.values(step.inputs ?? {})) references.add(inputStep);
			}
			if (step.kind === "write" && step.input !== undefined) references.add(step.input);
			for (const reference of references) {
				if (reference === step.id) {
					throw invalidManifest(`step "${step.id}" depends on itself`, { workflow: id, step: step.id });
				}
				if (!stepIds.has(reference)) {
					throw invalidManifest(`step "${step.id}" depends on unknown step "${reference}"`, {
						workflow: id,
						step: step.id,
						reference,
					});
				}
			}
		}
		workflows.push({
			id,
			...(name === undefined ? {} : { name }),
			steps,
		});
	}
	for (const workflow of workflows) {
		for (const step of workflow.steps) {
			if (step.kind !== "spawn") continue;
			if (!workflowIds.has(step.workflow)) {
				throw invalidManifest(`workflow "${workflow.id}" spawns unknown workflow "${step.workflow}"`, {
					workflow: workflow.id,
					step: step.id,
				});
			}
		}
	}
	return workflows;
}

/**
 * Validate a parsed-or-raw manifest. `expectedId` is the page directory name:
 * a manifest cannot be dropped into one directory and claim another id.
 */
export function parseAgentPageManifest(value: unknown, expectedId?: string): AgentPageManifest {
	const source = recordValue(value, "manifest");
	assertKnownKeys(source, ["schema", "id", "name", "entry", "permissions", "workflows"], "manifest");
	if (source.schema !== AGENT_PAGE_SCHEMA) {
		throw invalidManifest(`manifest.schema must be "${AGENT_PAGE_SCHEMA}"`, { field: "schema" });
	}
	const id = parseId(source.id, "manifest.id");
	if (expectedId !== undefined && id !== expectedId) {
		throw invalidManifest(`manifest.id must match its directory "${expectedId}"`, { field: "id" });
	}
	const name = stringValue(source.name, "manifest.name", 120).trim();
	if (name === "") throw invalidManifest("manifest.name must not be blank", { field: "name" });
	const entry = parseEntry(source.entry);
	const permissions = parsePermissions(source.permissions);
	const workflows = parseWorkflows(source.workflows);
	return {
		schema: AGENT_PAGE_SCHEMA,
		id,
		name,
		entry,
		permissions,
		workflows,
	};
}

/**
 * Resolve an existing regular file inside a page root. Both the lexical path
 * and the post-`realpath` path are checked, so an intermediate symlink cannot
 * escape the page.
 */
export async function resolveAgentPageFile(pageRoot: string, relativePath: string): Promise<string> {
	const relative = normalizePageRelativePath(relativePath, "path");
	const root = path.resolve(pageRoot);
	const target = path.join(root, ...relative.split("/"));
	if (!isAgentPagePathWithin(root, target)) {
		throw new AgentPageError("path_outside_root", "Page file is outside the page root", 400);
	}
	try {
		const realRoot = await realpath(root);
		const realTarget = await realpath(target);
		if (!isAgentPagePathWithin(realRoot, realTarget)) {
			throw new AgentPageError("path_outside_root", "Page file is outside the page root", 400);
		}
		const stats = await stat(realTarget);
		if (!stats.isFile()) throw new AgentPageError("unknown_page", "Page file not found", 404);
		return realTarget;
	} catch (error) {
		if (error instanceof AgentPageError) throw error;
		if (isNotFound(error)) throw new AgentPageError("unknown_page", "Page file not found", 404);
		throw new AgentPageError("invalid_request", "Unable to resolve the page file", 400);
	}
}

/**
 * Resolve a file path for writing inside a page root. The final file may not
 * exist yet, but its parent must already resolve inside the page; a symlink at
 * the final path (including a broken one) has to resolve inside too.
 */
export async function resolveAgentPageWritePath(pageRoot: string, relativePath: string): Promise<string> {
	const relative = normalizePageRelativePath(relativePath, "path");
	const root = path.resolve(pageRoot);
	const target = path.join(root, ...relative.split("/"));
	if (!isAgentPagePathWithin(root, target)) {
		throw new AgentPageError("path_outside_root", "Write path is outside the page root", 400);
	}
	try {
		const realRoot = await realpath(root);
		const realParent = await realpath(path.dirname(target));
		if (!isAgentPagePathWithin(realRoot, realParent)) {
			throw new AgentPageError("path_outside_root", "Write path is outside the page root", 400);
		}
		const parentStats = await stat(realParent);
		if (!parentStats.isDirectory())
			throw new AgentPageError("invalid_request", "Write parent is not a directory", 400);
		const canonical = path.join(realParent, path.basename(target));

		let existing: Stats | null = null;
		try {
			existing = await lstat(canonical);
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
		if (existing === null) return canonical;
		if (existing.isSymbolicLink()) {
			const realTarget = await realpath(canonical);
			if (!isAgentPagePathWithin(realRoot, realTarget)) {
				throw new AgentPageError("path_outside_root", "Write path is outside the page root", 400);
			}
			const targetStats = await stat(realTarget);
			if (!targetStats.isFile()) throw new AgentPageError("invalid_request", "Write target is not a file", 400);
			return realTarget;
		}
		if (existing.isDirectory()) throw new AgentPageError("invalid_request", "Write target is a directory", 400);
		return canonical;
	} catch (error) {
		if (error instanceof AgentPageError) throw error;
		if (isNotFound(error)) throw new AgentPageError("invalid_request", "Write parent does not exist", 400);
		throw new AgentPageError("invalid_request", "Unable to resolve the write path", 400);
	}
}

/**
 * Load one page by id. A directory symlink, a manifest symlink, or an entry
 * symlink that lands outside the root is rejected rather than followed.
 */
export async function loadAgentPage(rootDir: string, pageId: string): Promise<AgentPageLocation> {
	if (!isAgentPageId(pageId)) throw unknownPage(pageId);
	const root = resolveAgentPagesRoot(rootDir);
	let realRoot: string;
	try {
		realRoot = await realpath(root);
		const rootStats = await stat(realRoot);
		if (!rootStats.isDirectory()) throw unknownPage(pageId);
	} catch (error) {
		if (error instanceof AgentPageError) throw error;
		throw unknownPage(pageId);
	}

	const lexicalPageDir = path.join(realRoot, pageId);
	if (!isAgentPagePathWithin(realRoot, lexicalPageDir)) throw unknownPage(pageId);
	let pageRoot: string;
	try {
		pageRoot = await realpath(lexicalPageDir);
	} catch (error) {
		if (isNotFound(error)) throw unknownPage(pageId);
		throw new AgentPageError("invalid_request", `Unable to read agent page: ${pageId}`, 400, { pageId });
	}
	if (!isAgentPagePathWithin(realRoot, pageRoot)) {
		throw new AgentPageError("path_outside_root", "Page directory is outside the agent-pages root", 400, { pageId });
	}
	try {
		const pageStats = await stat(pageRoot);
		if (!pageStats.isDirectory()) throw unknownPage(pageId);
	} catch (error) {
		if (error instanceof AgentPageError) throw error;
		throw unknownPage(pageId);
	}

	const manifestPath = path.join(pageRoot, AGENT_PAGE_MANIFEST_FILE);
	let realManifestPath: string;
	try {
		realManifestPath = await realpath(manifestPath);
	} catch (error) {
		if (isNotFound(error)) throw invalidManifest(`${AGENT_PAGE_MANIFEST_FILE} is missing`, { pageId });
		throw new AgentPageError("invalid_request", "Unable to read the page manifest", 400, { pageId });
	}
	if (!isAgentPagePathWithin(pageRoot, realManifestPath)) {
		throw new AgentPageError("path_outside_root", "Page manifest is outside the page root", 400, { pageId });
	}
	let parsed: unknown;
	try {
		const manifestStats = await stat(realManifestPath);
		if (!manifestStats.isFile()) throw invalidManifest(`${AGENT_PAGE_MANIFEST_FILE} is not a file`, { pageId });
		if (manifestStats.size > MAX_MANIFEST_BYTES) {
			throw invalidManifest(`${AGENT_PAGE_MANIFEST_FILE} is too large`, { pageId });
		}
		parsed = JSON.parse(await readFile(realManifestPath, "utf8"));
	} catch (error) {
		if (error instanceof AgentPageError) throw error;
		throw invalidManifest(`${AGENT_PAGE_MANIFEST_FILE} is not valid JSON`, { pageId });
	}
	const manifest = parseAgentPageManifest(parsed, pageId);
	let entryPath: string;
	try {
		entryPath = await resolveAgentPageFile(pageRoot, manifest.entry);
	} catch (error) {
		if (error instanceof AgentPageError) {
			throw invalidManifest("manifest.entry does not resolve to a file inside the page root", {
				pageId,
				reason: error.code,
			});
		}
		throw invalidManifest("manifest.entry does not resolve to a file inside the page root", { pageId });
	}
	return { id: pageId, root: pageRoot, manifest, entryPath };
}

function warningFor(id: string, error: unknown): AgentPageListWarning {
	if (error instanceof AgentPageError) return { id, error: error.message };
	return { id, error: "unreadable page" };
}

/** Inventory every loadable page under the root; malformed pages are warnings. */
export async function listAgentPages(rootDir?: string): Promise<AgentPageListResult> {
	const root = resolveAgentPagesRoot(rootDir);
	let realRoot: string;
	try {
		realRoot = await realpath(root);
		const rootStats = await stat(realRoot);
		if (!rootStats.isDirectory()) return { pages: [], warnings: [] };
	} catch {
		return { pages: [], warnings: [] };
	}
	let entries;
	try {
		entries = await readdir(realRoot, { withFileTypes: true });
	} catch {
		return { pages: [], warnings: [] };
	}
	const pages: AgentPageLocation[] = [];
	const warnings: AgentPageListWarning[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (entry.name.startsWith(".") || !isAgentPageId(entry.name)) continue;
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		try {
			pages.push(await loadAgentPage(realRoot, entry.name));
		} catch (error) {
			warnings.push(warningFor(entry.name, error));
		}
	}
	return { pages, warnings };
}
