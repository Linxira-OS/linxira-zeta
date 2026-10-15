/**
 * Shell-tool host-process guard.
 *
 * The bash tool runs model-authored commands inside the host's own process
 * tree. Careless process management reaches the agent's own ancestry — the
 * shell running the command, the terminal/console the user is talking through,
 * the `bun`/`node` host, the agent process itself — and takes the user's
 * session and unsent work with it. On Windows the usual shapes are
 * `Get-Process <name> | Stop-Process`, `Stop-Process -Name …`, `taskkill /IM …`
 * and recency sweeps keyed on `StartTime`; on POSIX they are `pkill -f …`,
 * `killall`, `kill -1`/`kill 0`.
 *
 * This module refuses those commands before they run, and nothing else:
 *
 * - **Unscoped kills are refused.** A name, pattern, pipeline or process-group
 *   target cannot be proven safe: whatever matches at that moment dies,
 *   including the chain above. There is no undo, so the guard does not defer to
 *   the model's judgement at the moment of the sweep.
 * - **The agent's own chain is refused.** The pids of the agent and its
 *   enumerable ancestors are collected at call time; a kill that names one of
 *   them is refused even when it looks scoped.
 * - **A recorded spawn is allowed.** `spawn → capture $! / $proc.Id → stop that`
 *   is the accepted idiom and passes: a kill scoped to a pid this command
 *   captured (`$!`, a variable assigned from `$!`, a `Start-Process … -PassThru`
 *   handle) or to an explicit numeric id outside the agent's chain is not
 *   blocked by any blanket rule.
 * - **Refusals explain themselves.** The message names the target, why the reach
 *   is unsafe, and the safe alternative, so the model repairs the command in one
 *   step instead of hunting for a workaround.
 *
 * Hard refusal, with no model-reachable escape hatch: a settings key or tool
 * parameter could be flipped by the very agent the guard constrains (it writes
 * settings files), which would make the guard decorative. The user turns it off
 * from outside, in the environment the agent was started with —
 * `ZETA_HOST_PROCESS_GUARD=off`, read from the agent's own process environment
 * (so a tool call, a plugin, or a child shell's `export` cannot reach it) —
 * never from inside a command.
 *
 * Platform: the kill-verb grammar is enforced everywhere (a Windows agent drives
 * git-bash, a Linux agent drives `pwsh`), while ancestry is enumerated per
 * platform — native handles when present, `/proc` on Linux, `ps` elsewhere,
 * CIM/PowerShell on Windows — narrowing to `process.pid` + `process.ppid` when
 * nothing else answers. The guard never throws and never blocks a command it
 * could not classify as a kill.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { lexShellCommand } from "./shell-tokenize";

/** Environment variable the user sets to `off` to disable the guard. */
export const HOST_PROCESS_GUARD_ENV = "ZETA_HOST_PROCESS_GUARD";

/**
 * How the agent's process chain was enumerated. `native`/`procfs`/`ps`/`cim` are
 * full-walk sources; `self` means only `process.pid` + `process.ppid` were
 * available, so ancestry protection is correspondingly narrow.
 */
export type HostProcessChainSource = "native" | "procfs" | "ps" | "cim" | "self";

/** Processes that must never be killed: the agent and its enumerable ancestors. */
export interface HostProcessChain {
	/** Pids of the agent process and every ancestor found, nearest first. */
	pids: readonly number[];
	/** `pid → image name` (`bun.exe`, `pwsh.exe`, …) for the same pids. */
	names: ReadonlyMap<number, string>;
	/** Enumeration source. */
	source: HostProcessChainSource;
}

/** Why a command was refused. */
export type HostProcessGuardKind =
	/** Name/pattern/pipeline/group sweep: the match set cannot be proven safe. */
	| "sweep"
	/** The command names a pid in the agent's own process chain. */
	| "host"
	/** A computed or unknown target the guard cannot resolve to a safe pid. */
	| "unverifiable";

export interface HostProcessGuardRefusal {
	kind: HostProcessGuardKind;
	/** Verb carrying the kill, spelled as the command wrote it (`Stop-Process`, `kill`, `pkill`, …). */
	verb: string;
	/** Subject line of the refusal message. */
	subject: string;
	/** Why the reach is unsafe, one sentence. */
	why: string;
}

export interface HostProcessGuardVerdict {
	/** True when the command must not run. */
	block: boolean;
	/** Model-facing refusal text (present when `block`). */
	message?: string;
	/** Structured refusal (present when `block`). */
	refusal?: HostProcessGuardRefusal;
}

/** Verbs that can end a process. Used as a whole-command pre-filter before any parsing. */
const KILL_VERB_RE =
	/\b(?:stop-process|spps|taskkill|pkill|killall|pskill|tskill|kill|wmic|invoke-cimmethod)\b|\.kill\b/i;

