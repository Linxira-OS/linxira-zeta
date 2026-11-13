/**
 * Shared `/initzetateam` command surface.
 *
 * CLI and slash-command callers pass parsed strings; this module builds the
 * same `BootstrapInput`, plans/preflights, applies the journal, resumes, or
 * rolls back. It never prompts, so TUI and headless paths are identical.
 */

import type { BootstrapInput, BootstrapRepoInput, BootstrapRoomInput } from "./bootstrap";
import {
	applyTeamBootstrap,
	planTeamBootstrap,
	resumeTeamBootstrap,
	rollbackBootstrapRun,
	type BootstrapResult,
} from "./bootstrap";
import { resolveTeamDbPath } from "./db";
import { TeamError } from "./errors";

export interface BootstrapCommandOptions {
	name?: string;
	root?: string;
	displayName?: string;
	pms?: string[];
	repos?: string[];
	engineers?: string[];
	rooms?: string[];
	binds?: string[];
	engineerOnly?: boolean;
	/** Leave a failed run resumable instead of compensating it immediately. */
	noRollback?: boolean;
	resume?: string;
	rollback?: string;
	dbPath?: string;
	json?: boolean;
}

export interface BootstrapCommandOutput {
	text: string;
	result?: BootstrapResult;
	rollbackErrors?: string[];
}

function parseRepo(value: string): BootstrapRepoInput {
	const separator = value.indexOf("=");
	if (separator < 0) throw new TeamError(`--repo must be <name>=clone:<url> or <name>=link:<path>; got "${value}"`);
	const name = value.slice(0, separator).trim();
	const source = value.slice(separator + 1).trim();
	if (!name || !source) throw new TeamError(`Invalid --repo "${value}"`);
	if (source.startsWith("clone:")) return { name, clone: source.slice("clone:".length) };
	if (source.startsWith("link:")) return { name, link: source.slice("link:".length) };
	return { name, link: source };
}

function parseEngineer(value: string): { name: string; pm: string; repo: string; execution?: "normal" | "vibe" } {
	const parts = value.split(":").map(part => part.trim());
	if (parts.length < 3 || parts.length > 4) {
		throw new TeamError(`--engineer must be <name>:<pm>:<repo>[:normal|vibe]; got "${value}"`);
	}
	const [name, pm, repo, execution] = parts;
	if (!name || !pm || !repo) throw new TeamError(`Invalid --engineer "${value}"`);
	if (execution !== undefined && execution !== "normal" && execution !== "vibe") {
		throw new TeamError(`--engineer execution must be normal or vibe; got "${execution}"`);
	}
	return { name, pm, repo, ...(execution ? { execution } : {}) };
}

function parseRoom(value: string): BootstrapRoomInput {
	const separator = value.indexOf("=");
	if (separator < 0) return { name: value.trim() };
	const name = value.slice(0, separator).trim();
	const spec = value.slice(separator + 1).trim();
	if (!name) throw new TeamError(`Invalid --room "${value}"`);
	if (spec === "shared" || spec === "coordination") return { name, shared: true, kind: "coordination" };
	if (spec.startsWith("pm:")) return { name, kind: "pm", pm: spec.slice("pm:".length) };
	throw new TeamError(`--room must be <name>, <name>=shared, or <name>=pm:<pm>; got "${value}"`);
}

function buildInput(options: BootstrapCommandOptions): BootstrapInput {
	const pms = (options.pms ?? []).map(name => ({ name: name.trim() })).filter(pm => pm.name.length > 0);
	const repos = (options.repos ?? []).map(parseRepo);
	const binds = (options.binds ?? []).map(value => {
		const separator = value.indexOf(":");
		if (separator < 0) throw new TeamError(`--bind must be <repo>:<pm>; got "${value}"`);
		return { repo: value.slice(0, separator).trim(), pm: value.slice(separator + 1).trim() };
	});
	for (const bind of binds) {
		const repo = repos.find(entry => entry.name === bind.repo);
		if (!repo) throw new TeamError(`--bind names unknown repo "${bind.repo}"`);
		repo.bindPms = [...(repo.bindPms ?? []), bind.pm];
	}
	return {
		name: options.name?.trim() ?? "",
		root: options.root?.trim() ?? "",
		...(options.displayName ? { displayName: options.displayName } : {}),
		pms,
		repos,
		engineers: (options.engineers ?? []).map(parseEngineer),
		rooms: (options.rooms ?? []).map(parseRoom),
		...(options.engineerOnly ? { engineerOnly: true } : {}),
	};
}

