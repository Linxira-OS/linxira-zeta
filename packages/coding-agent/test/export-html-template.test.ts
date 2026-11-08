import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseHTML } from "@linxiraos/pi-utils/dom";
import type { BunPlugin } from "bun";
import { getTemplate } from "../src/export/html/index";

const bundleDistUrl = new URL("../scripts/bundle-dist.ts", import.meta.url).href;
const probePath = path.resolve(import.meta.dir, "fixtures", "html-export-template-probe.ts");
const packageDir = path.resolve(import.meta.dir, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-html-template-"));
const unrelatedCwd = path.join(tempRoot, "unrelated-cwd");
const bundleDir = path.join(tempRoot, "bundle");
const compiledPath = path.join(tempRoot, "compiled-template-probe");
let bundlePath: string;
const dependencyStubs: Record<string, string> = {
	"@linxiraos/pi-stats/trace":
		'export const buildSessionTraceFromSnapshots = () => { throw new Error("Trace assembly is outside the template probe"); };',
	"@linxiraos/pi-utils": `export const APP_NAME = "zeta"; export const isEnoent = err => err?.code === "ENOENT";`,
	"@linxiraos/pi-tui/theme":
		"export const getResolvedThemeColors = async () => ({}); export const getThemeExportColors = async () => ({});",
	"../../session/sub-sessions": "export const collectSubSessions = async () => ({});",
	"../../session/session-manager":
		"export class SessionManager { static async open() { return new SessionManager(); } }",
};
const focusedBundlePlugin: BunPlugin = {
	name: "html-template-focused-bundle",
	setup(build) {
		build.onResolve({ filter: /.*/ }, args =>
			dependencyStubs[args.path] === undefined ? undefined : { path: args.path, namespace: "template-probe-stub" },
		);
		build.onLoad({ filter: /.*/, namespace: "template-probe-stub" }, args => ({
			contents: dependencyStubs[args.path]!,
			loader: "js",
		}));
	},
};

async function runProbe(command: string[]): Promise<string> {
	const proc = Bun.spawn(command, { cwd: unrelatedCwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return stdout;
}

beforeAll(async () => {
	await fs.mkdir(unrelatedCwd);
	const bundle = await Bun.build({
		entrypoints: [probePath],
		outdir: bundleDir,
		target: "bun",
		plugins: [focusedBundlePlugin],
		define: { "process.env.PI_BUNDLED": '"true"' },
	});
	if (!bundle.success) throw new AggregateError(bundle.logs, "Template probe bundle failed");
	const entrypoint = bundle.outputs.find(output => output.kind === "entry-point");
	if (!entrypoint) throw new Error("Template probe emitted no entry point");
	bundlePath = entrypoint.path;
	const compiled = await Bun.build({
		entrypoints: [probePath],
		target: "bun",
		plugins: [focusedBundlePlugin],
		define: { "process.env.PI_BUNDLED": '"true"' },
		compile: { outfile: compiledPath },
	});
	if (!compiled.success) throw new AggregateError(compiled.logs, "Compiled template probe failed");
}, 120_000);

afterAll(async () => {
	await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("HTML export template", () => {
	test("source exports inline the viewer and both libraries without remote scripts", async () => {
		const html = getTemplate();
		const { document } = parseHTML(html);
		expect(document.querySelectorAll("script[src]")).toHaveLength(0);
		expect(html).not.toContain("stencil.so");
		expect(html).not.toContain("build.stencil");
		expect(html).toContain("globalThis.zetaMarkdown");
		expect(html).toContain("hljs");
		expect(html).toBe(await runProbe([process.execPath, probePath]));
	});

	test("export theme preference reads and migrates the legacy localStorage key", () => {
		const html = getTemplate();
		const { document } = parseHTML(html);
		const script = [...document.querySelectorAll("script")].find(node =>
			node.textContent?.includes("zeta-export-theme"),
		);
		expect(script).toBeDefined();

		const run = (stored: Record<string, string>) => {
			const store = new Map(Object.entries(stored));
			const localStorage = {
				getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
				setItem: (key: string, value: string) => store.set(key, String(value)),
			};
			const doc = { documentElement: { dataset: {} as Record<string, string> } };
			new Function("localStorage", "document", script!.textContent!)(localStorage, doc);
			return { store, theme: doc.documentElement.dataset.theme };
		};

		const legacy = run({ "omp-export-theme": "dark" });
		expect(legacy.theme).toBe("dark");
		expect(legacy.store.get("zeta-export-theme")).toBe("dark");

		const canonical = run({ "zeta-export-theme": "light", "omp-export-theme": "dark" });
		expect(canonical.theme).toBe("light");
		expect(html).toContain("'omp-export:sidebar-width'");
	});

	test("packaged exports inline the same offline viewer as source exports", async () => {
		const html = await runProbe([process.execPath, bundlePath]);
		const { document } = parseHTML(html);
		expect(document.querySelectorAll("script[src]")).toHaveLength(0);
		expect(html).not.toContain("stencil.so");
		expect(html).not.toContain("build.stencil");
		expect(Buffer.byteLength(html)).toBeGreaterThan(800_000);
	});

	test("npm-style bundle and compiled binary export identical offline HTML from an unrelated directory", async () => {
		const expected = await runProbe([process.execPath, bundlePath]);
		expect(await runProbe([compiledPath])).toBe(expected);
		const bundleFiles = await fs.readdir(bundleDir);
		expect(bundleFiles).toContain(path.basename(bundlePath));
		expect(
			bundleFiles.every(file => file === path.basename(bundlePath) || /^(marked|highlight)\.min-/.test(file)),
		).toBe(true);
	});

	test("npm packages ship the inline viewer and omit old sidecars", async () => {
		const productionDir = path.join(tempRoot, "production-bundle");
		const staleAsset = path.join(productionDir, "template-stale.css");
		await Bun.write(staleAsset, "obsolete viewer sidecar");
		const runner = path.join(tempRoot, "bundle-dist-runner.ts");
		await Bun.write(
			runner,
			`import { bundleDist } from ${JSON.stringify(bundleDistUrl)};\nawait bundleDist(${JSON.stringify(productionDir)});\n`,
		);
		const proc = Bun.spawn([process.execPath, runner], {
			cwd: packageDir,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
		expect(await Bun.file(staleAsset).exists()).toBe(false);

		const repoRoot = path.resolve(packageDir, "../..");
		const packWorkspace = path.join(tempRoot, "pack-workspace");
		const packageRel = path.relative(repoRoot, packageDir).split(path.sep).join("/");
		const rootManifest = await Bun.file(path.join(repoRoot, "package.json")).json();
		rootManifest.workspaces = { packages: [packageRel], catalog: rootManifest.workspaces.catalog };
		await Bun.write(path.join(packWorkspace, "package.json"), JSON.stringify(rootManifest));
		await Bun.write(path.join(packWorkspace, "bun.lock"), Bun.file(path.join(repoRoot, "bun.lock")));
		const packDir = path.join(packWorkspace, packageRel);
		await Bun.write(path.join(packDir, "package.json"), Bun.file(path.join(packageDir, "package.json")));
		await fs.cp(productionDir, path.join(packDir, "dist"), { recursive: true });
		await fs.cp(path.join(packageDir, "src/export/html"), path.join(packDir, "src/export/html"), { recursive: true });
		const pack = Bun.spawn([process.execPath, "pm", "pack", "--dry-run", "--ignore-scripts"], {
			cwd: packDir,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [packOut, packErr, packExit] = await Promise.all([
			new Response(pack.stdout).text(),
			new Response(pack.stderr).text(),
			pack.exited,
		]);
		expect(packExit, packErr).toBe(0);
		const packed = Array.from(packOut.matchAll(/^packed \S+ (.+)$/gm), match => match[1]);
		expect(packed).toContain("src/export/html/template.html.txt");
		expect(packed).toContain("src/export/html/viewer.generated.json");
		expect(packed).toContain("src/export/html/viewer.generated.ts");
		expect(packed).toContain("src/export/html/vendor/marked.min.js");
		expect(packed).toContain("src/export/html/vendor/highlight.min.js");
		for (const name of ["shell.html", "template.css", "template.js", "share-loader.js"]) {
			expect(packed).not.toContain(`src/export/html/${name}`);
		}
		expect(packed.filter(file => /^dist\/(template-|tool-views\.|marked\.|highlight\.)/.test(file))).toEqual([]);
	}, 60_000);
});
