/**
 * Plugin host i18n: manifest `locales`, catalogue loading, fallback order, and
 * per-extension `ctx.t()` injection.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import type { Extension, ExtensionContext } from "../src/extensibility/extensions/types";
import { parsePluginLocales } from "../src/extensibility/plugins/parser";
import {
	clearPluginLocaleCache,
	loadPluginLocaleCatalog,
	type PluginLocaleCatalog,
	translatePluginMessage,
} from "../src/extensibility/plugins/locales";
import { setLanguage } from "../src/i18n";

const temps: TempDir[] = [];

function tempPlugin(files: Record<string, string>): { root: string; manifestPath: string } {
	const temp = TempDir.createSync("@omp-plugin-i18n-");
	temps.push(temp);
	const root = temp.path();
	for (const [relative, content] of Object.entries(files)) {
		const filePath = path.join(root, relative);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
	return { root, manifestPath: path.join(root, "package.json") };
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value));
}

function catalog(tables: Partial<Record<"zh" | "en", Record<string, string>>>): PluginLocaleCatalog {
	return { tables, t: (key, fallback) => translatePluginMessage(tables, key, fallback) };
}

type TestHandler = (...args: unknown[]) => Promise<unknown>;

function makeExtension(
	name: string,
	localeCatalog?: PluginLocaleCatalog,
	handlers: Map<string, TestHandler[]> = new Map(),
): Extension {
	return {
		path: name,
		resolvedPath: name,
		localeCatalog,
		handlers,
		tools: new Map(),
		assistantThinkingRenderers: [],
		assistantTextRenderers: [],
		linkSchemes: [],
		fileWriteFallbackHandlers: [],
		fileDeleteFallbackHandlers: [],
		messageRenderers: new Map(),
		composerShapes: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function runnerFor(extensions: Extension[]): ExtensionRunner {
	return new ExtensionRunner(extensions, {} as never, "/project", { getCwd: () => "/project" } as never, {} as never);
}

afterEach(() => {
	setLanguage("en");
	for (const temp of temps.splice(0)) temp.removeSync();
	clearPluginLocaleCache();
});

describe("parsePluginLocales", () => {
	it("accepts string paths for supported languages", () => {
		expect(parsePluginLocales({ zh: "locales/zh.json", en: "locales/en.json" })).toEqual({
			ok: true,
			locales: { zh: "locales/zh.json", en: "locales/en.json" },
		});
	});

	it("treats an absent declaration as empty", () => {
		expect(parsePluginLocales(undefined)).toEqual({ ok: true, locales: {} });
	});

	it("rejects a non-string path with a clear error", () => {
		const result = parsePluginLocales({ zh: 42 });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.error).toContain("locales.zh");
		expect(result.error).toContain("string");
	});

	it("rejects unsupported languages and non-object declarations", () => {
		const unsupported = parsePluginLocales({ fr: "locales/fr.json" });
		expect(unsupported.ok).toBe(false);
		if (!unsupported.ok) expect(unsupported.error).toContain("locales.fr");

		expect(parsePluginLocales(["locales/en.json"]).ok).toBe(false);
		expect(parsePluginLocales("locales/en.json").ok).toBe(false);
	});

	it("rejects an empty path", () => {
		const result = parsePluginLocales({ en: "  " });
		expect(result.ok).toBe(false);
	});
});

describe("plugin locale catalogues", () => {
	it("reads declared catalogues and falls back current language → en → key", async () => {
		const { root } = tempPlugin({});
		writeJson(path.join(root, "i18n", "zh.json"), { greeting: "你好", onlyZh: "仅中文" });
		writeJson(path.join(root, "i18n", "en.json"), { greeting: "Hello", onlyEn: "English only" });

		const localeCatalog = await loadPluginLocaleCatalog({
			path: root,
			manifest: { version: "1.0.0", locales: { zh: "i18n/zh.json", en: "i18n/en.json" } },
		});
		expect(localeCatalog).toBeDefined();

		setLanguage("zh");
		expect(localeCatalog?.t("greeting")).toBe("你好");
		// Missing in zh, present in en → English.
		expect(localeCatalog?.t("onlyEn")).toBe("English only");
		// Missing everywhere → caller fallback, then the key.
		expect(localeCatalog?.t("missing", "caller fallback")).toBe("caller fallback");
		expect(localeCatalog?.t("missing")).toBe("missing");
	});

	it("uses the conventional locales/<tag>.json when the manifest does not declare paths", async () => {
		const { root } = tempPlugin({});
		writeJson(path.join(root, "locales", "en.json"), { greeting: "Hello from convention" });
		writeJson(path.join(root, "locales", "zh.json"), { greeting: "约定目录" });

		const localeCatalog = await loadPluginLocaleCatalog({ path: root, manifest: { version: "1.0.0" } });
		setLanguage("zh");
		expect(localeCatalog?.t("greeting")).toBe("约定目录");
		setLanguage("en");
		expect(localeCatalog?.t("greeting")).toBe("Hello from convention");
	});

	it("survives a missing declared file and still serves the other language", async () => {
		const { root } = tempPlugin({});
		writeJson(path.join(root, "locales", "zh.json"), { greeting: "你好" });

		const localeCatalog = await loadPluginLocaleCatalog({
			path: root,
			manifest: { version: "1.0.0", locales: { zh: "locales/zh.json", en: "locales/en.json" } },
		});
		setLanguage("en");
		expect(localeCatalog?.t("greeting", "fallback")).toBe("fallback");
	});

	it("skips malformed JSON and non-flat catalogues without failing the plugin", async () => {
		const { root } = tempPlugin({ "locales/zh.json": "{ not json" });
		writeJson(path.join(root, "locales", "en.json"), { nested: { value: "no" } });

		expect(await loadPluginLocaleCatalog({ path: root, manifest: { version: "1.0.0" } })).toBeUndefined();
	});

	it("returns undefined when the plugin ships no catalogues", async () => {
		const { root } = tempPlugin({});
		expect(await loadPluginLocaleCatalog({ path: root, manifest: { version: "1.0.0" } })).toBeUndefined();
	});

	it("warns and ignores an invalid manifest declaration", async () => {
		const { root } = tempPlugin({});
		writeJson(path.join(root, "locales", "en.json"), { greeting: "Hello" });

		// A non-string override makes the whole declaration unusable; the
		// conventional files are not silently substituted because the author
		// asked for explicit paths.
		const localeCatalog = await loadPluginLocaleCatalog({
			path: root,
			manifest: { version: "1.0.0", locales: { en: 7 as unknown as string } },
		});
		expect(localeCatalog).toBeUndefined();
	});
});

describe("ctx.t() per-extension injection", () => {
	it("binds each extension to its own plugin catalogue", () => {
		setLanguage("en");
		const runner = runnerFor([
			makeExtension("/plugins/a", catalog({ en: { greeting: "A hello" }, zh: { greeting: "A 你好" } })),
			makeExtension("/plugins/b", catalog({ en: { greeting: "B hello" }, zh: { greeting: "B 你好" } })),
			makeExtension("/extensions/loose"),
		]);
		const base = runner.createContext();

		expect(runner.scopeContextToExtension(base, "/plugins/a").t("greeting")).toBe("A hello");
		expect(runner.scopeContextToExtension(base, "/plugins/b").t("greeting")).toBe("B hello");
		expect(runner.scopeContextToExtension(base, "/extensions/loose").t("greeting", "loose")).toBe("loose");
		expect(base.t("greeting", "base")).toBe("base");
	});

	it("injects the owning catalogue into event handlers and command contexts", async () => {
		setLanguage("en");
		const seen: string[] = [];
		const handlerFor =
			(label: string) =>
			async (...args: unknown[]) => {
				const ctx = args[1] as ExtensionContext;
				seen.push(`${label}:${ctx.t("greeting", "fallback")}`);
			};
		const a = makeExtension(
			"/plugins/a",
			catalog({ en: { greeting: "A hello" } }),
			new Map([["turn_start", [handlerFor("a")]]]),
		);
		const b = makeExtension(
			"/plugins/b",
			catalog({ en: { greeting: "B hello" } }),
			new Map([["turn_start", [handlerFor("b")]]]),
		);
		const runner = runnerFor([a, b]);

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: 0 });

		expect(seen).toEqual(["a:A hello", "b:B hello"]);
		expect(runner.createCommandContext(a.path).t("greeting")).toBe("A hello");
		expect(runner.createCommandContext(b.path).t("greeting")).toBe("B hello");
	});

	it("reflects a /language switch without reloading plugins", () => {
		const localeCatalog = catalog({ en: { greeting: "Hello" }, zh: { greeting: "你好" } });
		const runner = runnerFor([makeExtension("/plugins/a", localeCatalog)]);
		const ctx = runner.scopeContextToExtension(runner.createContext(), "/plugins/a");

		setLanguage("zh");
		expect(ctx.t("greeting")).toBe("你好");
		setLanguage("en");
		expect(ctx.t("greeting")).toBe("Hello");
	});
});
