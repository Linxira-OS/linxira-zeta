import * as fs from "node:fs";
import * as path from "node:path";
import {
	extractLiteralAndChainSegments,
	tokenizeShellSegments,
	type LiteralShellCommandSegment,
} from "./shell-tokenize";

/** How a command would destroy or relocate an existing file. */
export type DestructiveOp = "delete" | "truncate" | "overwrite-dd" | "move-source";

/** One file a parsed command is about to destroy, with the content it holds now. */
export interface CapturedFile {
	/** Path as written in the command, resolved against `cwd` for reading. */
	path: string;
	absolutePath: string;
	/** File content immediately before the command runs. */
	prev: string;
	op: DestructiveOp;
}

/** Files larger than this are not captured: the log is a recovery aid, not a backup system. */
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

/** rm flags that consume no value; `-rf`-style clusters are matched by regex instead. */
const RM_BOOLEAN_FLAGS: Record<string, true> = {
	"-r": true,
	"-R": true,
	"--recursive": true,
	"-d": true,
	"--dir": true,
	"--preserve-root": true,
	"--one-file-system": true,
};

/** rm flags that are never targets. */
const RM_VALUE_FLAGS: Record<string, true> = {
	"-f": true,
	"--force": true,
	"-i": true,
	"--interactive": true,
	"-v": true,
	"--verbose": true,
	"-I": true,
};

/** Every regular file under `root`, or just `root` itself when it is a file. */
function filesUnder(root: string, budget: { bytes: number }): { path: string; content: string }[] {
	const captured: { path: string; content: string }[] = [];
	const walk = (current: string): void => {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(current);
		} catch {
			return;
		}
		if (stat.isFile()) {
			// A symlink's own bytes are not what the user would lose; following it
			// would capture the target and attribute the loss to the link.
			if (stat.size > MAX_CAPTURE_BYTES || budget.bytes + stat.size > MAX_CAPTURE_BYTES) return;
			try {
				const content = fs.readFileSync(current, "utf8");
				budget.bytes += stat.size;
				captured.push({ path: current, content });
			} catch {
				// unreadable file: nothing to recover, keep walking
			}
			return;
		}
		if (!stat.isDirectory()) return;
		let names: string[];
		try {
			names = fs.readdirSync(current);
		} catch {
			return;
		}
		for (const name of names) walk(path.join(current, name));
	};
	walk(root);
	return captured;
}

/** `>` and `>>` in a segment's raw text: the path is the first word after them. */
function redirectionTargets(text: string): string[] {
	const targets: string[] = [];
	// A truncating `>` is destructive; `>>` only appends and is not captured.
	// The operator is captured as its own group so the path that follows can
	// carry leading whitespace without becoming part of it.
	const pattern = /(^|[^>])(\>{1,2})([^>]*)/g;
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		if (match[2] !== ">") continue;
		const rest = match[3].trim();
		if (rest === "") continue;
		const first = rest.split(/\s+/)[0];
		if (first === undefined || first.startsWith("&")) continue;
		targets.push(first);
	}
	return targets;
}

/** Files a single parsed segment is about to remove, truncate, overwrite or move. */
export function destructiveTargets(segment: LiteralShellCommandSegment, cwd: string): CapturedFile[] {
	const [command, ...rest] = segment.argv;
	if (command === undefined) return [];
	const found: CapturedFile[] = [];
	const budget = { bytes: 0 };
	const add = (raw: string, op: DestructiveOp): void => {
		if (raw === "" || raw === "-" || raw.startsWith("-")) return; // stdin/stdout and flags
		const absolutePath = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
		// A recursive target names a tree, and the tree is what disappears; the
		// caller sees one CapturedFile per file with its path relative to cwd.
		for (const file of filesUnder(absolutePath, budget)) {
			found.push({
				path: path.relative(cwd, file.path) || raw,
				absolutePath: file.path,
				prev: file.content,
				op,
			});
		}
	};

	switch (command) {
		case "rm": {
			// Only capture when a recursive flag is present: `rm file` on a single
			// regular file is as likely to be the agent cleaning up a temp file as
			// it is the agent destroying work.
			const recursive = rest.some(
				arg => arg.startsWith("-") && (RM_BOOLEAN_FLAGS[arg] === true || /^-[a-zA-Z]*[rR]/.test(arg)),
			);
			if (!recursive) break;
			for (const arg of rest as string[]) {
				if (arg === "--") continue;
				if (arg.startsWith("-") && !arg.startsWith("--")) continue; // clustered rm flags
				if (RM_VALUE_FLAGS[arg] === true || arg.startsWith("--")) continue;
				add(arg, "delete");
			}
			break;
		}
		case "mv":
			// The source disappears; the destination may already exist and be
			// overwritten, so both sides matter.
			for (const arg of rest as string[]) {
				if (arg.startsWith("-")) continue;
				add(arg, "move-source");
			}
			break;
		case "truncate":
			for (const arg of rest as string[]) {
				if (arg.startsWith("-")) continue;
				add(arg, "truncate");
			}
			break;
		case "dd": {
			const of = rest.find(arg => arg.startsWith("of="));
			if (of) add(of.slice(3), "overwrite-dd");
			break;
		}
		default:
			for (const target of redirectionTargets(segment.text)) add(target, "truncate");
			break;
	}
	return found;
}

/**
 * Split a command into the segments worth inspecting.
 *
 * `extractLiteralAndChainSegments` returns null for anything it cannot reduce to
 * plain literal argv — a single command included, since it exists to reason
 * about `a && b` chains. A null result therefore means "not analysable", not
 * "nothing destructive", so the caller is expected to skip rather than treat it
 * as a clean bill of health.
 */
export function segmentsForCapture(command: string): LiteralShellCommandSegment[] {
	const parsed = extractLiteralAndChainSegments(command);
	if (parsed) return parsed;
	// Not a chain (or not analysable at all). Fall back to the whole line as one
	// segment so a plain `rm -rf build` is still inspected — losing that case is
	// exactly the one this module exists to cover.
	const trimmed = command.trim();
	if (trimmed === "") return [];
	return [{ text: trimmed, argv: tokenizeShellSegments(trimmed)[0] ?? [] }];
}

/** Destructive files across every segment of a parsed command, deduplicated by path. */
export function collectDestructiveFiles(
	segments: readonly LiteralShellCommandSegment[] | undefined,
	cwd: string,
): CapturedFile[] {
	if (!segments) return [];
	const byPath = new Map<string, CapturedFile>();
	for (const segment of segments) {
		for (const captured of destructiveTargets(segment, cwd)) {
			// First match wins: it describes the operation that actually runs first.
			if (!byPath.has(captured.absolutePath)) byPath.set(captured.absolutePath, captured);
		}
	}
	return [...byPath.values()];
}
