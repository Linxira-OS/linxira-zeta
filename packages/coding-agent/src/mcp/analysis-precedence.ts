/**
 * Analysis-MCP recognition and collision resolution.
 *
 * Project analysis servers (CodeGraph today, other explicitly declared
 * analysis servers later) are optional MCP capabilities. This module decides
 * which one is *mounted* and which one is *shadowed*; it never spawns a
 * process, installs a package, or marks a detected-but-unconfigured server as
 * available. Detection reads only declared project metadata and explicit
 * `mcpServers` entries.
 *
 * The resolver is pure. Manager/SDK callers pass the current config snapshot,
 * the currently active native tool names, and the current profile allowlist;
 * `list_changed`/reconnect must call it again instead of caching a mount or
 * approval decision. `ask` is a request descriptor only: the caller must use
 * the host's existing `requestApproval` (or leave the server unmounted when no
 * UI can answer). It must not add a new security prompt, and YOLO does not
 * bypass it.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { isRecord } from "@linxiraos/pi-utils";
import type { MCPServerConfig } from "./types";

export type McpPrecedence = "native" | "mcp" | "ask";

/**
 * An analysis server Zeta knows how to recognize. The manifest is explicit:
 * matching is by server name, declared package name, or a project marker, not
 * by guessing from arbitrary commands or package names.
 */
export interface AnalysisMcpManifest {
	readonly id: string;
	readonly label: string;
	/** Server names that identify this capability. */
	readonly serverNames: readonly string[];
	/** Explicit package names that may appear in a command/args or package.json. */
	readonly packageNames: readonly string[];
	/** Project-relative markers that indicate the capability is present but may not be configured. */
	readonly markerPaths: readonly string[];
	/** Native tools that cover the same capability. Empty means complementary. */
	readonly nativeTools: readonly string[];
	/** Tool names this server is expected to expose. */
	readonly tools: readonly string[];
}

/** The known analysis-MCP set. CodeGraph is complementary to native search. */
export const ANALYSIS_MCP_MANIFESTS: readonly AnalysisMcpManifest[] = [
	{
		id: "codegraph",
		label: "CodeGraph",
		serverNames: ["codegraph"],
		packageNames: ["@colbymchenry/codegraph"],
		markerPaths: [".codegraph"],
		// CodeGraph answers structural graph questions; native grep/ast_grep are
		// complementary, not a same-capability replacement. A future native
		// code-graph tool can declare itself here without changing the resolver.
		nativeTools: [],
		tools: ["codegraph_explore"],
	},
];

/** Declared project signals; no package manager or process is consulted. */
export interface AnalysisMcpProjectSignals {
	readonly packageNames: readonly string[];
	readonly markerPaths: readonly string[];
}

/** Read only declared metadata (`package.json`) plus marker existence. */
export async function inspectProjectAnalysisMcp(
	cwd: string,
	manifests: readonly AnalysisMcpManifest[] = ANALYSIS_MCP_MANIFESTS,
): Promise<AnalysisMcpProjectSignals> {
	const packageNames = new Set<string>();
	try {
		const raw: unknown = await Bun.file(path.join(cwd, "package.json")).json();
		if (isRecord(raw)) {
			for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
				const block = raw[field];
				if (isRecord(block)) {
					for (const name of Object.keys(block)) packageNames.add(name);
				}
			}
		}
	} catch {
		// No package.json, malformed JSON, or a read error means no declared
		// package signal. Marker detection still works and nothing is executed.
	}

	const markerPaths = new Set<string>();
	for (const manifest of manifests) {
		for (const packageName of manifest.packageNames) {
			if (existsSync(path.join(cwd, "node_modules", packageName, "package.json"))) {
				packageNames.add(packageName);
			}
		}
		for (const marker of manifest.markerPaths) {
			if (existsSync(path.join(cwd, marker))) markerPaths.add(marker);
		}
	}

	return { packageNames: [...packageNames], markerPaths: [...markerPaths] };
}

export interface AnalysisMcpResolveInput {
	readonly configs: Readonly<Record<string, MCPServerConfig>>;
	/** Server name -> current `tools/list` names. */
	readonly serverTools?: Readonly<Record<string, readonly string[]>>;
	readonly precedence: McpPrecedence;
	/** Only tools that are currently active/enabled; disabled native tools cannot shadow. */
	readonly activeNativeTools: readonly string[];
	/** Tool-profile allowlist; undefined means unrestricted. */
	readonly allowedTools?: readonly string[] | ReadonlySet<string>;
	/** Server-scoped profile admission; raw function names can repeat across servers. */
	readonly allowedServerTools?: Readonly<Record<string, readonly string[]>>;
	/** Persistent user denylist, highest precedence. */
	readonly deniedServers?: readonly string[];
	readonly project?: AnalysisMcpProjectSignals;
	readonly manifests?: readonly AnalysisMcpManifest[];
	/** Explicit grants for this refresh only; the hook never carries them across refreshes. */
	readonly approvedServers?: readonly string[];
}

