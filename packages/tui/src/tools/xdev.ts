/**
 * `xd://` device writes: presentation of a wrapped device tool.
 *
 * A `write` to `xd://<device>` dispatches to a mounted tool or a top-level
 * tool, and its transcript row should read like that device's own call:
 * `LSP · references foo` rather than `Write · xd://lsp`. This module maps the
 * write's (possibly streamed) inner args and the dispatch result to a `tool`
 * node, delegating to the wrapped tool's presenter when the host supplies one.
 *
 * Node model: a presenter never draws rows or picks colors. It returns TSP
 * nodes; the terminal backend paints them and a native terminal draws them
 * natively.
 */
import type { ToolTier } from "@linxiraos/pi-agent-core";
import { parseStreamingJson } from "@linxiraos/pi-utils";
import type { TspCardStatus } from "@linxiraos/pi-wire";
import { UiNode } from "../node";
import { replaceTabs } from "../text/width";
import type { JSXNode } from "../types";

/** What the transcript knows about the wrapped call while presenting it. */
export interface XdevRenderOptions {
	/** The user expanded the block. */
	readonly expanded?: boolean;
	/** The result is still streaming. */
	readonly isPartial?: boolean;
	/** The args are final (message end). */
	readonly argsComplete?: boolean;
	/** The call began executing. */
	readonly executionStarted?: boolean;
	/** Ms since execution started, or the total once settled. */
	readonly elapsedMs?: number;
}

/** A tool result as presenters receive it. */
export interface XdevToolResult {
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly details?: unknown;
	readonly isError?: boolean;
}

/** The wrapped device's own presenter: the `tool` node and body nodes of its call and result. */
export interface XdevMountedRenderer {
	/** Human label of the device (`LSP`, `Gmail`); defaults to the tool name. */
	label?: string;
	renderCall?(args: Record<string, unknown>, options: XdevRenderOptions): JSXNode;
	renderResult?(
		result: XdevToolResult,
		options: XdevRenderOptions,
		args: Record<string, unknown>,
	): JSXNode;
	/** The device draws its call and result as one block, so the wrapper does not prepend the call. */
	mergeCallAndResult?: boolean;
}

/** Tool presentation state supplied by the host's canonical tool map. */
export interface XdevMountedState {
	readonly mountedNames: ReadonlySet<string>;
	readonly tools: ReadonlyMap<string, XdevMountedRenderer>;
	/**
	 * Canonical presenter for a device name, supplied by the host with the same
	 * predicate as dispatch (`resolveXdevTool`: mounted devices plus active
	 * top-level tools, which the `write` transport also accepts). The TUI keeps
	 * no predicate copy of its own — a second copy is what dropped a top-level
	 * dispatch to the generic card.
	 */
	readonly resolve?: (name: string) => XdevMountedRenderer | undefined;
}

/** Result metadata consumed by delegated device rendering. */
export interface XdevRenderDispatch {
	tool: string;
	mode: "help" | "execute";
	args?: Record<string, unknown>;
	tier?: ToolTier;
	inner?: unknown;
}

let rendererLookup: ((name: string) => XdevMountedRenderer | undefined) | undefined;

/** Wire the wrapped-presenter lookup. Called once by the host's renderer map. */
export function setXdevRendererLookup(lookup: (name: string) => XdevMountedRenderer | undefined): void {
	rendererLookup = lookup;
}

const MCP_TOOL_NAME_PREFIX = "mcp__";

/** `server/tool` for an `mcp__server_tool` name; undefined for anything else. */
function parseMcpToolName(name: string): { serverName: string; toolName: string } | undefined {
	if (!name.startsWith(MCP_TOOL_NAME_PREFIX)) return undefined;
	const rest = name.slice(MCP_TOOL_NAME_PREFIX.length);
	const separator = rest.indexOf("_");
	if (separator === -1) return undefined;
	return { serverName: rest.slice(0, separator), toolName: rest.slice(separator + 1) };
}

/** Decode the (possibly partially streamed) inner args JSON string into display args. */
function decodeInnerArgs(raw: unknown): Record<string, unknown> {
	if (typeof raw !== "string" || raw.length === 0) return {};
	const parsed = parseStreamingJson<Record<string, unknown>>(raw);
	const args: Record<string, unknown> = parsed && typeof parsed === "object" ? { ...parsed } : {};
	args.__partialJson = raw;
	return args;
}

/** Presenter for a mounted device: the live mounted tool's own callbacks first, then the host's map keyed by name. */
function resolveDeviceRenderer(
	name: string,
	mounted: XdevMountedRenderer | undefined,
): XdevMountedRenderer | undefined {
	if (mounted && (mounted.renderCall || mounted.renderResult)) return mounted;
	return rendererLookup?.(name);
}

/** Human label for a device write: mounted tool label, else `server/tool` for MCP names. */
function displayDeviceLabel(name: string, mounted?: { label?: string }): string {
	if (mounted?.label) return mounted.label;
	const parsed = parseMcpToolName(name);
	if (parsed) return `${parsed.serverName}/${parsed.toolName}`;
	return name;
}

/** Salient inner-arg keys for the compact activity line: the verb first, then its object. */
const ACTIVITY_VERB_KEYS = ["action", "op", "command"] as const;
const ACTIVITY_OBJECT_KEYS = ["query", "symbol", "path", "file", "pattern", "url", "name"] as const;

/** Compact `label · verb object` activity summary for a device write. */
export interface XdevActivitySummary {
	readonly label: string;
	readonly detail?: string;
}

/**
 * Compact `label · verb object` activity summary for a device write, so a
 * squeezed transcript row reads `LSP · references foo` instead of
 * `Write · xd://lsp`. Prose payloads (resolution devices, report_issue)
 * surface their first line instead.
 */
