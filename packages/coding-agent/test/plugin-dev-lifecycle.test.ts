/**
 * Agent-authored plugin lifecycle boundaries.
 *
 * These pin the filesystem contract, not the model-facing text: scaffolding
 * stays inside one session root, validation refuses escaped entries, dismissal
 * cannot delete outside the dev root, and promotion lands in the dropped-in
 * plugin root a later session discovers.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeWithRetries } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { ExtensionRuntime } from "@linxiraos/zeta/extensibility/extensions/loader";
import { ExtensionRunner } from "@linxiraos/zeta/extensibility/extensions/runner";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import {
	DevPluginRuntime,
	cleanupExpiredDevPlugins,
	exportDevPlugin,
	promoteDevPlugin,
	sessionDevRoot,
	scaffoldDevPlugin,
	validateDevPluginDirectory,
} from "@linxiraos/zeta/extensibility/plugins/dev";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await removeWithRetries(root).catch(() => undefined);
});

async function tempAgentDir(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-dev-plugins-"));
	roots.push(root);
	return root;
}

describe("dev plugin scaffold and validation", () => {
	test("creates a contained package that validates with its read-only tool", async () => {
		const agentDir = await tempAgentDir();
		const result = scaffoldDevPlugin(agentDir, "session-a", "hello-probe", {
			description: "probe",
		});
		expect(result.files).toEqual(["package.json", "plugin.json", "index.ts"]);
		expect(result.root).toBe(path.join(sessionDevRoot(agentDir, "session-a"), "hello-probe"));
		const validation = validateDevPluginDirectory(agentDir, "session-a", "hello-probe");
		expect(validation.ok).toBe(true);
		expect(validation.entry).toContain("index.ts");
		expect(validation.errors).toEqual([]);
		const entrySource = await fs.readFile(path.join(result.root, "index.ts"), "utf8");
		expect(entrySource).toContain('name: "hello_probe_hello"');
		expect(entrySource).toContain('approval: "read"');
	});

	test("refuses names that would escape the session root", async () => {
		const agentDir = await tempAgentDir();
		expect(() => scaffoldDevPlugin(agentDir, "session-a", "../escape")).toThrow(/Invalid plugin name/);
		expect(() => scaffoldDevPlugin(agentDir, "..", "probe")).toThrow(/Invalid session id/);
		await expect(fs.stat(path.join(agentDir, "escape"))).rejects.toThrow();
	});

	test("validation rejects a manifest entry outside the plugin", async () => {
		const agentDir = await tempAgentDir();
		const result = scaffoldDevPlugin(agentDir, "session-a", "outside-entry");
		const pkgPath = path.join(result.root, "package.json");
		const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as {
			zeta: { extensions: string[] };
		};
		pkg.zeta.extensions = ["../outside.ts"];
		await fs.writeFile(pkgPath, JSON.stringify(pkg));
		const validation = validateDevPluginDirectory(agentDir, "session-a", "outside-entry");
		expect(validation.ok).toBe(false);
		expect(validation.errors.join("\n")).toContain("inside the plugin");
	});
});

describe("promotion, export and cleanup", () => {
	test("promote copies into the dropped-in plugin root and requires explicit overwrite", async () => {
		const agentDir = await tempAgentDir();
		scaffoldDevPlugin(agentDir, "session-a", "promote-me");
		const promoted = promoteDevPlugin({ agentDir, sessionId: "session-a", name: "promote-me" });
		expect(promoted.path).toBe(path.join(agentDir, "plugins", "promote-me"));
		expect(await fs.readFile(path.join(promoted.path, "index.ts"), "utf8")).toContain("promote-me");
		expect(() => promoteDevPlugin({ agentDir, sessionId: "session-a", name: "promote-me" })).toThrow(
			/already exists/,
		);
	});

	test("export writes outside the dev session and can replace a chosen directory", async () => {
		const agentDir = await tempAgentDir();
		const destination = path.join(agentDir, "exported", "probe");
		scaffoldDevPlugin(agentDir, "session-a", "export-me");
		const first = exportDevPlugin({
			agentDir,
			sessionId: "session-a",
			name: "export-me",
			destination,
		});
		expect(first.files).toBeGreaterThan(0);
		expect(await fs.stat(path.join(destination, "package.json"))).toBeDefined();
		expect(() => exportDevPlugin({ agentDir, sessionId: "session-a", name: "export-me", destination })).toThrow(
			/already exists/,
		);
		const second = exportDevPlugin({
			agentDir,
			sessionId: "session-a",
			name: "export-me",
			destination,
			overwrite: true,
		});
		expect(second.destination).toBe(destination);
	});

	test("cleanup removes only expired non-current session directories", async () => {
		const agentDir = await tempAgentDir();
		scaffoldDevPlugin(agentDir, "current", "keep-me");
		scaffoldDevPlugin(agentDir, "old", "drop-me");
		const removed = cleanupExpiredDevPlugins({
			agentDir,
			keepSessionIds: ["current"],
			now: Date.now() + 30 * 24 * 60 * 60 * 1000,
		});
		expect(removed).toEqual(["old"]);
		expect(await fs.stat(path.join(sessionDevRoot(agentDir, "current"), "keep-me"))).toBeDefined();
		await expect(fs.stat(sessionDevRoot(agentDir, "old"))).rejects.toThrow();

		// A second pass over an already-cleaned root is a no-op.
		expect(
			cleanupExpiredDevPlugins({
				agentDir,
				keepSessionIds: ["current"],
				now: Date.now() + 30 * 24 * 60 * 60 * 1000,
			}),
		).toEqual([]);
	});
});

describe("session loading and reload", () => {
	function liveRunner(cwd: string): { runner: ExtensionRunner; removed: string[]; live: Set<string> } {
		const runtime = new ExtensionRuntime();
		const runner = new ExtensionRunner(
			[],
			runtime,
			cwd,
			SessionManager.inMemory(cwd),
			new ModelRegistry(createInMemoryAuthStorage()),
		);
		// The session registry's built-ins are not runner extensions; model one
		// live name so the collision gate is the thing under test.
		return { runner, removed: [], live: new Set(["read"]) };
	}

	function devRuntime(
		agentDir: string,
		sessionId: string,
		runner: ExtensionRunner,
		removed: string[],
		live: Set<string>,
	): DevPluginRuntime {
		return new DevPluginRuntime({
			agentDir,
			sessionId,
			cwd: agentDir,
			host: {
				getRunner: () => runner,
				uninstallTools: async names => {
					removed.push(...names);
					for (const name of names) live.delete(name);
				},
				hasTool: name => live.has(name),
			},
		});
	}

	test("load_dev joins the live runner and a turn-end reload replaces its tools", async () => {
		const agentDir = await tempAgentDir();
		const { runner, removed, live } = liveRunner(agentDir);
		const dev = devRuntime(agentDir, "session-live", runner, removed, live);
		scaffoldDevPlugin(agentDir, "session-live", "live-probe");

		const loaded = await dev.loadDev("live-probe");
		expect(loaded.plugin.toolNames).toEqual(["live_probe_hello"]);
		expect(runner.getRegisteredTool("live_probe_hello")).toBeDefined();

		const entry = path.join(loaded.plugin.root, "index.ts");
		const source = await fs.readFile(entry, "utf8");
		await fs.writeFile(entry, source.replaceAll("live_probe_hello", "live_probe_v2"), "utf8");
		await runner.emit({
			type: "turn_end",
			turnIndex: 0,
			message: {} as never,
			toolResults: [],
		});

		expect(dev.list()[0]?.toolNames).toEqual(["live_probe_v2"]);
		expect(removed).toContain("live_probe_hello");
		expect(runner.getRegisteredTool("live_probe_hello")).toBeUndefined();
		expect(runner.getRegisteredTool("live_probe_v2")).toBeDefined();
	});

	test("a broken reload keeps the previous registration live", async () => {
		const agentDir = await tempAgentDir();
		const { runner, removed, live } = liveRunner(agentDir);
		const dev = devRuntime(agentDir, "session-live", runner, removed, live);
		scaffoldDevPlugin(agentDir, "session-live", "fail-safe");
		const loaded = await dev.loadDev("fail-safe");
		expect(runner.getRegisteredTool("fail_safe_hello")).toBeDefined();

		const entry = path.join(loaded.plugin.root, "index.ts");
		const source = await fs.readFile(entry, "utf8");
		await fs.writeFile(entry, source.replace("export default function", "export default function broken("), "utf8");
		await expect(dev.reload("fail-safe")).rejects.toThrow(/Cannot parse index\.ts/);
		expect(runner.getRegisteredTool("fail_safe_hello")).toBeDefined();
		expect(dev.list()[0]?.toolNames).toEqual(["fail_safe_hello"]);
	});

	test("refuses a tool name that the live session already registered", async () => {
		const agentDir = await tempAgentDir();
		const { runner, removed, live } = liveRunner(agentDir);
		const dev = devRuntime(agentDir, "session-live", runner, removed, live);
		scaffoldDevPlugin(agentDir, "session-live", "shadow");
		const entry = path.join(sessionDevRoot(agentDir, "session-live"), "shadow", "index.ts");
		const source = await fs.readFile(entry, "utf8");
		await fs.writeFile(entry, source.replaceAll("shadow_hello", "read"), "utf8");

		await expect(dev.loadDev("shadow")).rejects.toThrow(/already registered in this session/);
		expect(runner.getRegisteredTool("read")).toBeUndefined();
		expect(dev.list()).toEqual([]);
	});
});
