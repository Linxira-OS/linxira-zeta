#!/usr/bin/env bun
/**
 * robomp ↔ container CLI-contract guard.
 *
 * robomp's worker spawns the coding-agent CLI *by name* (`RpcClient(
 * executable=settings.omp_command)`, `python/robomp/src/worker.py`), never by
 * path. If that name is not on PATH inside the image, the whole task loop dies
 * at RpcClient startup — a live failure in the bot container, not a cosmetic
 * brand nit (the same class as the 2026-10-10 `bin: "omp"` fixture incident).
 *
 * Today the image ships exactly one CLI shim: `/usr/local/bin/zetacode`,
 * written by the `pi-base` stage of `Dockerfile` and inherited by
 * `Dockerfile.robomp` through `${PI_BASE}`. Nothing else on PATH resolves to
 * CLI — `packages/coding-agent/package.json`'s `zetacode`
 * bin is only linked into `node_modules/.bin`, which is not on the
 * container's PATH.
 *
 * Both sides are derived from the real files, so neither can drift silently:
 *
 *   image side  — every name the Dockerfiles create in a directory listed in
 *                 their own `ENV ... PATH=` (printf redirect target, `ln -s`
 *                 link name, `COPY` destination). `Dockerfile.robomp` inherits
 *                 its PATH from the base it names in `FROM ${PI_BASE}`, so the
 *                 PATH dirs are unioned across both files.
 *   robomp side — `src/config.py`'s `omp_command` default, the
 *                 `ROBOMP_OMP_COMMAND` value in `docker-compose.yml`, and the
 *                 one in `.env.example`.
 *
 * Also checked:
 *   - each Dockerfile's `ENTRYPOINT`/`CMD` binary still resolves to a name that
 *     file (or the base it inherits) creates — a shim rename must move the
 *     entrypoint with it;
 *   - `desktop/src/serve-resolution.ts`'s `SERVE_BIN_NAMES` intersects the shim
 *     names, so spawning the CLI by name works for the desktop shell inside the
 *     same image;
 *   - `/usr/local/bin/...` shim paths quoted in `python/robomp/AGENTS.md` name
 *     real shims (the doc claimed a `/usr/local/bin/omp` shim that never
 *     existed).
 *
 * Deliberately NOT checked: env-var *names* (`ROBOMP_OMP_COMMAND`, `PI_ROOT`,
 * `OMP_*`) — renaming those is a separate, deferred migration (see
 * `document/roadmap.md`); only the values and the shim name are in contract.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

/** Dockerfiles, in inheritance order: the robomp image layers on the base. */
const DOCKERFILES = ["Dockerfile", "Dockerfile.robomp"];
const COMPOSE = "python/robomp/docker-compose.yml";
const ENV_EXAMPLE = "python/robomp/.env.example";
const CONFIG = "python/robomp/src/config.py";
const ROBOMP_AGENTS = "python/robomp/AGENTS.md";
const SERVE_RESOLUTION = "desktop/src/serve-resolution.ts";

const problems: string[] = [];

function read(rel: string): string {
	const abs = path.join(ROOT, rel);
	try {
		return readFileSync(abs, "utf8");
	} catch {
		problems.push(`${rel}: unreadable — the guard's file list is stale`);
		return "";
	}
}

/** Physical lines joined on `\` continuations, comments dropped. */
function logicalLines(text: string): Array<{ line: number; text: string }> {
	const out: Array<{ line: number; text: string }> = [];
	const physical = text.split("\n");
	let buffer: string | null = null;
	let start = 0;
	for (let i = 0; i < physical.length; i++) {
		const raw = physical[i] ?? "";
		const continued = raw.trimEnd().endsWith("\\");
		const piece = continued ? raw.trimEnd().slice(0, -1) : raw;
		if (buffer === null) {
			start = i + 1;
			buffer = piece;
		} else {
			buffer += piece;
		}
		if (!continued) {
			const trimmed = buffer.trim();
			if (trimmed !== "" && !trimmed.startsWith("#")) out.push({ line: start, text: trimmed });
			buffer = null;
		}
	}
	return out;
}