function summary(result: BootstrapResult): string {
	const doctor = result.doctor;
	const lines = [
		`Bootstrap ${result.run.runId}: ${result.run.status} (${result.run.mode}) at ${result.run.rootPath}`,
		...result.steps.map(
			step => `  ${step.seq + 1}. ${step.kind} ${step.status}${step.error ? ` — ${step.error}` : ""}`,
		),
	];
	if (doctor) {
		const errors = doctor.checks.filter(check => !check.ok && check.level === "error");
		const warnings = doctor.checks.filter(check => !check.ok && check.level === "warning");
		lines.push(
			`  doctor: ${errors.length === 0 ? "healthy" : `${errors.length} error(s)`}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
		);
		for (const error of errors) lines.push(`  FAIL ${error.id}: ${error.detail}`);
	}
	return lines.join("\n");
}

/**
 * Execute one shared init-team command. Errors are thrown for CLI exit codes;
 * the caller maps them to output. A non-`done` run is also an error so callers
 * never report a compensated/failed bootstrap as success.
 */
export async function runInitTeamCommand(options: BootstrapCommandOptions): Promise<BootstrapCommandOutput> {
	const dbPath = options.dbPath ?? resolveTeamDbPath();
	if (options.rollback) {
		const result = await rollbackBootstrapRun(options.rollback, { dbPath });
		const text = [
			`Rollback ${result.run.runId}: ${result.run.status}`,
			...result.steps.map(
				step => `  ${step.seq + 1}. ${step.kind} ${step.status}${step.error ? ` — ${step.error}` : ""}`,
			),
			...(result.errors.length > 0 ? [`manual recovery: ${result.errors.join("; ")}`] : []),
		].join("\n");
		if (result.errors.length > 0) throw new TeamError(text);
		return { text, rollbackErrors: result.errors };
	}
	if (options.resume) {
		const result = await resumeTeamBootstrap(options.resume, {
			dbPath,
			rollbackOnFailure: !options.noRollback,
		});
		const text = summary(result);
		if (result.run.status !== "done") throw new TeamError(text);
		return { text, result };
	}
	if (!options.root?.trim()) throw new TeamError("Missing --root <path>");
	const plan = await planTeamBootstrap(buildInput(options), { dbPath });
	if (!plan.preflight.ok) {
		throw new TeamError(`Bootstrap preflight failed:\n${plan.preflight.errors.join("\n")}`);
	}
	const result = await applyTeamBootstrap(plan, {
		dbPath,
		rollbackOnFailure: !options.noRollback,
	});
	const text = summary(result);
	if (result.run.status !== "done") throw new TeamError(text);
	return { text, result };
}

/** Parse a slash-command argument string into the same option shape. */
export function parseInitTeamArgs(args: string): BootstrapCommandOptions {
	const options: BootstrapCommandOptions = {};
	const tokens = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!.replace(/^["']|["']$/g, "");
		if (!token.startsWith("--")) continue;
		const flag = token.slice(2);
		const next = tokens[index + 1]?.replace(/^["']|["']$/g, "");
		const value = next !== undefined && !next.startsWith("--") ? (index++, next) : undefined;
		switch (flag) {
			case "name":
				options.name = value;
				break;
			case "root":
				options.root = value;
				break;
			case "display-name":
				options.displayName = value;
				break;
			case "pm":
				options.pms = [...(options.pms ?? []), value ?? ""];
				break;
			case "repo":
				options.repos = [...(options.repos ?? []), value ?? ""];
				break;
			case "bind":
				options.binds = [...(options.binds ?? []), value ?? ""];
				break;
			case "engineer":
				options.engineers = [...(options.engineers ?? []), value ?? ""];
				break;
			case "room":
				options.rooms = [...(options.rooms ?? []), value ?? ""];
				break;
			case "engineer-only":
				options.engineerOnly = true;
				break;
			case "no-rollback":
				options.noRollback = true;
				break;
			case "resume":
				options.resume = value;
				break;
			case "rollback":
				options.rollback = value;
				break;
			case "json":
				options.json = true;
				break;
			default:
				throw new TeamError(`Unknown /initzetateam option --${flag}`);
		}
	}
	return options;
}