export interface AnalysisMcpApprovalRequest {
	readonly kind: "mcp-precedence";
	readonly manifestId: string;
	readonly serverName: string;
	readonly nativeTools: readonly string[];
	readonly prompt: string;
}

export type AnalysisMcpDecisionState =
	| "mounted"
	| "shadowed-native"
	| "shadowed-duplicate"
	| "shadowed-denied"
	| "shadowed-profile"
	| "ask"
	| "detected"
	| "unconfigured";

export interface AnalysisMcpDecision {
	readonly manifestId: string;
	readonly label: string;
	readonly serverName?: string;
	readonly state: AnalysisMcpDecisionState;
	readonly configured: boolean;
	readonly mount: boolean;
	readonly reason: string;
	readonly tools?: readonly string[];
	readonly suppressNativeTools?: readonly string[];
	readonly approval?: AnalysisMcpApprovalRequest;
}

function serverText(name: string, config: MCPServerConfig): string {
	const parts = [name];
	if ("command" in config) {
		parts.push(config.command);
		if (config.args) parts.push(...config.args);
	}
	if ("url" in config) parts.push(config.url);
	return parts.join(" ");
}

function manifestForServer(
	manifests: readonly AnalysisMcpManifest[],
	name: string,
	config: MCPServerConfig,
): AnalysisMcpManifest | undefined {
	const lowerName = name.toLowerCase();
	const text = serverText(name, config);
	return manifests.find(
		manifest =>
			manifest.serverNames.some(serverName => serverName.toLowerCase() === lowerName) ||
			manifest.packageNames.some(packageName => text.includes(packageName)),
	);
}

function allowedSetOf(allowedTools: AnalysisMcpResolveInput["allowedTools"]): ReadonlySet<string> | undefined {
	if (allowedTools === undefined) return undefined;
	return Array.isArray(allowedTools) ? new Set(allowedTools) : allowedTools;
}

function detectedBy(
	manifest: AnalysisMcpManifest,
	project: AnalysisMcpProjectSignals | undefined,
): readonly string[] {
	if (!project) return [];
	const found: string[] = [];
	for (const packageName of manifest.packageNames) {
		if (project.packageNames.includes(packageName)) found.push(packageName);
	}
	for (const marker of manifest.markerPaths) {
		if (project.markerPaths.includes(marker)) found.push(marker);
	}
	return found;
}

/**
 * Resolve every known analysis capability against the current snapshot.
 *
 * Rules:
 * - No configured server + declared package/marker -> `detected`, never mounted.
 * - `native` with an active native equivalent -> shadowed; a disabled native
 *   equivalent does not shadow an allowed MCP server.
 * - `mcp` -> mount the MCP server and report the native tools to suppress.
 * - `ask` -> emit an approval request and keep the server unmounted until the
 *   caller's existing approval path allows it.
 * - Same capability: the first mountable server wins; later ones are shadowed
 *   duplicates, even when they expose the same function names.
 * - Denylisted or profile-excluded servers are skipped without blocking a later
 *   allowed server of the same capability.
 */
