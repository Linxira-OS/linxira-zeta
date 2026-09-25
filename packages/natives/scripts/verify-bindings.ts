#!/usr/bin/env bun

/**
 * Post-build guard: the committed bindings and the freshly built addon must
 * agree, name for name.
 *
 * A stale `.node` is otherwise silent. `require()` still resolves, the export
 * table still lists the name, and only a `new` on it blows up much later inside
 * a test that has nothing to do with native code. That is exactly how a
 * pre-merge addon built in September kept passing every export-presence check
 * while `EditStore`, `renderMermaidAscii` and the `appleFm*` family were all
 * undefined on this machine.
 *
 * This runs right after the bindings are installed, so a build that produced an
 * incomplete addon fails here instead of surfacing days later in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, "..", "native");
const dtsPath = path.join(nativeDir, "index.d.ts");
const jsPath = path.join(nativeDir, "index.js");

/** Names the committed type surface promises, split by declaration kind. */
function parseDeclaredSurface(source: string): { functions: string[]; classes: string[]; constants: string[] } {
	const functions = [...source.matchAll(/^export declare function (\w+)/gm)].map(m => m[1]!);
	const classes = [...source.matchAll(/^export declare class (\w+)/gm)].map(m => m[1]!);
	const constants = [...source.matchAll(/^export declare const (\w+)/gm)].map(m => m[1]!);
	return { functions, classes, constants };
}

/**
 * The names the runtime re-exports off the addon. `native/index.js` is
 * generated, so it — not the `.node` — is the contract: whatever it pulls out
 * of `nativeBindings` has to actually be there. Both direct pass-throughs and
 * adapter-wrapped exports count.
 */
function parseReExportedNames(source: string): string[] {
	const names = new Set<string>();
	for (const m of source.matchAll(/^export const (\w+) = nativeBindings\.\w+;/gm)) names.add(m[1]!);
	for (const m of source.matchAll(/^export const (\w+) = \w+\(nativeBindings\.\w+\);/gm)) names.add(m[1]!);
	for (const m of source.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(m[1]!);
	return [...names];
}

/** Import the public surface the way a consumer does (loader validates too). */
async function loadPublicSurface(): Promise<Record<string, unknown>> {
	const mod = (await import(`file://${jsPath.replace(/\\/g, "/")}`)) as Record<string, unknown>;
	return mod;
}

export async function verifyBindings(): Promise<void> {
	if (!fs.existsSync(dtsPath) || !fs.existsSync(jsPath)) {
		throw new Error(`bindings missing: expected index.d.ts and index.js under ${nativeDir}`);
	}

	const declared = parseDeclaredSurface(fs.readFileSync(dtsPath, "utf-8"));
	const reExported = parseReExportedNames(fs.readFileSync(jsPath, "utf-8"));
	const total = declared.functions.length + declared.classes.length + declared.constants.length;
	if (total === 0) throw new Error("index.d.ts declares no native surface — refusing to pass a vacuous check");
	if (reExported.length === 0) {
		throw new Error("index.js exposes no native re-exports — the generated surface looks wrong");
	}

	const surface = await loadPublicSurface();

	// A re-export resolves to undefined when the addon predates the binding.
	const missing = reExported.filter(name => surface[name] === undefined);
	const declaredNames = [...new Set([...declared.functions, ...declared.classes, ...declared.constants])];
	const declaredButNotReExported = declaredNames.filter(name => !reExported.includes(name));

	const problems: string[] = [];
	if (missing.length > 0) {
		problems.push(
			`${missing.length} export(s) resolve to undefined — the built addon is older than the bindings:`,
			...missing.map(name => `  - ${name}`),
		);
	}
	if (declaredButNotReExported.length > 0) {
		problems.push(
			`${declaredButNotReExported.length} declared name(s) are not re-exported by index.js:`,
			...declaredButNotReExported.map(name => `  - ${name}`),
		);
	}
	if (problems.length > 0) {
		throw new Error(
			`native binding verification failed (${reExported.length} re-exports, ${total} declared symbols).\n` +
				`Rebuild the addon (bun run build in packages/natives) — a stale .node must not pass.\n\n` +
				problems.join("\n"),
		);
	}

	console.log(`Native bindings verified: ${reExported.length} re-exports, ${total} declared symbols, all defined.`);
}

// Direct invocation (`bun run scripts/verify-bindings.ts`) runs the check;
// importing it (build-bindings.ts) only pulls in the function.
if (import.meta.main) {
	await verifyBindings();
}
