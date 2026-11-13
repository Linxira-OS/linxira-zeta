/**
 * Pure remote-probe contract: the marker-framed shell probe and its parser.
 *
 * Kept free of relative imports so `node --test` can type-strip this module
 * directly; `ssh.ts` owns the process transport around it.
 */

export type ProbePlatform = "win32" | "darwin" | "linux";

export interface ProbeResult {
	readonly platform: ProbePlatform;
	readonly arch: string;
	/** Path the remote executable resolved to, `zetacode` preferred over compat `zeta`. */
	readonly zetaPath: string | null;
	/** Which executable that path is, or null when none resolved. */
	readonly binary: "zetacode" | "zeta" | null;
	/** First line of `<binary> --version`, or null when unavailable. */
	readonly version: string | null;
	readonly raw: string;
}

/**
 * Remote probe: OS/arch plus the first executable of `zetacode` (the shipped
 * Linux/CLI name) then legacy `zeta`, with its `--version` line. `zetacode`
 * must win: release installs place `/usr/bin/zetacode` and `/usr/bin/zetaide`
 * but no `zeta`, so a `command -v zeta`-only probe missed every release install.
 */
export const REMOTE_PROBE_COMMAND =
	"printf '__ZETA_PROBE__\\n'; uname -s 2>/dev/null || echo unknown; uname -m 2>/dev/null || echo unknown; " +
	'for b in zetacode zeta; do p=$(command -v "$b" 2>/dev/null) || continue; ' +
	'printf \'__ZETA_BIN__%s\\n\' "$p"; v=$("$b" --version 2>/dev/null | head -n 1); ' +
	"printf '__ZETA_VERSION__%s\\n' \"$v\"; break; done";

/** Platform id from a remote `uname -s` / `uname -o` answer. */
export function platformFromProbe(system: string): ProbePlatform {
	const value = system.toLowerCase();
	if (value.includes("darwin") || value.includes("mac")) return "darwin";
	if (value.includes("mingw") || value.includes("msys") || value.includes("cygwin") || value.includes("windows"))
		return "win32";
	return "linux";
}

/** Parse the marker-framed probe output; tolerates an unmarked legacy body. */
export function parseProbeOutput(raw: string): Omit<ProbeResult, "raw"> {
	const lines = raw
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line !== "");
	const start = lines.indexOf("__ZETA_PROBE__");
	const body = start >= 0 ? lines.slice(start + 1) : lines;
	const binaryLine = body.find(line => line.startsWith("__ZETA_BIN__"));
	const versionLine = body.find(line => line.startsWith("__ZETA_VERSION__"));
	const plain = body.filter(line => !line.startsWith("__ZETA_"));
	const system = plain[0] ?? "unknown";
	const arch = plain[1] ?? "unknown";
	let zetaPath: string | null = null;
	if (binaryLine) {
		zetaPath = binaryLine.slice("__ZETA_BIN__".length).trim() || null;
	} else {
		zetaPath =
			plain.slice(2).find(line => line.includes("/") || line.endsWith("zeta") || line.endsWith("zeta.exe")) ?? null;
	}
	const base =
		zetaPath === null
			? ""
			: (zetaPath
					.replace(/\\/g, "/")
					.split("/")
					.at(-1)
					?.replace(/\.exe$/i, "") ?? "");
	const binary: ProbeResult["binary"] = base === "zetacode" ? "zetacode" : zetaPath === null ? null : "zeta";
	const version = versionLine?.slice("__ZETA_VERSION__".length).trim() || null;
	return { platform: platformFromProbe(system), arch, zetaPath, binary, version };
}
