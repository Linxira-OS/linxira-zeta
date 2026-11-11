#!/usr/bin/env bun
/**
 * Web UI naming guard (frozen `zeta-web` snapshot).
 *
 * `web-ui/` predates the renderer cutover and is excluded from the root
 * `scripts/brand/brand-check.ts` scan, so its user-visible copy needs its own
 * gate: the Studio copy, both locale trees and the shell i18n catalog must not
 * name the upstream product, and must not send users to upstream paths or
 * commands. Product/UI name: Z Work Studio. Runtime identity: Zeta. CLI: zetacode.
 *
 * Frozen contracts and technical identifiers that never render (storage keys,
 * CSS class names, `omp://` internal links, event names, DB names, legacy
 * recording formats, the `OMP.*` relay namespace) are allowed by the narrow
 * patterns below. This guard deliberately scans string literals and JSX text,
 * not comments or identifiers; a comment may name the upstream.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Every directory that renders Studio copy. */
const SOURCE_DIRS = [join(ROOT, "components"), join(ROOT, "studio")];

/** Locale catalogs: the live shell catalog and both Studio catalogs. */
const LOCALES = [
	join(ROOT, "lib", "i18n", "messages", "en.ts"),
	join(ROOT, "lib", "i18n", "messages", "zh-CN.ts"),
	join(ROOT, "components", "studio", "i18n", "locales", "en.ts"),
	join(ROOT, "components", "studio", "i18n", "locales", "zh.ts"),
	join(ROOT, "studio", "i18n", "locales", "en.ts"),
	join(ROOT, "studio", "i18n", "locales", "zh.ts"),
];

/**
 * Strings that are frozen protocol/storage/plumbing surfaces, never copy.
 * Each entry is a whole-string test against the literal.
 */
const TECHNICAL = [
	/^omp:\/\//, // internal link scheme
	/^omp\./, // settings/storage key (omp.appSettings, omp.ida.demo)
	/^omp-studio-(ui|backgrounds)$/, // legacy IndexedDB databases
	/^omp-(menu|tip|mermaid|conversation-|copy)/, // CSS class and event names
	/^ompStudio/, // preload global
	/^@?omp[-/]/, // upstream npm scope / repo path
	/^omp$/, // bare protocol id
	/^ompcast$/, // legacy recording format key
	/^\.omp/, // upstream path suffix in a technical literal
	/^OMP\./, // relay/CDP method namespace
	/^OMP-SESSION-TRACE$/, // exported-HTML custom element (DOM uppercases tagName)
	/^x-omp-/, // blob broker header
	/^(?:data|id)=?[-.]?omp-/, // DOM markers (data-omp-, id=omp-)
	/^__omp_/,
	/^omp\//, // package-specifier path fragment
];

/** Third-party product names that legitimately contain "Studio". */
const STUDIO_ALLOW = /LM Studio|Z Work Studio|Work Studio/;

/**
 * Copy that names the *upstream* store it reads, not this product: the key
 * mirror copies credentials out of a legacy OMP `agent.db`, so the label has to
 * say where they come from. The API path is that mirror's gateway route.
 */
const INTEROP_COPY = [/^Copy key from OMP$/, /^从 OMP 复制密钥$/, /^\/api\/auth\/copy-from-omp\//];

/** Copy that must name the Zeta CLI, not the upstream binary. */
const BAD_COMMAND = /(?<![\w./-])omp (?:login|logout|--)/;

const QUOTED = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const JSX_TEXT = />([^<>{}\n][^<>{}]*)</g;
/** Lines whose literals are plumbing: class names, storage, events, queries. */
const PLUMBING =
	/className=|classList|querySelector|closest\(|localStorage|sessionStorage|indexedDB|addEventListener|dispatchEvent|CSS\.|getElementById|htmlFor=|aria-keyshortcuts/;

interface Hit {
	file: string;
	line: number;
	text: string;
	reason: string;
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = statSync(path);
		if (stat.isDirectory()) out.push(...walk(path));
		else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path);
	}
	return out;
}

function checkText(text: string): string | undefined {
	const value = text.trim();
	if (!value || TECHNICAL.some(pattern => pattern.test(value))) return undefined;
	if (INTEROP_COPY.some(pattern => pattern.test(value))) return undefined;
	if (/\bOMP\b/.test(value)) return "user-visible OMP";
	if (/\bomp\b/.test(value)) return "user-visible omp";
	if (/oh-my-pi/i.test(value)) return "user-visible oh-my-pi";
	if (BAD_COMMAND.test(value)) return "upstream command (the CLI is zetacode)";
	if (/(?<!Work )(?<!LM )\bStudio\b/.test(value) && !STUDIO_ALLOW.test(value)) {
		return "bare Studio as product name";
	}
	return undefined;
}

function scanLocale(path: string): Hit[] {
	const hits: Hit[] = [];
	readFileSync(path, "utf8")
		.split("\n")
		.forEach((line, index) => {
			if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
			// Locale strings are values after a colon. Ignore the key itself.
			const valueStart = line.indexOf(":");
			if (valueStart < 0) return;
			for (const match of line.slice(valueStart + 1).matchAll(QUOTED)) {
				const reason = checkText(match[2] ?? "");
				if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[2]!, reason });
			}
		});
	return hits;
}

function scanSource(path: string): Hit[] {
	const hits: Hit[] = [];
	readFileSync(path, "utf8")
		.split("\n")
		.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
			const plumbing = PLUMBING.test(line);
			if (!plumbing) {
				for (const match of line.matchAll(QUOTED)) {
					const reason = checkText(match[2] ?? "");
					if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[2]!, reason });
				}
			}
			for (const match of line.matchAll(JSX_TEXT)) {
				const reason = checkText(match[1] ?? "");
				if (reason) hits.push({ file: relative(ROOT, path), line: index + 1, text: match[1]!, reason });
			}
		});
	return hits;
}

const hits = [...LOCALES.flatMap(scanLocale), ...SOURCE_DIRS.flatMap(dir => walk(dir).flatMap(scanSource))];
if (hits.length > 0) {
	console.error("Web UI naming guard failed: user-visible upstream/product names\n");
	for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.reason}: ${JSON.stringify(hit.text)}`);
	console.error(`\n${hits.length} hit(s). Use Z Work Studio for the product/UI, Zeta for the runtime and`);
	console.error("zetacode for the CLI; allow only frozen contracts/technical identifiers in web-ui/scripts/check-studio-naming.ts.");
	process.exit(1);
}
console.log("Web UI naming guard: clean");