/** Directory a single-line creation target lives in, or `null` for a relative one. */
function absoluteDirOf(target: string): string | null {
	return target.startsWith("/") ? path.dirname(target) : null;
}

const createdDirs = new Set<string>();
/** name → { dir, where } for every entry these Dockerfiles create. */
const created = new Map<string, { dir: string; where: string }>();
/** PATH dirs declared by any Dockerfile (the derived image inherits the base's ENV). */
const pathDirs = new Set<string>();

for (const file of DOCKERFILES) {
	for (const { line, text } of logicalLines(read(file))) {
		// ENV ... PATH=a:b:c
		const pathMatch = /^ENV\b[^\n]*?\bPATH=(\S+)/.exec(text);
		if (pathMatch) {
			for (const dir of pathMatch[1].split(":")) {
				if (dir.startsWith("/")) pathDirs.add(dir);
			}
		}
		// printf '…' > /usr/local/bin/x   (the shim writer)
		for (const m of text.matchAll(/>\s*([^\s'"`]+)/g)) {
			const dir = absoluteDirOf(m[1]);
			if (dir === null) continue;
			createdDirs.add(dir);
			if (!created.has(path.basename(m[1]))) created.set(path.basename(m[1]), { dir, where: `${file}:${line}` });
		}
		// ln -s <target> /usr/local/bun-node-fallback-bin/node
		for (const m of text.matchAll(/\bln\s+-s\S*\s+(\S+)\s+(\S+)/g)) {
			const dir = absoluteDirOf(m[2]);
			if (dir === null) continue;
			createdDirs.add(dir);
			if (!created.has(path.basename(m[2]))) created.set(path.basename(m[2]), { dir, where: `${file}:${line}` });
		}
		// COPY [--flags] src… <dest>
		if (/^COPY\b/.test(text)) {
			const tokens = text
				.split(/\s+/)
				.slice(1)
				.filter(token => !token.startsWith("--"));
			if (tokens.length >= 2) {
				const dest = tokens[tokens.length - 1];
				const dir = absoluteDirOf(dest);
				if (dir !== null) {
					const source = dest.endsWith("/") ? tokens[tokens.length - 2] : dest;
					createdDirs.add(dir);
					if (!created.has(path.basename(source))) {
						created.set(path.basename(source), { dir, where: `${file}:${line}` });
					}
				}
			}
		}
	}
}

/** Names on the container's PATH: created in a directory the image's PATH lists. */
const onPath = new Map<string, string>();
for (const [name, entry] of created) {
	if (pathDirs.has(entry.dir)) onPath.set(name, entry.where);
}

if (onPath.size === 0) {
	problems.push(
		`${DOCKERFILES.join(", ")}: no CLI name created on PATH — the guard's Dockerfile parser is stale, not the contract`,
	);
}

// ── robomp's resolved command names ────────────────────────────────────────
const configText = read(CONFIG);
const configMatch = /omp_command\s*:\s*str\s*=\s*Field\(\s*"([^"]+)"/.exec(configText);
const composeText = read(COMPOSE);
const composeMatch = /^\s*ROBOMP_OMP_COMMAND\s*:\s*(\S+)\s*$/m.exec(composeText);
const envText = read(ENV_EXAMPLE);
const envMatch = /^ROBOMP_OMP_COMMAND\s*=\s*(\S+)\s*$/m.exec(envText);

const resolved: Array<{ where: string; raw: string }> = [];
if (configMatch) {
	resolved.push({
		where: `${CONFIG}:${configText.slice(0, configMatch.index).split("\n").length}`,
		raw: configMatch[1],
	});
} else {
	problems.push(`${CONFIG}: no \`omp_command: str = Field("…")\` default — the guard's anchor is stale`);
}
if (composeMatch) {
	resolved.push({
		where: `${COMPOSE}:${composeText.slice(0, composeMatch.index).split("\n").length}`,
		raw: composeMatch[1],
	});
} else {
	problems.push(`${COMPOSE}: no \`ROBOMP_OMP_COMMAND:\` value — the guard's anchor is stale`);
}
if (envMatch) {
	resolved.push({
		where: `${ENV_EXAMPLE}:${envText.slice(0, envMatch.index).split("\n").length}`,
		raw: envMatch[1],
	});
} else {
	problems.push(`${ENV_EXAMPLE}: no \`ROBOMP_OMP_COMMAND=\` value — the guard's anchor is stale`);
}

const names = new Set<string>();
for (const { where, raw } of resolved) {
	const value = raw.trim().replace(/^["']|["']$/g, "");
	const name = value.includes("/") ? path.basename(value) : value;
	names.add(name);
	if (value.includes("/") && !pathDirs.has(path.dirname(value))) {
		problems.push(`${where}: robomp spawns \`${raw}\` — ${path.dirname(value)} is not on the image's PATH`);
	}
	if (!onPath.has(name)) {
		problems.push(
			`${where}: robomp spawns \`${raw}\`, but no image creates \`${name}\` on PATH ` +
				`(shims: ${[...onPath.keys()].sort().join(", ") || "none"})`,
		);
	}
}
if (names.size > 1) {
	problems.push(
		`ROBOMP_OMP_COMMAND disagrees across ${resolved.map(entry => entry.where).join(", ")}: ` +
			`${[...names].sort().join(" vs ")} — one knob, one command name`,
	);
}

// ── entrypoints still point at a created shim ──────────────────────────────
for (const file of DOCKERFILES) {
	for (const { line, text } of logicalLines(read(file))) {
		if (!/^(ENTRYPOINT|CMD)\s*\[/.test(text)) continue;
		for (const token of text.matchAll(/"(\/[^"]*)"/g)) {
			const bin = token[1];
			const dir = path.dirname(bin);
			if (!createdDirs.has(dir)) continue; // system baseline (e.g. /usr/bin/tini)
			if (!onPath.has(path.basename(bin))) {
				problems.push(
					`${file}:${line}: ${bin} is not a name these Dockerfiles create on PATH ` +
						`(shims: ${[...onPath.keys()].sort().join(", ") || "none"})`,
				);
			}
		}
	}
}

// ── the desktop shell probes the same image by name ────────────────────────
const serveText = read(SERVE_RESOLUTION);
const serveMatch = /SERVE_BIN_NAMES\s*=\s*\[([^\]]+)\]/s.exec(serveText);
if (serveMatch) {
	const probed = [...serveMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
	if (probed.length > 0 && !probed.some(name => onPath.has(name))) {
		problems.push(
			`${SERVE_RESOLUTION}: SERVE_BIN_NAMES (${probed.join(", ")}) all miss the image's PATH shims ` +
				`(${[...onPath.keys()].sort().join(", ")}) — serve resolution would fail in-container`,
		);
	}
} else {
	problems.push(`${SERVE_RESOLUTION}: no \`SERVE_BIN_NAMES = [...]\` — the guard's anchor is stale`);
}

// ── robomp's docs name real shims ─────────────────────────────────────────
const agentsText = read(ROBOMP_AGENTS);
for (const m of agentsText.matchAll(/\/usr\/local\/bin\/([A-Za-z0-9._-]+)/g)) {
	const name = m[1];
	if (!onPath.has(name)) {
		problems.push(
			`${ROBOMP_AGENTS}:${agentsText.slice(0, m.index).split("\n").length}: claims a ` +
				`\`/usr/local/bin/${name}\` shim, which no image creates ` +
				`(shims: ${[...onPath.keys()].sort().join(", ") || "none"})`,
		);
	}
}

if (problems.length > 0) {
	console.error("robomp CLI contract FAILED:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`robomp CLI contract OK: image PATH shims: ${[...onPath.entries()]
		.map(([name, where]) => `${name} (${where})`)
		.join(", ")}`,
);
console.log(`  robomp spawns: ${resolved.map(entry => `${entry.raw} (${entry.where})`).join(", ")}`);