export function xdevActivitySummary(
	name: string,
	content: unknown,
	resolveMounted?: (name: string) => XdevMountedRenderer | undefined,
): XdevActivitySummary {
	const mounted = resolveMounted?.(name);
	const args = decodeInnerArgs(content);
	const pick = (keys: readonly string[]): string | undefined => {
		for (const key of keys) {
			const value = args[key];
			if (typeof value === "string" && value.length > 0) return value.split("\n", 1)[0];
		}
		return undefined;
	};
	let detail = [pick(ACTIVITY_VERB_KEYS), pick(ACTIVITY_OBJECT_KEYS)].filter(Boolean).join(" ");
	if (!detail && typeof content === "string" && !content.trimStart().startsWith("{")) {
		detail = content.trim().split("\n", 1)[0] ?? "";
	}
	return { label: displayDeviceLabel(name, mounted), detail: detail || undefined };
}

/** Drop the streaming-decode bookkeeping key before showing inner args. */
function displayDeviceArgs(args: Record<string, unknown>): Record<string, unknown> {
	const { __partialJson: _partial, ...rest } = args;
	return rest;
}

/** The primary argument shown once in the head: the verb first, then its object. */
function targetOf(args: Record<string, unknown>): string | undefined {
	for (const key of [...ACTIVITY_VERB_KEYS, ...ACTIVITY_OBJECT_KEYS]) {
		const value = args[key];
		if (typeof value === "string" && value.length > 0) return value.split("\n", 1)[0];
	}
	return undefined;
}

/** A `tool` node for a device write when no device presenter takes it. */
function defaultToolNode(
	name: string,
	title: string,
	args: Record<string, unknown>,
	status: TspCardStatus,
	options: XdevRenderOptions,
): UiNode {
	const target = targetOf(args);
	const body = Object.keys(displayDeviceArgs(args)).length === 0
		? undefined
		: new UiNode("code", {
				lang: "json",
				text: JSON.stringify(displayDeviceArgs(args), null, 2),
				...(options.expanded ? {} : { max: { h: 6 } }),
			});
	return new UiNode("tool", {
		name,
		title,
		status,
		frame: "card",
		collapsed: !options.expanded,
		...(target === undefined ? {} : { target, targetKind: "text" }),
		...(body === undefined ? {} : { children: body }),
	});
}

/** The result text blocks of a tool result, joined as rows. */
function resultText(result: XdevToolResult): string {
	return result.content
		.map(block => (block.type === "text" ? block.text : ""))
		.filter((text): text is string => Boolean(text))
		.join("\n");
}

/** Combine the parts a presenter produced: one node as-is, several under a `col`. */
function combine(parts: readonly JSXNode[]): JSXNode | undefined {
	const kept = parts.filter(part => part !== undefined && part !== null && part !== false);
	if (kept.length === 0) return undefined;
	return kept.length === 1 ? kept[0] : new UiNode("col", { gap: "sm", children: kept });
}

/**
 * Streaming-safe call preview for an `xd://` write. Until the write actually
 * executes (`executionStarted`), show a queued/planning card so
 * think-after-toolcall stalls do not look like a hung inner tool.
 * `argsComplete` alone is not enough: exclusive writes can sit complete at
 * `message_end` while an earlier call still runs. Once execution starts,
 * forward the decoded inner args to the device's presenter.
 */
export function renderXdevCall(
	name: string,
	content: unknown,
	options: XdevRenderOptions,
	resolveMounted?: (name: string) => XdevMountedRenderer | undefined,
): JSXNode | undefined {
	const mounted = resolveMounted?.(name);
	const args = decodeInnerArgs(content);
	if (!options.executionStarted) {
		return defaultToolNode(name, `queued ${displayDeviceLabel(name, mounted)}`, args, "pending", {
			...options,
			isPartial: true,
		});
	}
	const renderer = resolveDeviceRenderer(name, mounted);
	if (renderer?.renderCall) return renderer.renderCall(args, options);
	return defaultToolNode(name, displayDeviceLabel(name, mounted), args, "running", options);
}

/** Forward an `xd://` dispatch result to the mounted device's presenter. */
export function renderXdevResult(
	dispatch: XdevRenderDispatch,
	result: XdevToolResult,
	options: XdevRenderOptions,
	resolveMounted?: (name: string) => XdevMountedRenderer | undefined,
): JSXNode | undefined {
	const output = resultText(result);
	if (dispatch.mode === "help") {
		if (!output) return undefined;
		return new UiNode("tool", {
			name: dispatch.tool,
			title: "help",
			status: "done",
			frame: "card",
			collapsed: !options.expanded,
			children: new UiNode("text", { text: replaceTabs(output) }),
		});
	}
	const mounted = resolveMounted?.(dispatch.tool);
	const renderer = resolveDeviceRenderer(dispatch.tool, mounted);
	const args = dispatch.args ?? {};
	if (renderer?.renderResult) {
		const parts: JSXNode[] = [];
		// Emulate the unmerged call+result topology for presenters that expect a
		// separate call header.
		if (!renderer.mergeCallAndResult && renderer.renderCall) {
			parts.push(renderer.renderCall(args, { ...options, isPartial: false }));
		}
		parts.push(
			renderer.renderResult({ content: result.content, details: dispatch.inner, isError: result.isError }, options, args),
		);
		const combined = combine(parts);
		if (combined !== undefined) return combined;
	}
	return defaultToolNode(
		dispatch.tool,
		displayDeviceLabel(dispatch.tool, mounted),
		args,
		result.isError ? "error" : "done",
		options,
	);
}
