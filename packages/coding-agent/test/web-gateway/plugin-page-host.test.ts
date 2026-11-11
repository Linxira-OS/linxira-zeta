/**
 * REQ-055 plugin page host: manifest page discovery, package asset confinement,
 * and the Studio `plugins.callTool` permission boundary.
 *
 * Fixtures live in a temporary agent dir (`<agentDir>/plugins/<package>`), the
 * dropped-in shape the page host resolves without install bookkeeping. Asset
 * tests drive both the gateway dispatch and the handler's raw-tail form, so
 * traversal is exercised before the URL parser can normalise it away.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { handlePluginAssetGet } from "../../src/server/web-gateway/assets";
import { webGatewayFetch } from "../../src/server/web-gateway";
import type { CommandInput, SessionId } from "../../src/server/studio-host/contract/index.js";
import { callPluginTool, type PluginSessionLookup } from "../../src/server/studio-host/ops/plugin-host.js";
import type { AgentSessionWrapper } from "../../src/server/web-gateway/agents.js";

const cleanups: Array<() => Promise<void>> = [];
const savedAgentDir = process.env.ZETA_CODING_AGENT_DIR;
let agentDir = "";

async function makeTemp(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function request(path: string, method = "GET"): Request {
	return new Request(`http://127.0.0.1${path}`, { method });
}

async function writePlugin(root: string, manifest: unknown, files: Record<string, string> = {}): Promise<void> {
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "plugin.json"), JSON.stringify(manifest), "utf8");
	for (const [relative, content] of Object.entries(files)) {
		const file = join(root, relative);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content, "utf8");
	}
}

beforeEach(async () => {
	agentDir = await makeTemp("zeta-plugin-pages-agent-");
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
});

afterEach(async () => {
	if (savedAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = savedAgentDir;
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe("plugin pages inventory", () => {
	test("lists only manifest-declared html pages and never leaks package paths", async () => {
		const project = await makeTemp("zeta-plugin-pages-project-");
		await writePlugin(
			join(agentDir, "plugins", "demo-page"),
			{
				id: "demo-page",
				name: "Demo Page",
				ui: {
					panels: [
						{ id: "main", title: "Main", kind: "html", entry: "pages/index.html" },
						{ id: "data", title: "Data", kind: "list", source: { tool: "demo_tool" } },
					],
				},
			},
			{ "pages/index.html": "<h1>demo</h1>", "assets/app.js": "console.log('demo')" },
		);
		await writePlugin(join(agentDir, "plugins", "declarative-only"), {
			id: "declarative-only",
			ui: { panels: [{ id: "data", title: "Data", kind: "list", source: { tool: "demo_tool" } }] },
		});

		const response = await webGatewayFetch(
			request(`/api/plugin-pages?cwd=${encodeURIComponent(project)}`),
			"127.0.0.1",
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			plugins: Array<{
				id: string;
				name: string;
				pages: Array<{ id: string; title: string; entry: string; url: string }>;
			}>;
		};
		const group = body.plugins.find(entry => entry.id === "demo-page");
		expect(group).toEqual({
			id: "demo-page",
			name: "Demo Page",
			pages: [
				{
					id: "main",
					title: "Main",
					entry: "pages/index.html",
					url: "/api/plugin-assets/demo-page/pages/index.html",
				},
			],
		});
		expect(body.plugins.some(entry => entry.id === "declarative-only")).toBe(false);
		expect(JSON.stringify(body)).not.toContain(agentDir);
	});

	test("serves an allowlisted package asset and refuses HEAD/GET outside it", async () => {
		await writePlugin(
			join(agentDir, "plugins", "demo-page"),
			{ id: "demo-page", name: "Demo Page" },
			{
				"pages/index.html": "<h1>demo</h1>",
				"assets/app.js": "console.log('demo')",
				"secret.txt": "not an asset",
			},
		);

		const html = await webGatewayFetch(request("/api/plugin-assets/demo-page/pages/index.html"), "127.0.0.1");
		expect(html.status).toBe(200);
		expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(html.headers.get("cache-control")).toBe("no-store");
		expect(html.headers.get("x-content-type-options")).toBe("nosniff");
		expect(await html.text()).toBe("<h1>demo</h1>");

		const script = await webGatewayFetch(request("/api/plugin-assets/demo-page/assets/app.js"), "127.0.0.1");
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

		const head = await webGatewayFetch(request("/api/plugin-assets/demo-page/pages/index.html", "HEAD"), "127.0.0.1");
		expect(head.status).toBe(200);
		expect(head.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(await head.text()).toBe("");

		const disallowed = await webGatewayFetch(request("/api/plugin-assets/demo-page/secret.txt"), "127.0.0.1");
		expect(disallowed.status).toBe(404);
	});

	test("rejects traversal, encoded separators, absolute paths and unknown plugins", async () => {
		const plugin = join(agentDir, "plugins", "demo-page");
		await writePlugin(plugin, { id: "demo-page" }, { "pages/index.html": "<h1>demo</h1>", "secret.txt": "no" });

		const path = "/api/plugin-assets/demo-page/anything";
		for (const tail of ["..", "../secret.txt", "%2e%2e/secret.txt", "..%2Fsecret.txt", "pages/../../secret.txt"]) {
			const response = await handlePluginAssetGet(request(path), "demo-page", tail);
			expect(response.status).toBe(400);
		}
		for (const tail of ["%5C%5Cserver%5Cshare", "C:%5Csecret.txt", "pages%2Findex.html", "page%00.html"]) {
			const response = await handlePluginAssetGet(request(path), "demo-page", tail);
			expect(response.status).toBe(400);
		}
		const absolute = await handlePluginAssetGet(request(path), "demo-page", "%2Fetc%2Fpasswd");
		expect(absolute.status).toBe(400);

		const escapedPlugin = await handlePluginAssetGet(request(path), "..%2Fdemo-page", "pages/index.html");
		expect(escapedPlugin.status).toBe(400);

		const unknown = await webGatewayFetch(request("/api/plugin-assets/does-not-exist/pages/index.html"), "127.0.0.1");
		expect(unknown.status).toBe(404);

		const directory = await webGatewayFetch(request("/api/plugin-assets/demo-page/pages"), "127.0.0.1");
		expect(directory.status).toBe(404);
	});
});

interface FakeSessionOptions {
	readonly cwd: string;
	readonly active?: readonly string[];
	readonly registered?: unknown;
	readonly execute?: (args: unknown) => Promise<unknown>;
}

function fakeWrapper(options: FakeSessionOptions): AgentSessionWrapper {
	const inner = {
		getActiveToolNames: () => [...(options.active ?? ["demo_tool"])],
		extensionRunner: {
			getRegisteredTool: (name: string) => (name === "demo_tool" ? options.registered : undefined),
		},
		getToolByName: (name: string) =>
			name === "demo_tool"
				? {
						execute: async (_id: string, args: unknown) =>
							options.execute ? options.execute(args) : { content: [{ type: "text", text: "ok" }] },
					}
				: undefined,
		sessionManager: { getCwd: () => options.cwd },
		settings: {},
		modelRegistry: {},
		model: undefined,
		isStreaming: false,
		queuedMessageCount: 0,
		agent: { abort: () => {} },
	};
	// Structural fake: the handler reads only the wrapper surface exercised here.
	return { isAlive: () => true, getSession: () => inner } as unknown as AgentSessionWrapper;
}

describe("plugins.callTool permission boundary", () => {
	async function fixture(): Promise<{ cwd: string; source: string }> {
		const cwd = await makeTemp("zeta-plugin-call-project-");
		const root = join(agentDir, "plugins", "call-plugin");
		const source = join(root, "index.ts");
		await writePlugin(root, { id: "call-plugin", name: "Call Plugin" }, { "index.ts": "export {};" });
		return { cwd, source };
	}

	const input = {
		plugin: "call-plugin",
		tool: "demo_tool",
		arguments: { value: 1 },
		sessionId: "session-1" as SessionId,
	} satisfies CommandInput<"plugins.callTool">;

	test("runs through the session tool wrapper and bounds the result", async () => {
		const { cwd, source } = await fixture();
		const seen: unknown[] = [];
		const lookup: PluginSessionLookup = () =>
			fakeWrapper({
				cwd,
				registered: { definition: { sourcePath: source }, extensionPath: source, sourceInfo: { path: source } },
				execute: async args => {
					seen.push(args);
					return { content: [{ type: "text", text: "done" }], details: { ok: true } };
				},
			});

		const result = await callPluginTool(input, lookup);
		expect(result).toEqual({ content: [{ type: "text", text: "done" }], details: { ok: true } });
		expect(seen).toEqual([{ value: 1 }]);
	});

	test("refuses without a live session, an inactive tool, or a missing sessionId", async () => {
		await fixture();
		await expect(callPluginTool(input, () => undefined)).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			callPluginTool({ ...input, sessionId: undefined }, () => fakeWrapper({ cwd: "" })),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});

		const inactive: PluginSessionLookup = () => fakeWrapper({ cwd: "", active: [] });
		await expect(callPluginTool(input, inactive)).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	test("refuses a tool outside the plugin root and an unknown plugin", async () => {
		const { cwd, source } = await fixture();
		const outside = join(await makeTemp("zeta-plugin-call-outside-"), "other.ts");
		await writeFile(outside, "export {};", "utf8");
		const foreign: PluginSessionLookup = () =>
			fakeWrapper({
				cwd,
				registered: { definition: { sourcePath: outside }, extensionPath: outside, sourceInfo: { path: outside } },
			});
		await expect(callPluginTool(input, foreign)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

		const owned: PluginSessionLookup = () =>
			fakeWrapper({
				cwd,
				registered: { definition: { sourcePath: source }, extensionPath: source, sourceInfo: { path: source } },
			});
		await expect(callPluginTool({ ...input, plugin: "missing-plugin" }, owned)).rejects.toMatchObject({
			code: "INVALID_ARGUMENT",
		});

		const unknownTool: PluginSessionLookup = () => fakeWrapper({ cwd, registered: undefined });
		await expect(callPluginTool(input, unknownTool)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});