export function resolveAnalysisMcp(input: AnalysisMcpResolveInput): AnalysisMcpDecision[] {
	const manifests = input.manifests ?? ANALYSIS_MCP_MANIFESTS;
	const allowed = allowedSetOf(input.allowedTools);
	const activeNative = new Set(input.activeNativeTools);
	const denied = new Set(input.deniedServers ?? []);
	const decisions: AnalysisMcpDecision[] = [];

	for (const manifest of manifests) {
		const configured = Object.entries(input.configs).filter(([name, config]) => {
			if (manifestForServer([manifest], name, config) !== undefined) return true;
			// An alias with no declared package (e.g. codegraph-alt) is the same
			// capability when its current tools/list exposes the manifest's tools.
			// Explicit declared tool names are evidence; no arbitrary package guessing.
			return input.serverTools?.[name]?.some(tool => manifest.tools.includes(tool)) === true;
		});

		if (configured.length === 0) {
			const found = detectedBy(manifest, input.project);
			decisions.push({
				manifestId: manifest.id,
				label: manifest.label,
				state: found.length > 0 ? "detected" : "unconfigured",
				configured: false,
				mount: false,
				reason:
					found.length > 0
						? `detected ${found.join(" + ")}; no MCP server is configured. Add an explicit mcpServers entry; Zeta never installs or starts it automatically.`
						: `not configured or detected`,
			});
			continue;
		}

		const manifestNativeTools = manifest.nativeTools.filter(tool => activeNative.has(tool));
		let blockedByNative = false;
		let mountedBy: string | undefined;

		for (const [serverName, config] of configured) {
			const expectedTools = input.serverTools?.[serverName] ?? manifest.tools;
			const serverAllowed = input.allowedServerTools?.[serverName];
			const visibleTools = expectedTools.filter(
				tool => (allowed === undefined || allowed.has(tool)) &&
					(input.allowedServerTools === undefined || serverAllowed?.includes(tool) === true),
			);
			const base = {
				manifestId: manifest.id,
				label: manifest.label,
				serverName,
				configured: true,
			};

			if (denied.has(serverName)) {
				decisions.push({
					...base,
					state: "shadowed-denied",
					mount: false,
					reason: `shadowed: server "${serverName}" is disabled by the user denylist`,
				});
				continue;
			}
			if ((allowed !== undefined || input.allowedServerTools !== undefined) && visibleTools.length === 0) {
				decisions.push({
					...base,
					state: "shadowed-profile",
					mount: false,
					reason: `shadowed: the active tool profile allowlist excludes all ${manifest.label} tools`,
				});
				continue;
			}
			if (blockedByNative) {
				decisions.push({
					...base,
					state: "shadowed-native",
					mount: false,
					reason: `shadowed: native ${manifestNativeTools.join(", ")} is active (mcp.precedence=native)`,
				});
				continue;
			}
			if (mountedBy !== undefined) {
				decisions.push({
					...base,
					state: "shadowed-duplicate",
					mount: false,
					reason: `shadowed: ${manifest.label} is already provided by ${mountedBy}`,
				});
				continue;
			}

			// An explicit approval for this refresh is the only way `ask` mounts. It is
			// not a new precedence tier: the mounted reason still names the approval so
			// `/mcp` and diagnostics distinguish it from `mcp.precedence=mcp`.
			const approvedAsk = input.precedence === "ask" && input.approvedServers?.includes(serverName) === true;

			if (manifestNativeTools.length > 0 && input.precedence === "native") {
				blockedByNative = true;
				decisions.push({
					...base,
					state: "shadowed-native",
					mount: false,
					reason: `shadowed: native ${manifestNativeTools.join(", ")} is active (mcp.precedence=native)`,
				});
				continue;
			}
			if (manifestNativeTools.length > 0 && input.precedence === "ask" && !approvedAsk) {
				mountedBy = serverName;
				decisions.push({
					...base,
					state: "ask",
					mount: false,
					reason: `ask: native ${manifestNativeTools.join(", ")} and ${manifest.label} both provide this capability; approval required`,
					approval: {
						kind: "mcp-precedence",
						manifestId: manifest.id,
						serverName,
						nativeTools: manifestNativeTools,
						prompt: `${manifest.label} provides the same capability as native ${manifestNativeTools.join(", ")}. Mount the MCP server instead for this session?`,
					},
				});
				continue;
			}

			mountedBy = serverName;
			decisions.push({
				...base,
				state: "mounted",
				mount: true,
				tools: visibleTools,
				reason:
					manifestNativeTools.length > 0
						? approvedAsk
							? `mounted (approved ask); suppress native ${manifestNativeTools.join(", ")}`
							: `mounted (mcp.precedence=mcp); suppress native ${manifestNativeTools.join(", ")}`
						: `mounted (no active native equivalent)`,
				...(manifestNativeTools.length > 0 ? { suppressNativeTools: manifestNativeTools } : {}),
			});
		}
	}

	return decisions;
}

/** Tools that may remain mounted for the current snapshot. */
export function filterAnalysisMcpTools<T extends { name: string; mcpServerName?: string; mcpToolName?: string }>(
	tools: readonly T[],
	decisions: readonly AnalysisMcpDecision[],
): T[] {
	const byServer = new Map(
		decisions.filter((decision): decision is AnalysisMcpDecision & { serverName: string } =>
			Boolean(decision.serverName),
		).map(decision => [decision.serverName, decision]),
	);
	return tools.filter(tool => {
		if (!tool.mcpServerName) return true;
		const decision = byServer.get(tool.mcpServerName);
		if (!decision) return true;
		if (!decision.mount) return false;
		if (decision.tools && tool.mcpToolName && !decision.tools.includes(tool.mcpToolName)) return false;
		return true;
	});
}

/** Reasons `/mcp` can print for every configured analysis capability that is not mounted. */
export function analysisMcpReasons(decisions: readonly AnalysisMcpDecision[]): Record<string, string> {
	const reasons: Record<string, string> = {};
	for (const decision of decisions) {
		if (decision.serverName && !decision.mount) reasons[decision.serverName] = decision.reason;
	}
	return reasons;
}

/** Native tools the caller must suppress because `mcp` precedence mounted the MCP side. */
export function analysisMcpNativeToolsToSuppress(decisions: readonly AnalysisMcpDecision[]): string[] {
	return [...new Set(decisions.flatMap(decision => decision.suppressNativeTools ?? []))];
}

/**
 * Read the session-layer snapshot published by the refresh hook. The `/mcp`
 * UI uses this so it shows the same authority that filtered the mounted tools;
 * it must not recompute collision decisions independently. Missing/invalid
 * providers read as no reasons.
 */
export function readAnalysisMcpShadowReasons(source: unknown): Readonly<Record<string, string>> | undefined {
	if (!isRecord(source)) return undefined;
	const provider = source.getAnalysisMcpShadowReasons;
	if (typeof provider !== "function") return undefined;
	const result: unknown = provider.call(source);
	if (!isRecord(result)) return undefined;
	const reasons: Record<string, string> = {};
	for (const [serverName, reason] of Object.entries(result)) {
		if (typeof reason === "string") reasons[serverName] = reason;
	}
	return reasons;
}