/** Shell/tool wrappers whose following word is the real command. */
const COMMAND_WRAPPERS: Record<string, true> = {
	sudo: true,
	doas: true,
	nohup: true,
	setsid: true,
	command: true,
	exec: true,
	env: true,
	time: true,
	nice: true,
	ionice: true,
	chrt: true,
	stdbuf: true,
	timeout: true,
	xargs: true,
	watch: true,
	parallel: true,
};

/** Wrapper options that consume the following word, so its value is not mistaken for the command. */
const WRAPPER_OPTIONS_WITH_VALUE: Record<string, true> = {
	"-u": true,
	"-g": true,
	"-p": true,
	"-c": true,
	"-n": true,
	"-o": true,
	"-e": true,
	"-i": true,
	"-s": true,
	"-S": true,
	"-P": true,
	"-T": true,
	"-E": true,
	"--user": true,
	"--group": true,
	"--signal": true,
	"--command": true,
	"--max-args": true,
	"--replace": true,
	"--arg-file": true,
};

/** Verbs whose arguments are text or patterns, so a `kill`-shaped argument is not a command. */
const TEXT_VERBS: Record<string, true> = {
	echo: true,
	printf: true,
	"write-output": true,
	"write-host": true,
	"write-debug": true,
	"write-information": true,
	cat: true,
	tee: true,
	grep: true,
	rg: true,
	sed: true,
	awk: true,
};

/** Verbs that enter another process namespace: a kill inside them cannot reach this host. */
const NAMESPACE_VERBS: Record<string, true> = {
	docker: true,
	podman: true,
	nerdctl: true,
	kubectl: true,
	oc: true,
};

/** Shells whose `-c`/`-Command` argument carries another command line. */
const SHELL_VERBS: Record<string, true> = {
	sh: true,
	bash: true,
	dash: true,
	ash: true,
	ksh: true,
	zsh: true,
	pwsh: true,
	powershell: true,
	cmd: true,
	"cmd.exe": true,
};

/** Options that hand a nested command line to a shell, or to an expression evaluator. */
const COMMAND_OPTIONS: Record<string, true> = {
	"-c": true,
	"-lc": true,
	"-cl": true,
	"-command": true,
	"-encodedcommand": true,
	"/c": true,
	"/k": true,
};

/** PowerShell parameters that make `kill`/`Stop-Process` a scoped or a sweeping stop. */
const STOP_TARGET_PARAMETERS: Record<string, true> = {
	"-id": true,
	"-name": true,
	"-inputobject": true,
	"-processname": true,
};

/** Kill verbs, by basename. */
const KILL_VERBS: Record<string, true> = {
	kill: true,
	"kill.exe": true,
	pkill: true,
	killall: true,
	"stop-process": true,
	spps: true,
	taskkill: true,
	"taskkill.exe": true,
	pskill: true,
	"pskill.exe": true,
	tskill: true,
	"invoke-cimmethod": true,
	wmic: true,
	"wmic.exe": true,
};

/** The recorded-spawn alternative, quoted in every refusal so the fix is one edit away. */
const SAFE_ALTERNATIVE =
	'record the PID when you spawn it — `$!`, a `Start-Process … -PassThru` handle, or the pid the job reports — and stop only that PID: `kill "$pid"`, `Stop-Process -Id $pid`, `taskkill /PID <pid>`.';

/** Names that always resolve to the shell running this command, which the agent's chain owns. */
const SELF_REFERENCE_NAMES: Record<string, true> = { pid: true, ppid: true, bashpid: true };

const MAX_ANCESTOR_HOPS = 32;
const MAX_NESTED_DEPTH = 3;

/** Whether the user disabled the guard from the environment that started the agent. */
export function isHostProcessGuardDisabled(env: Record<string, string | undefined> = process.env): boolean {
	return (env[HOST_PROCESS_GUARD_ENV] ?? "").trim().toLowerCase() === "off";
}

function basename(word: string): string {
	return word.replace(/^.*[\\/]/u, "").toLowerCase();
}

function isAssignmentWord(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(word) || word === "=";
}

function isOptionWord(word: string): boolean {
	return word.length > 1 && word.startsWith("-") && !/^-\d+$/u.test(word);
}

/** Windows-style switch (`/PID`, `/F`) — a flag, never a target. */
function isSwitchWord(word: string): boolean {
	return /^\/[A-Za-z]+$/u.test(word);
}

/** A redirection (`2>/dev/null`, `>&1`, `<nul`), which the shell consumes before the command sees it. */
function isRedirectionWord(word: string): boolean {
	return /^[0-9&]?[<>]/u.test(word);
}

/** A word that cannot be a target: a flag, a switch, or a redirection. */
function isNonTargetWord(word: string): boolean {
	return isOptionWord(word) || isSwitchWord(word) || isRedirectionWord(word);
}

