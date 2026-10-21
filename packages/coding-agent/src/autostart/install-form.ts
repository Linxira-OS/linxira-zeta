/**
 * Which form of Zeta is running, decided once and reused by every autostart
 * consumer (the installer refusal, `daemon status`, the GUI's visibility and
 * the docs).
 *
 * `PI_COMPILED=true` is the build-time marker the compiled (bundled) binary
 * carries. Anything else — an npm shim, a `node_modules` install, or a source
 * checkout — is the npm form, which must never install an OS autostart entry.
 * Path heuristics only back the marker up for older bundles built before it
 * existed; they never override a present marker.
 */

import * as path from "node:path";
import { isCompiledBinary } from "@linxiraos/pi-utils";

export type InstallForm = "bundled" | "npm";

export interface DetectInstallFormOptions {
	/** Build-time marker; pass `process.env.PI_COMPILED`. */
	marker?: string | undefined;
	/** Fallback used when the marker and paths are inconclusive. */
	compiled?: boolean;
	execPath?: string;
	argv?: readonly string[];
}

const BUNDLED_EXECUTABLE = /^(?:zetacode|zeta|zetawork)(?:\.exe)?$/i;

/**
 * Resolve the install form. The marker is authoritative when present:
 * `PI_COMPILED=true` means bundled, and any other set value (including
 * `"false"`, as some wrappers export) means npm.
 */
export function detectInstallForm(options: DetectInstallFormOptions = {}): InstallForm {
	const marker = options.marker ?? process.env.PI_COMPILED;
	if (marker !== undefined && marker !== "") return marker === "true" ? "bundled" : "npm";

	const execName = path.basename(options.execPath ?? process.execPath);
	if (BUNDLED_EXECUTABLE.test(execName)) return "bundled";

	const script = (options.argv ?? process.argv)[1];
	if (script && /[\\/]node_modules[\\/]/.test(script)) return "npm";

	return (options.compiled ?? isCompiledBinary()) ? "bundled" : "npm";
}

/** The name of the only install form that may own an OS autostart entry. */
export const BUNDLED_INSTALL_FORM_NAME = "the bundled Zeta desktop app";
