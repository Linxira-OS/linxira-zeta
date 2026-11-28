/**
 * Static page contract: every RPC the pages call is declared in the local
 * transport contract, every literal label resolves in both locales, and the
 * pages do not reach into a retired Studio shell.
 *
 * The page source is the input; no browser or bundled renderer is required.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const pagesDir = fileURLToPath(new URL("..", import.meta.url));
const source = (file: string): string => readFileSync(`${pagesDir}${file}`, "utf8");

const PAGE_FILES = [
	"App.tsx",
	"ModelsPage.tsx",
	"RoomsPage.tsx",
	"TeamPage.tsx",
	"TeamWorkspacePage.tsx",
	"TeamImChatPane.tsx",
	"modelsControl.ts",
	"modelsBlueprint.ts",
];

function interfaceKeys(text: string, name: string): string[] {
	const marker = `export interface ${name} {`;
	const start = text.indexOf(marker);
	if (start < 0) throw new Error(`missing ${name}`);
	let depth = 1;
	let index = start + marker.length;
	while (index < text.length && depth > 0) {
		const char = text[index];
		if (char === "{") depth += 1;
		else if (char === "}") depth -= 1;
		index += 1;
	}
	return [...text.slice(start + marker.length, index - 1).matchAll(/^\t"([^"]+)":/gmu)].map(match => match[1]!);
}

function rpcNames(text: string): string[] {
	return [...text.matchAll(/\b(?:client\.)?(?:query|command)\(\s*"([^"]+)"/gu)].map(match => match[1]!);
}

describe("page RPC contract", () => {
	test("every query and command the pages call is declared locally", () => {
		const contract = source("contract/operations.ts");
		const declared = new Set([
			...interfaceKeys(contract, "QueryInputMap"),
			...interfaceKeys(contract, "CommandInputMap"),
		]);
		const used = new Set(PAGE_FILES.flatMap(file => rpcNames(source(file))));
		expect([...used].filter(name => !declared.has(name))).toEqual([]);
		expect(used.size).toBeGreaterThan(20);
	});
});

describe("page copy contract", () => {
	test("every literal label exists in both locales", () => {
		const dictionary = readFileSync(fileURLToPath(new URL("../../i18n/index.ts", import.meta.url)), "utf8");
		const zhStart = dictionary.indexOf("export const zhCN: Messages = {");
		const localeStart = dictionary.indexOf("export type Locale");
		const en = dictionary.slice(dictionary.indexOf("export const en = {"), zhStart);
		const zh = dictionary.slice(zhStart, localeStart);
		const keys = new Set<string>();
		for (const file of PAGE_FILES) {
			for (const match of source(file).matchAll(/\bt\(\s*"([^"]+)"/gu)) keys.add(match[1]!);
		}
		const copyBlock = source("TeamWorkspacePage.tsx");
		const copyKeys = copyBlock.slice(copyBlock.indexOf("type CopyKey ="), copyBlock.indexOf("type Copy ="));
		for (const match of copyKeys.matchAll(/\|\s*"([^"]+)"/gu)) keys.add(`teamWorkspace.${match[1]!}`);
		expect(keys.size).toBeGreaterThan(100);
		expect([...keys].filter(key => !en.includes(`"${key}":`))).toEqual([]);
		expect([...keys].filter(key => !zh.includes(`"${key}":`))).toEqual([]);
	});
});

describe("external page boundary", () => {
	test("pages do not import a retired Studio shell", () => {
		for (const file of [...PAGE_FILES, "pageRoutes.ts"]) {
			const text = source(file);
			expect(text).not.toMatch(/from\s+"(?:web-app|desktop|retired)\//u);
			expect(text).not.toMatch(/import\(\s*"(?:web-app|desktop|retired)\//u);
		}
	});

	test("the Team workspace does not pass its Team DB id as a graph cluster", () => {
		expect(source("TeamWorkspacePage.tsx")).not.toMatch(/<TeamPage\b[^>]*\bteamId=/u);
		expect(source("TeamPage.tsx")).not.toMatch(/\bclusterId:\s*`team:\$\{/u);
	});
});
