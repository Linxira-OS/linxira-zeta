/**
 * Agent pages — manifest and workflow contracts.
 *
 * A page is a directory under the agent-pages root containing `page.json`, an
 * HTML or ESM entry, and any static assets. The manifest declares four
 * capabilities — `read`, `write`, `network`, `spawn` — and every workflow step
 * that touches the filesystem, the network, or another workflow must be covered
 * by the matching grant. An omitted permission is an empty grant: all four are
 * denied by default.
 *
 * Workflows are declarative DAGs. Steps never run shell commands and never
 * execute source from the page; the only step kinds are `constant`, `template`,
 * `read`, `write`, `fetch`, and `spawn` (which composes another declared
 * workflow in-process).
 */

/** JSON value accepted by the manifest and returned by workflow steps. */
export type AgentPageJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly AgentPageJsonValue[]
	| { readonly [key: string]: AgentPageJsonValue };

/** Runtime type carried with every step output. */
export type AgentPageOutputType = "text" | "json" | "number" | "boolean";

/** A step's typed output; `type` matches the runtime shape of `value`. */
export interface AgentPageStepOutput {
	readonly stepId: string;
	readonly type: AgentPageOutputType;
	readonly value: AgentPageJsonValue;
}

/** Capability grants. Missing arrays are treated as empty by the parser. */
export interface AgentPagePermissions {
	/** Page-relative file paths or directory prefixes (`data/`). */
	readonly read: readonly string[];
	/** Page-relative file paths or directory prefixes (`out/`). */
	readonly write: readonly string[];
	/** Allowed fetch hosts, exact (`api.example.com`) or subdomain (`*.example.com`). */
	readonly network: readonly string[];
	/** Workflow ids this page may compose through a `spawn` step. */
	readonly spawn: readonly string[];
}

export type AgentPagePermission = keyof AgentPagePermissions;

interface AgentPageStepBase {
	readonly id: string;
	readonly dependsOn?: readonly string[];
	readonly output?: AgentPageOutputType;
}

export interface AgentPageConstantStep extends AgentPageStepBase {
	readonly kind: "constant";
	readonly value: AgentPageJsonValue;
}

export interface AgentPageTemplateStep extends AgentPageStepBase {
	readonly kind: "template";
	readonly template: string;
	readonly inputs?: Readonly<Record<string, string>>;
}

export interface AgentPageReadStep extends AgentPageStepBase {
	readonly kind: "read";
	readonly path: string;
}

export interface AgentPageWriteStep extends AgentPageStepBase {
	readonly kind: "write";
	readonly path: string;
	/** Step id whose output becomes the file body. Exactly one of input/value. */
	readonly input?: string;
	/** Literal file body. Exactly one of input/value. */
	readonly value?: AgentPageJsonValue;
}

export interface AgentPageFetchStep extends AgentPageStepBase {
	readonly kind: "fetch";
	readonly url: string;
}

export interface AgentPageSpawnStep extends AgentPageStepBase {
	readonly kind: "spawn";
	readonly workflow: string;
}

export type AgentPageStep =
	| AgentPageConstantStep
	| AgentPageTemplateStep
	| AgentPageReadStep
	| AgentPageWriteStep
	| AgentPageFetchStep
	| AgentPageSpawnStep;

export interface AgentPageWorkflow {
	readonly id: string;
	readonly name?: string;
	readonly steps: readonly AgentPageStep[];
}

export interface AgentPageManifest {
	readonly schema: typeof AGENT_PAGE_SCHEMA;
	readonly id: string;
	readonly name: string;
	/** Page-relative HTML or ESM entry. */
	readonly entry: string;
	readonly permissions: AgentPagePermissions;
	readonly workflows: readonly AgentPageWorkflow[];
}

/** A loaded page: validated manifest plus the real page root and entry path. */
export interface AgentPageLocation {
	readonly id: string;
	readonly root: string;
	readonly manifest: AgentPageManifest;
	/** Real absolute path of the manifest entry, confined to `root`. */
	readonly entryPath: string;
}

export interface AgentPageListWarning {
	readonly id: string;
	readonly error: string;
}

export interface AgentPageListResult {
	readonly pages: readonly AgentPageLocation[];
	readonly warnings: readonly AgentPageListWarning[];
}

/** One request to the permission checker. */
export type AgentPagePermissionRequest =
	| { readonly permission: "read"; readonly path: string }
	| { readonly permission: "write"; readonly path: string }
	| { readonly permission: "network"; readonly url: string | URL }
	| { readonly permission: "spawn"; readonly workflow: string };

export interface AgentPagePermissionDecision {
	readonly allowed: boolean;
	readonly permission: AgentPagePermission;
	/** Normalized resource: page-relative path, host, or workflow id. */
	readonly resource: string;
	readonly reason: string;
}

export interface AgentPageWorkflowRunOptions {
	readonly manifest: AgentPageManifest;
	/** Real page root; every read/write path is confined to it. */
	readonly pageRoot: string;
	readonly workflowId: string;
	readonly signal?: AbortSignal;
	/** Bounded step concurrency; defaults to 4 and never exceeds 16. */
	readonly concurrency?: number;
	/** Injected fetch for tests and alternate hosts; defaults to global fetch. */
	readonly fetchImpl?: AgentPageFetch;
	readonly maxSpawnDepth?: number;
}

/** Minimal fetch shape the executor uses; Bun's global fetch adds `preconnect`. */
export type AgentPageFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AgentPageWorkflowRunResult {
	readonly pageId: string;
	readonly workflowId: string;
	/** Outputs in the workflow's topological order. */
	readonly outputs: Readonly<Record<string, AgentPageStepOutput>>;
	readonly order: readonly string[];
	readonly durationMs: number;
}

export type AgentPageErrorCode =
	| "invalid_manifest"
	| "invalid_request"
	| "unknown_page"
	| "unknown_workflow"
	| "unknown_step"
	| "duplicate_step"
	| "cycle"
	| "permission_denied"
	| "path_outside_root"
	| "limit_exceeded"
	| "cancelled"
	| "step_failed";

export class AgentPageError extends Error {
	constructor(
		readonly code: AgentPageErrorCode,
		message: string,
		readonly status = 400,
		readonly details?: Readonly<Record<string, unknown>>,
	) {
		super(message);
		this.name = "AgentPageError";
	}
}

export const AGENT_PAGE_SCHEMA = "agent-page/1";
export const AGENT_PAGE_MANIFEST_FILE = "page.json";
export const AGENT_PAGE_ROOT_DIR_NAME = "agent-pages";
export const AGENT_PAGE_MAX_WORKFLOWS = 64;
export const AGENT_PAGE_MAX_STEPS = 256;
export const AGENT_PAGE_MAX_SPAWN_DEPTH = 8;
export const AGENT_PAGE_DEFAULT_CONCURRENCY = 4;
export const AGENT_PAGE_MAX_CONCURRENCY = 16;
