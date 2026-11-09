/**
 * Cutover ownership proof: core must not depend on the official plugin.
 *
 * The plugin is allowed to import core (`@linxiraos/zeta`) because it is a
 * plugin. The reverse direction would make the core Team/Lead runtime depend on
 * a plugin and turn `@linxiraos/pi-messenger` into a product-definition
 * conflict. This test checks the manifest and the parsed import graph, not
 * source text, so comments or docs mentioning the plugin cannot trip it.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { isRecord } from "@linxiraos/pi-utils";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const CODING_AGENT_DIR = path.join(REPO_ROOT, "packages", "coding-agent");
const CORE_TEAM_DIR = path.join(CODING_AGENT_DIR, "src", "team");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "official", "pi-messenger");
const PLUGIN_PACKAGE = "@linxiraos/pi-messenger";
const PLUGIN_RELATIVE_DIR = "plugins/official/pi-messenger";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

function workspacePatterns(pkg: Record<string, unknown>): string[] {
	const workspaces = pkg.workspaces;
	if (Array.isArray(workspaces)) return workspaces.filter((entry): entry is string => typeof entry === "string");
	if (workspaces && typeof workspaces === "object" && "packages" in workspaces) {
		const packages = workspaces.packages;
		if (Array.isArray(packages)) return packages.filter((entry): entry is string => typeof entry === "string");
	}
	return [];
}

/** Minimal workspace-glob matcher: only `*` (one path segment) and `**` matter here. */
function workspacePatternMatches(pattern: string, relativeDir: string): boolean {
	let source = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		if (char === "*" && pattern[index + 1] === "*") {
			source += ".*";
			index++;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`).test(relativeDir);
}

function dependencyNames(pkg: Record<string, unknown>): string[] {
	const names = new Set<string>();
	for (const field of DEPENDENCY_FIELDS) {
		const block = pkg[field];
		if (block && typeof block === "object" && !Array.isArray(block)) {
			for (const name of Object.keys(block)) names.add(name);
		}
	}
	// npm treats an array (or object, in old manifests) of bundled deps as
	// dependencies too; a plugin there is just as much of an ownership leak.
	const bundled = pkg.bundledDependencies ?? pkg.bundleDependencies;
	if (Array.isArray(bundled)) {
		for (const name of bundled) if (typeof name === "string") names.add(name);
	} else if (bundled && typeof bundled === "object") {
		for (const name of Object.keys(bundled)) names.add(name);
	}
	return [...names].sort();
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) out.push(full);
	}
	return out.sort();
}

/** Every static/dynamic import or export specifier in one source file. */
function importSpecifiers(filePath: string): string[] {
	const project = new Project({ useInMemoryFileSystem: true });
	const source = project.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), { overwrite: true });
	const specifiers = [
		...source.getImportDeclarations().map(declaration => declaration.getModuleSpecifierValue()),
		...source.getExportDeclarations().map(declaration => declaration.getModuleSpecifierValue()),
	];
	for (const node of source.getDescendantsOfKind(SyntaxKind.ImportType)) {
		specifiers.push(
			node
				.getArgument()
				.getText()
				.replace(/^['"]|['"]$/g, ""),
		);
	}
	for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		const expression = call.getExpression();
		const isDynamicImport = expression.getKind() === SyntaxKind.ImportKeyword;
		const isRequire = Node.isIdentifier(expression) && expression.getText() === "require";
		if (!isDynamicImport && !isRequire) continue;
		const [argument] = call.getArguments();
		if (Node.isStringLiteral(argument)) specifiers.push(argument.getLiteralValue());
	}
	return specifiers.filter((specifier): specifier is string => typeof specifier === "string");
}

function isPluginSpecifier(specifier: string): boolean {
	return (
		specifier === PLUGIN_PACKAGE ||
		specifier.startsWith(`${PLUGIN_PACKAGE}/`) ||
		specifier.includes("plugins/official/pi-messenger")
	);
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
	const value: unknown = await Bun.file(filePath).json();
	if (!isRecord(value)) throw new Error(`${filePath} must contain a JSON object`);
	return value;
}

describe("core/plugin ownership", () => {
	test("coding-agent does not depend on @linxiraos/pi-messenger", async () => {
		const pkg = await readJsonObject(path.join(CODING_AGENT_DIR, "package.json"));
		expect(dependencyNames(pkg)).not.toContain(PLUGIN_PACKAGE);
	});

	test("core Team code has no import of the official plugin", () => {
		const files = sourceFiles(CORE_TEAM_DIR);
		expect(files.length).toBeGreaterThan(0);
		const leaks = files.flatMap(file =>
			importSpecifiers(file)
				.filter(isPluginSpecifier)
				.map(specifier => `${path.relative(REPO_ROOT, file)} -> ${specifier}`),
		);
		expect(leaks).toEqual([]);
	});

	test("pi-messenger stays bundled and outside the root workspace", async () => {
		const manifest = await readJsonObject(path.join(PLUGIN_DIR, "plugin.json"));
		expect(manifest.id).toBe("pi-messenger");
		expect(manifest.publish).toBe(PLUGIN_PACKAGE);
		expect(manifest.distribution).toBe("bundled");

		const rootPkg = await readJsonObject(path.join(REPO_ROOT, "package.json"));
		const matchingPatterns = workspacePatterns(rootPkg).filter(pattern =>
			workspacePatternMatches(pattern, PLUGIN_RELATIVE_DIR),
		);
		expect(matchingPatterns).toEqual([]);
	});

	test("the plugin peer-depends on core; core never depends on the plugin", async () => {
		const pluginPkg = await readJsonObject(path.join(PLUGIN_DIR, "package.json"));
		const peers = pluginPkg.peerDependencies;
		expect(isRecord(peers) && typeof peers["@linxiraos/zeta"] === "string").toBe(true);
		expect(pluginPkg.dependencies).not.toHaveProperty(PLUGIN_PACKAGE);

		const corePkg = await readJsonObject(path.join(CODING_AGENT_DIR, "package.json"));
		expect(dependencyNames(corePkg)).not.toContain(PLUGIN_PACKAGE);
	});
});
