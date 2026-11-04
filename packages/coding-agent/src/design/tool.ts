import type { AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { prompt } from "@linxiraos/pi-utils";
import type { CustomTool } from "../extensibility/custom-tools/types";
import designDescription from "../prompts/tools/design.md" with { type: "text" };
import { openPath } from "../utils/open";
import { readDesignMarker, type DesignMarker } from "./config";
import { formatDesignStatus, probeDesignStatus, type DesignStatus } from "./status";
import { callDesignMcp, closeDesignConnections, runDesignCli } from "./transport";

const designSchema = type({
	action: "'status' | 'mcp' | 'cli' | 'open'",
	"mcp_tool?": type("string").describe("OpenDesign MCP tool name"),
	"arguments?": type("object").describe("arguments for the OpenDesign MCP tool"),
	"args?": type("string[]").describe("OpenDesign CLI argv without the leading od"),
	"url?": type("string").describe("http/https preview URL to open"),
});
type DesignParams = typeof designSchema.infer;

interface DesignToolDetails {
	action: DesignParams["action"];
	status?: DesignStatus;
	mcpTool?: string;
	structuredContent?: Record<string, unknown>;
	command?: string;
	exitCode?: number;
	url?: string;
}

const CLI_COMMANDS = new Set([
	"media",
	"export",
	"brand",
	"design-systems",
	"figma",
	"lint",
	"templates",
	"library",
	"files",
	"artifacts",
	"project",
	"run",
	"skill",
	"plugin",
	"comment",
	"collab",
	"share",
	"atoms",
	"workspace",
	"version",
	"doctor",
]);

const MAX_OUTPUT_CHARS = 100_000;

function truncateOutput(value: string): string {
	if (value.length <= MAX_OUTPUT_CHARS) return value;
	return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated ${value.length - MAX_OUTPUT_CHARS} chars]`;
}

function toMcpResult(
	result: Awaited<ReturnType<typeof callDesignMcp>>,
	toolName: string,
): AgentToolResult<DesignToolDetails> {
	const content: AgentToolResult<DesignToolDetails>["content"] = [];
	let text = "";
	const flushText = () => {
		if (!text) return;
		content.push({ type: "text", text });
		text = "";
	};
	for (const item of result.content) {
		switch (item.type) {
			case "text":
				text += text ? `\n\n${item.text}` : item.text;
				break;
			case "image":
				flushText();
				content.push(item);
				break;
			case "resource":
				text += text
					? `\n\n[Resource: ${item.resource.uri}]${item.resource.text ? `\n${item.resource.text}` : ""}`
					: `[Resource: ${item.resource.uri}]${item.resource.text ? `\n${item.resource.text}` : ""}`;
				break;
		}
	}
	flushText();
	if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
		content.push({
			type: "text",
			text: `\`\`\`json\n${JSON.stringify(result.structuredContent, null, 2)}\n\`\`\``,
		});
	}
	if (content.length === 0) content.push({ type: "text", text: "OpenDesign returned no content." });
	if (result.isError && content[0]?.type === "text") {
		content[0] = { type: "text", text: `Error: ${content[0].text}` };
	}
	return {
		content,
		details: {
			action: "mcp",
			mcpTool: toolName,
			structuredContent: result.structuredContent,
		},
		...(result.isError ? { isError: true } : {}),
	};
}

function markerOrThrow(marker: Awaited<ReturnType<typeof readDesignMarker>>): DesignMarker {
	if (marker.error) throw new Error(`Invalid ${marker.path}: ${marker.error}`);
	if (!marker.config.enabled) {
		throw new Error("OpenDesign is not enabled for this workspace. Run /design enable first.");
	}
	return marker.config;
}

function assertHttpUrl(value: string | undefined): string {
	if (!value) throw new Error("open requires a URL");
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Invalid URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("open only accepts http and https URLs");
	}
	return parsed.toString();
}

export const designTool: CustomTool<typeof designSchema, DesignToolDetails> = {
	name: "design",
	label: "Design",
	strict: false,
	approval: "write",
	loadMode: "essential",
	description: prompt.render(designDescription),
	parameters: designSchema,
	async execute(_toolCallId, params, _onUpdate, ctx, signal) {
		const cwd = ctx.sessionManager.getCwd();
		const loaded = await readDesignMarker(cwd);
		const marker = markerOrThrow(loaded);

		switch (params.action) {
			case "status": {
				const status = await probeDesignStatus(cwd, { signal });
				return {
					content: [{ type: "text", text: formatDesignStatus(status) }],
					details: { action: "status", status },
					...(status.level === "ready" || status.level === "disabled" ? {} : { isError: true }),
				};
			}
			case "mcp": {
				const toolName = params.mcp_tool?.trim();
				if (!toolName) throw new Error("mcp requires mcp_tool");
				if (
					params.arguments !== undefined &&
					(typeof params.arguments !== "object" || Array.isArray(params.arguments))
				) {
					throw new Error("arguments must be an object");
				}
				const result = await callDesignMcp(
					cwd,
					marker,
					toolName,
					(params.arguments as Record<string, unknown> | undefined) ?? {},
					signal,
				);
				return toMcpResult(result, toolName);
			}
			case "cli": {
				const args = params.args ?? [];
				if (args.length === 0) throw new Error('cli requires args, for example ["media", "models"]');
				const command = args[0]!;
				if (!CLI_COMMANDS.has(command)) {
					throw new Error(
						`Unsupported OpenDesign CLI command "${command}". Allowed: ${[...CLI_COMMANDS].sort().join(", ")}`,
					);
				}
				const result = await runDesignCli(cwd, marker, args, { signal });
				const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
				const text = output || `od ${args.join(" ")} exited ${result.code}`;
				return {
					content: [{ type: "text", text: truncateOutput(text) }],
					details: { action: "cli", command: args.join(" "), exitCode: result.code },
					...(result.code === 0 ? {} : { isError: true }),
				};
			}
			case "open": {
				const url = assertHttpUrl(params.url);
				openPath(url);
				return {
					content: [{ type: "text", text: `Opened ${url}` }],
					details: { action: "open", url },
				};
			}
		}
	},
	async onSession(event) {
		if (event.reason === "shutdown" || event.reason === "switch") await closeDesignConnections();
	},
};