/** Quoted word without its surrounding quotes. */
function unquote(word: string): string {
	return word.trim().replace(/^["']|["']$/gu, "");
}

/** Variables this command filled from a recorded spawn, so a kill of them is scoped. */
function collectRecordedSpawnVariables(command: string): Set<string> {
	const recorded = new Set<string>();
	// POSIX: `pid=$!`, `pid="$!"`, `pids+=("$!")`.
	for (const match of command.matchAll(/(?:^|[^\w$])([A-Za-z_][A-Za-z0-9_]*)\s*\+?=\s*["'(]{0,2}\$!/gu)) {
		recorded.add(match[1]);
	}
	// PowerShell: `$p = Start-Process x -PassThru`, `$p += (… -PassThru).Id`.
	for (const match of command.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*\+?=(?!=)[^\n;|]*?-passthru\b/giu)) {
		recorded.add(match[1]);
	}
	return recorded;
}

/** True when a target word is a pid this command captured while spawning. */
function looksRecordedReference(value: string, recorded: ReadonlySet<string>): boolean {
	const trimmed = unquote(value);
	if (trimmed === "$!" || trimmed === "!") return true;
	if (/-passthru\b/iu.test(trimmed)) return true;
	const reference = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u.exec(trimmed);
	return reference !== null && recorded.has(reference[1]);
}

/** True for `$$`/`$PID`/`$PPID`: references to the shell running this command. */
function isSelfReference(value: string): boolean {
	const trimmed = unquote(value);
	if (trimmed === "$$") return true;
	const reference = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/u.exec(trimmed);
	return reference !== null && Object.hasOwn(SELF_REFERENCE_NAMES, reference[1].toLowerCase());
}

interface ChainLookup {
	readonly pids: readonly number[];
	readonly names: ReadonlyMap<number, string>;
}

function describePid(pid: number, chain: ChainLookup): string {
	const name = chain.names.get(pid);
	return name ? `pid ${pid} (\`${name}\`)` : `pid ${pid}`;
}

/** Renders the agent's chain as `26660 bun.exe ← 21820 pwsh.exe ← 31436 wt.exe`. */
function describeChain(chain: ChainLookup): string {
	return chain.pids.map(pid => (chain.names.has(pid) ? `${pid} ${chain.names.get(pid)}` : `${pid}`)).join(" ← ");
}

function hostRefusal(verb: string, pid: number, chain: ChainLookup): HostProcessGuardRefusal {
	return {
		kind: "host",
		verb,
		subject: `\`${verb}\` targeting ${describePid(pid, chain)}, part of this agent's own process chain`,
		why: `that chain is ${describeChain(chain)} — stopping a member of it kills the agent session or the terminal the user is working in, and their unsent work with it.`,
	};
}

interface AnalyzerContext {
	chain: ChainLookup;
	recorded: ReadonlySet<string>;
	/** The command captured a `-PassThru` handle somewhere, so a paren-built target is a recorded spawn. */
	hasPassThru: boolean;
}

/**
 * `$proc.Kill()` / `(Get-Process x).Kill()`: a .NET handle kill, allowed only on
 * a handle this command captured (`-PassThru`) rather than on a sweep's output.
 */
function analyzeMethodKill(
	spelled: string,
	receiver: string,
	context: AnalyzerContext,
): HostProcessGuardRefusal | null {
	const target = unquote(receiver);
	if (target.length === 0) {
		return context.hasPassThru ? null : unverifiableRefusal(spelled, "the handle built by the preceding expression");
	}
	if (looksRecordedReference(target, context.recorded)) return null;
	return unverifiableRefusal(spelled, `\`${target}\``);
}

/** Moves past wrappers, their options and environment assignments to the word that actually runs. */
function commandWordIndex(words: readonly string[]): number {
	let index = 0;
	while (index < words.length && (isAssignmentWord(words[index]) || words[index] === "$")) index++;
	for (let hops = 0; hops < 6 && index < words.length; hops++) {
		if (!Object.hasOwn(COMMAND_WRAPPERS, basename(words[index]))) break;
		index++;
		while (index < words.length) {
			const word = words[index];
			if (isOptionWord(word)) {
				index += Object.hasOwn(WRAPPER_OPTIONS_WITH_VALUE, word.toLowerCase()) ? 2 : 1;
				continue;
			}
			// Wrapper operands that are not the command: `timeout 5`, `nice 5`, `env VAR=1`.
			if (isAssignmentWord(word) || /^\d+(?:\.\d+)?[smhd]?$/u.test(word)) {
				index++;
				continue;
			}
			break;
		}
	}
	return index;
}

interface SegmentContext {
	/** Segment words, quotes and escapes removed. */
	words: string[];
	/** Segment text as written, used in refusal subjects. */
	text: string;
	/** True when this segment consumes the previous stage's stdout. */
	pipedStdin: boolean;
}

/**
 * Splits a command line into segments, keeping the words and whether the
 * segment consumes piped stdin — the flat-segment extractor bails on brace
 * blocks (`Where-Object { … }`), which is exactly the incident's shape.
 */
function shellCommandSegments(command: string): SegmentContext[] {
	const segments: SegmentContext[] = [];
	let words: string[] = [];
	let text = "";
	let pipedStdin = false;
	const flush = (): void => {
		if (words.length === 0) return;
		segments.push({ words, text: text.trim(), pipedStdin });
		words = [];
		text = "";
	};
	for (const token of lexShellCommand(command)) {
		if (token.kind === "word") {
			if (token.value.length === 0) continue;
			words.push(token.value);
			text = text.length === 0 ? token.raw : `${text} ${token.raw}`;
			continue;
		}
		// Whitespace keeps the segment going; an operator ends it.
		const operator = token.raw.trim();
		if (operator.length === 0) continue;
		flush();
		pipedStdin = operator === "|" || operator === "|&";
	}
	flush();
	return segments;
}

/** Kill verbs, plus `.Kill()` handle calls, plus shells and `iex` that carry a nested command line. */
function isInvocationCandidate(word: string): boolean {
	const name = basename(word);
	return isKillVerbWord(word) || Object.hasOwn(SHELL_VERBS, name) || name === "iex" || name === "invoke-expression";
}

/** A kill verb or a `.Kill()` handle call. */
function isKillVerbWord(word: string): boolean {
	return Object.hasOwn(KILL_VERBS, basename(word)) || /\.kill$/iu.test(word);
}

function analyzeSegment(
	words: readonly string[],
	segment: SegmentContext,
	context: AnalyzerContext,
	depth: number,
): HostProcessGuardRefusal | null {
	const start = commandWordIndex(words);
	if (start >= words.length) return null;
	const name = basename(words[start]);
	if (Object.hasOwn(TEXT_VERBS, name) || Object.hasOwn(NAMESPACE_VERBS, name)) return null;

	const candidates: number[] = [];
	if (isInvocationCandidate(words[start])) {
		candidates.push(start);
	} else {
		// `find … -exec kill …`, plus wrapper values the walker skipped: a kill verb is a
		// command only directly after a wrapper, `-exec`, or `--`.
		for (let index = start + 1; index < words.length; index++) {
			if (!isKillVerbWord(words[index])) continue;
			const previous = words[index - 1] ?? "";
			// A `.Kill()` handle call is a kill wherever it appears; a bare verb is one only
			// directly after a wrapper, `-exec`, or `--`.
			if (
				/\.kill$/iu.test(words[index]) ||
				Object.hasOwn(COMMAND_WRAPPERS, basename(previous)) ||
				previous === "-exec" ||
				previous === "-execdir" ||
				previous === "--"
			) {
				candidates.push(index);
			}
		}
		if (candidates.length === 0) return null;
	}

	for (const index of candidates) {
		const refusal = analyzeInvocation(words, index, segment, context, depth);
		if (refusal) return refusal;
	}
	return null;
}

function analyzeInvocation(
	words: readonly string[],
	index: number,
	segment: SegmentContext,
	context: AnalyzerContext,
	depth: number,
): HostProcessGuardRefusal | null {
	const name = basename(words[index]);
	const args = words.slice(index + 1);

	const methodReceiver = /^(.*)\.kill$/iu.exec(words[index])?.[1];
	if (methodReceiver !== undefined) return analyzeMethodKill(words[index], methodReceiver, context);

	if (depth < MAX_NESTED_DEPTH) {
		// A nested command line (`bash -c '…'`, `pwsh -Command '…'`, `iex '…'`) carries its own kill verbs.
		const nested = nestedCommandText(name, args);
		if (nested !== null) {
			const refusal = analyzeCommandText(nested, context, depth + 1);
			if (refusal) return refusal;
		}
		if (Object.hasOwn(SHELL_VERBS, name) || name === "iex" || name === "invoke-expression") return null;
	}

	if (name === "wmic" || name === "wmic.exe") return analyzeWmic(args, context, segment);
	if (name === "invoke-cimmethod") return analyzeCimTerminate(args, context, segment);
	if (name === "pkill")
		return sweepRefusal("pkill", args.join(" "), segment, "a name/pattern match over every running process");
	if (name === "killall")
		return sweepRefusal("killall", args.join(" "), segment, "a name match over every running process");
	if (name === "tskill") return analyzeNameOrPid("tskill", args, context, segment);
	if (name === "pskill" || name === "pskill.exe") return analyzeNameOrPid(name, args, context, segment);
	if (name === "taskkill" || name === "taskkill.exe") return analyzeTaskkill(args, context, segment);
	if (name === "stop-process" || name === "spps") return analyzeStopProcess("Stop-Process", args, context, segment);
	return analyzeKill(args, context, segment);
}

/** The nested command line a shell/reinterpret option carries, when this segment has one. */
function nestedCommandText(name: string, args: readonly string[]): string | null {
	if (!Object.hasOwn(SHELL_VERBS, name) && name !== "iex" && name !== "invoke-expression") return null;
	if (name === "iex" || name === "invoke-expression") {
		const text = args.join(" ").trim();
		return text.length > 0 ? text : null;
	}
	for (let index = 0; index < args.length; index++) {
		if (!Object.hasOwn(COMMAND_OPTIONS, args[index].toLowerCase())) continue;
		const text = args[index + 1];
		if (text !== undefined && text.length > 0) return text;
	}
	return null;
}

function sweepRefusal(verb: string, target: string, segment: SegmentContext, reach: string): HostProcessGuardRefusal {
	const trimmed = target.trim();
	const spelled = trimmed.length > 0 ? `\`${verb} ${trimmed}\`` : `\`${verb}\``;
	const sweepSource = segment.pipedStdin ? "the pipeline feeding it" : "whatever matches at that moment";
	return {
		kind: "sweep",
		verb,
		subject: `${spelled} — ${reach}`,
		why: `${sweepSource} decides what dies: the shell running this command, the terminal the user is typing in, this agent process and the user's unrelated processes all share those names, and there is no undo.`,
	};
}

function unverifiableRefusal(verb: string, target: string): HostProcessGuardRefusal {
	return {
		kind: "unverifiable",
		verb,
		subject: `\`${verb}\` targeting ${target}, which the guard cannot resolve to a pid it can prove safe`,
		why: "a target the guard cannot resolve may be the shell running this command, the terminal the user is in, or this agent, and a wrong guess ends the session.",
	};
}

/** Numeric pid literal, with quotes stripped; `null` for anything else. */
function numericPid(word: string): number | null {
	const trimmed = unquote(word);
	return /^\d+$/u.test(trimmed) ? Number(trimmed) : null;
}

/** Resolves one explicit target: a safe pid, a refusal, or nothing to report. */
function resolveExplicitTarget(verb: string, word: string, context: AnalyzerContext): HostProcessGuardRefusal | null {
	const trimmed = unquote(word);
	// PowerShell pid lists (`Stop-Process -Id 4321,8765`) resolve element by element.
	if (trimmed.includes(",") && !/[^\d,\s]/u.test(trimmed)) {
		for (const part of trimmed.split(",")) {
			const refusal = resolveExplicitTarget(verb, part, context);
			if (refusal) return refusal;
		}
		return null;
	}
	const pid = numericPid(trimmed);
	if (pid !== null) return context.chain.pids.includes(pid) ? hostRefusal(verb, pid, context.chain) : null;
	// A variable this command filled from a recorded spawn wins over the
	// `$pid`/`$PPID` automatic names: `pid=$!; kill "$pid"` is the accepted idiom.
	if (looksRecordedReference(trimmed, context.recorded)) return null;
	if (isSelfReference(trimmed)) {
		return {
			kind: "host",
			verb,
			subject: `\`${verb}\` targeting \`${trimmed}\`, the shell this command is running in`,
			why: `that shell is the agent's own child (${describeChain(context.chain)}), so stopping it kills the command you are running.`,
		};
	}
	if (looksRecordedReference(trimmed, context.recorded)) return null;
	if (context.hasPassThru) return null;
	// A command substitution tokenizes into its own fragments (`$(pgrep bun)` → `$`),
	// so name the construct rather than the fragment.
	const described =
		trimmed === "$" || trimmed === "`" || trimmed.startsWith("$(") || trimmed.startsWith("`")
			? "a command substitution"
			: `\`${trimmed}\``;
	return unverifiableRefusal(verb, described);
}

/** `Stop-Process` / `spps`: only an explicit, resolvable `-Id` or `-InputObject` is scoped. */
function analyzeStopProcess(
	verb: string,
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	if (args.some(word => ["-name", "-processname"].includes(word.toLowerCase()))) {
		const named = valueAfter(args, word => ["-name", "-processname"].includes(word.toLowerCase()));
		return sweepRefusal(verb, `-Name ${named ?? "<name>"}`, segment, "a name match over every running process");
	}

	const idValues = collectParameterValues(args, word => word.toLowerCase() === "-id");
	if (idValues !== null) {
		if (idValues.length === 0) return context.hasPassThru ? null : unverifiableRefusal(verb, "`-Id <expression>`");
		for (const value of idValues) {
			const refusal = resolveExplicitTarget(verb, value, context);
			if (refusal) return refusal;
		}
		return null;
	}

	const inputObjectValues = collectParameterValues(args, word => word.toLowerCase() === "-inputobject");
	if (inputObjectValues !== null) {
		if (inputObjectValues.length === 0) return unverifiableRefusal(verb, "`-InputObject <pipeline>`");
		for (const value of inputObjectValues) {
			const refusal = resolveExplicitTarget(verb, value, context);
			if (refusal) return refusal;
		}
		return null;
	}

	return sweepRefusal(verb, args.join(" "), segment, "no explicit `-Id`/`-InputObject` target");
}

/** Values following a parameter, up to the next parameter; `null` when the parameter is absent. */
function collectParameterValues(args: readonly string[], matches: (word: string) => boolean): string[] | null {
	for (let index = 0; index < args.length; index++) {
		if (!matches(args[index])) continue;
		const values: string[] = [];
		for (let next = index + 1; next < args.length; next++) {
			if (isNonTargetWord(args[next])) break;
			values.push(args[next]);
		}
		return values;
	}
	return null;
}

function valueAfter(args: readonly string[], matches: (word: string) => boolean): string | undefined {
	return collectParameterValues(args, matches)?.[0];
}

/** `taskkill`: `/IM` is a name sweep, `/PID` is scoped, anything else carries no target. */
function analyzeTaskkill(
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	if (args.some(word => /^[-/]im$/iu.test(word))) {
		return sweepRefusal("taskkill", args.join(" "), segment, "a `/IM` image-name match over every running process");
	}
	const pidValues = collectParameterValues(args, word => /^[-/]pid$/iu.test(word));
	if (pidValues === null) return sweepRefusal("taskkill", args.join(" "), segment, "no explicit `/PID` target");
	if (pidValues.length === 0) return unverifiableRefusal("taskkill", "`-PID <expression>`");
	for (const value of pidValues) {
		const refusal = resolveExplicitTarget("taskkill", value, context);
		if (refusal) return refusal;
	}
	return null;
}

/** `pskill`/`tskill`: `1234` is scoped, a name is a sweep. */
function analyzeNameOrPid(
	verb: string,
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	const targets = args.filter(word => !isNonTargetWord(word));
	if (targets.length === 0) return sweepRefusal(verb, args.join(" "), segment, "no explicit target");
	for (const target of targets) {
		if (numericPid(target) === null && !looksRecordedReference(target, context.recorded)) {
			return sweepRefusal(verb, args.join(" "), segment, "a name match over every running process");
		}
		const refusal = resolveExplicitTarget(verb, target, context);
		if (refusal) return refusal;
	}
	return null;
}

interface KillArguments {
	/** True for the `kill -0` liveness probe, which stops nothing. */
	probe: boolean;
	/** True for `kill -l`, which lists signal names. */
	listing: boolean;
	operands: string[];
}

function parseKillArguments(args: readonly string[]): KillArguments {
	const parsed: KillArguments = { probe: false, listing: false, operands: [] };
	let signalSeen = false;
	const valueOptions: Record<string, true> = { "-s": true, "-n": true, "--signal": true, "--queue": true };
	for (let index = 0; index < args.length; index++) {
		const word = args[index];
		if (word === "--") {
			parsed.operands.push(...args.slice(index + 1));
			break;
		}
		if (isRedirectionWord(word) || isSwitchWord(word)) continue;
		if (/^-\d+$/u.test(word)) {
			// In option position `-9`/`-0` is a signal; after one, `-1` addresses a process group.
			if (!signalSeen && !parsed.listing) {
				signalSeen = true;
				if (word === "-0") parsed.probe = true;
			} else {
				parsed.operands.push(word);
			}
			continue;
		}
		if (word === "-l" || word === "-L" || word === "--list") {
			parsed.listing = true;
			continue;
		}
		if (Object.hasOwn(valueOptions, word.toLowerCase())) {
			signalSeen = true;
			if (args[index + 1] === "0") parsed.probe = true;
			index++;
			continue;
		}
		if (isOptionWord(word)) {
			signalSeen = true;
			continue;
		}
		parsed.operands.push(word);
	}
	return parsed;
}

/** `kill`: the POSIX builtin, git-bash `kill.exe`, or the PowerShell alias for `Stop-Process`. */
function analyzeKill(
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	if (args.some(word => Object.hasOwn(STOP_TARGET_PARAMETERS, word.toLowerCase()))) {
		// PowerShell routes `kill` to `Stop-Process`; its parameter grammar decides.
		return analyzeStopProcess("kill", args, context, segment);
	}
	const parsed = parseKillArguments(args);
	if (parsed.probe) return null;
	if (parsed.operands.length === 0) {
		if (parsed.listing) return null;
		return args.length === 0
			? sweepRefusal("kill", "", segment, "no explicit target")
			: unverifiableRefusal("kill", `\`${args.join(" ")}\``);
	}
	for (const operand of parsed.operands) {
		const trimmed = unquote(operand);
		if (/^-\d+$/u.test(trimmed)) {
			return sweepRefusal(
				"kill",
				args.join(" "),
				segment,
				`a negative pid (\`${trimmed}\`), which addresses a whole process group`,
			);
		}
		if (trimmed === "0") {
			return sweepRefusal("kill", args.join(" "), segment, "pid `0`, this command's whole process group");
		}
		if (trimmed.startsWith("%")) return unverifiableRefusal("kill", `a job spec (\`${trimmed}\`)`);
		const refusal = resolveExplicitTarget("kill", trimmed, context);
		if (refusal) return refusal;
	}
	return null;
}

/**
 * `Get-CimInstance Win32_Process | Invoke-CimMethod -MethodName Terminate`: the
 * same reach as `Stop-Process`, so the same rule — an explicit, resolvable
 * handle or pid is scoped, a class-wide `Terminate` is a sweep.
 */
function analyzeCimTerminate(
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	const method = valueAfter(args, word => word.toLowerCase() === "-methodname");
	if (method === undefined || method.toLowerCase() !== "terminate") return null;
	const handles = collectParameterValues(args, word => word.toLowerCase() === "-inputobject");
	if (handles === null || handles.length === 0) {
		return sweepRefusal(
			"Invoke-CimMethod -MethodName Terminate",
			"",
			segment,
			"a class-wide `Terminate` over every matched process",
		);
	}
	for (const handle of handles) {
		const refusal = resolveExplicitTarget("Invoke-CimMethod -MethodName Terminate", handle, context);
		if (refusal) return refusal;
	}
	return null;
}

/** `wmic process … delete` / `wmic process … call terminate`. */
function analyzeWmic(
	args: readonly string[],
	context: AnalyzerContext,
	segment: SegmentContext,
): HostProcessGuardRefusal | null {
	const lower = args.map(word => word.toLowerCase());
	if (!lower.some(word => word === "delete" || word === "terminate")) return null;
	const spelledPid = args.map(word => /processid\s*=\s*(\d+)/iu.exec(word)?.[1]).find(value => value !== undefined);
	const processIndex = lower.indexOf("process");
	const positional = args[processIndex + 1];
	const pidText = spelledPid ?? (positional !== undefined && numericPid(positional) !== null ? positional : undefined);
	if (pidText === undefined) {
		const tail = args.slice(processIndex + 1).join(" ");
		return sweepRefusal("wmic process", tail, segment, "a `where` sweep over every running process");
	}
	return resolveExplicitTarget("wmic process", pidText, context);
}

/** Analyzes one command line, recursing into nested shells. */
function analyzeCommandText(command: string, context: AnalyzerContext, depth: number): HostProcessGuardRefusal | null {
	for (const segment of shellCommandSegments(command)) {
		const refusal = analyzeSegment(segment.words, segment, context, depth);
		if (refusal) return refusal;
	}
	return null;
}

function formatRefusal(refusal: HostProcessGuardRefusal): string {
	return [
		`Refused by the host-process guard: ${refusal.subject}.`,
		`Why: ${refusal.why}`,
		`Safe alternative: ${SAFE_ALTERNATIVE}`,
	].join("\n");
}

/**
 * Whether `command` may run, decided against an already-collected process chain.
 *
 * Pure and synchronous so the refusal contract is testable against a fixed
 * chain; {@link checkHostProcessCommands} owns enumeration and the switch.
 */
export function evaluateHostProcessCommand(
	command: string,
	chain: HostProcessChain,
	options: { recordedVariables?: ReadonlySet<string> } = {},
): HostProcessGuardVerdict {
	if (!KILL_VERB_RE.test(command)) return { block: false };
	const context: AnalyzerContext = {
		chain: { pids: chain.pids, names: chain.names },
		recorded: options.recordedVariables ?? collectRecordedSpawnVariables(command),
		hasPassThru: /-passthru\b/iu.test(command),
	};
	const refusal = analyzeCommandText(command, context, 0);
	if (!refusal) return { block: false };
	return { block: true, message: formatRefusal(refusal), refusal };
}

let chainPromise: Promise<HostProcessChain> | null = null;

/** Test-only: forget the memoized chain so a fresh enumeration runs. */
export function __resetHostProcessChainCacheForTests(): void {
	chainPromise = null;
}

/**
 * Collect the agent process and its ancestors, nearest first.
 *
 * Memoized for the process lifetime: the agent's ancestry is fixed when it
 * starts, and this runs only for commands that mention a kill verb.
 */
export async function collectHostProcessChain(): Promise<HostProcessChain> {
	chainPromise ??= enumerateHostProcessChain();
	return chainPromise;
}

async function enumerateHostProcessChain(): Promise<HostProcessChain> {
	const pids: number[] = [process.pid];
	const names = new Map<number, string>();
	names.set(process.pid, basename(process.execPath));
	if (process.ppid > 0 && process.ppid !== process.pid) pids.push(process.ppid);

	if (await walkNativeChain(pids, names)) return { pids, names, source: "native" };
	if (walkProcfsChain(pids, names)) return { pids, names, source: "procfs" };
	const snapshot = await walkSnapshotChain(pids, names);
	if (snapshot !== null) return { pids, names, source: snapshot };
	return { pids, names, source: "self" };
}

/** Native handles (`pi-natives`) expose `ppid` and the image path on every supported platform. */
async function walkNativeChain(pids: number[], names: Map<number, string>): Promise<boolean> {
	try {
		// Dynamic on purpose: the addon is absent on some hosts (PI_TEST_NO_NATIVES,
		// unbuilt platform leaves) and importing it eagerly would load a 190MB
		// native library for every command that never mentions a kill.
		const natives = await import("@linxiraos/pi-natives");
		let current = natives.Process.fromPid(process.pid);
		for (let hops = 0; current && hops < MAX_ANCESTOR_HOPS; hops++) {
			const pid = current.pid;
			const image = current.args()[0];
			if (image && !names.has(pid)) names.set(pid, basename(image));
			const parent = current.ppid;
			if (parent === null || parent <= 0 || parent === pid || pids.includes(parent)) break;
			pids.push(parent);
			current = natives.Process.fromPid(parent);
		}
		return pids.length > 1;
	} catch {
		return false;
	}
}

/** Linux fallback: `/proc/<pid>/stat` field 4 is the parent pid. */
function walkProcfsChain(pids: number[], names: Map<number, string>): boolean {
	if (process.platform !== "linux" && !fs.existsSync("/proc/self/stat")) return false;
	try {
		for (let hops = 0; hops < MAX_ANCESTOR_HOPS; hops++) {
			const pid = pids[pids.length - 1];
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			const fields = stat
				.slice(stat.lastIndexOf(")") + 1)
				.trim()
				.split(/\s+/u);
			const comm = readProcComm(pid);
			if (comm !== null && !names.has(pid)) names.set(pid, comm);
			const parent = Number(fields[1]);
			if (!Number.isInteger(parent) || parent <= 0 || parent === pid || pids.includes(parent)) break;
			pids.push(parent);
		}
		return pids.length > 1;
	} catch {
		return false;
	}
}

function readProcComm(pid: number): string | null {
	try {
		const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
		return comm.length > 0 ? comm : null;
	} catch {
		return null;
	}
}

/** Windows/other fallback: one process snapshot, then walk it. */
async function walkSnapshotChain(pids: number[], names: Map<number, string>): Promise<HostProcessChainSource | null> {
	const rows = process.platform === "win32" ? readWindowsProcessTable() : readProcessTable("ps");
	if (rows === null) return null;
	for (const row of rows) {
		if (row.name.length > 0 && !names.has(row.pid)) names.set(row.pid, row.name);
	}
	const parents = new Map<number, number>();
	for (const row of rows) if (!parents.has(row.pid)) parents.set(row.pid, row.ppid);
	for (let hops = 0; hops < MAX_ANCESTOR_HOPS; hops++) {
		const parent = parents.get(pids[pids.length - 1]);
		if (parent === undefined || parent <= 0 || parent === pids[pids.length - 1] || pids.includes(parent)) break;
		pids.push(parent);
	}
	return pids.length > 1 ? (process.platform === "win32" ? "cim" : "ps") : null;
}

interface ProcessRow {
	pid: number;
	ppid: number;
	name: string;
}

function runSnapshotCommand(argv: readonly string[]): string | null {
	try {
		const result = Bun.spawnSync(argv as string[], { stdout: "pipe", stderr: "ignore", timeout: 5000 });
		return result.exitCode === 0 ? result.stdout.toString("utf8") : null;
	} catch {
		return null;
	}
}

function readWindowsProcessTable(): ProcessRow[] | null {
	const script =
		'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }';
	const flags = ["-NoProfile", "-NonInteractive", "-Command", script];
	const output = runSnapshotCommand(["powershell.exe", ...flags]) ?? runSnapshotCommand(["pwsh.exe", ...flags]);
	if (output === null) return null;
	return parseProcessRows(output, row => row.name.toLowerCase());
}

function readProcessTable(binary: string): ProcessRow[] | null {
	const output = runSnapshotCommand([binary, "-Ao", "pid=,ppid=,comm="]);
	if (output === null) return null;
	return parseProcessRows(output, row => path.basename(row.name).toLowerCase());
}

function parseProcessRows(output: string, normalizeName: (row: ProcessRow) => string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of output.split(/\r?\n/u)) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
		if (!match) continue;
		const row: ProcessRow = { pid: Number(match[1]), ppid: Number(match[2]), name: match[3].trim() };
		rows.push({ ...row, name: normalizeName(row) });
	}
	return rows;
}

/**
 * Whether any of `commands` may run. The guard is off only when the user turned
 * it off in the agent's environment; commands with no kill verb skip
 * enumeration entirely.
 */
export async function checkHostProcessCommands(
	commands: readonly string[],
	env: Record<string, string | undefined> = process.env,
): Promise<HostProcessGuardVerdict> {
	if (isHostProcessGuardDisabled(env)) return { block: false };
	const candidates = commands.filter(command => KILL_VERB_RE.test(command));
	if (candidates.length === 0) return { block: false };
	const chain = await collectHostProcessChain();
	for (const command of candidates) {
		const verdict = evaluateHostProcessCommand(command, chain);
		if (verdict.block) return verdict;
	}
	return { block: false };
}
