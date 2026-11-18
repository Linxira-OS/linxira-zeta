/**
 * Installs another app manages: it places `manager.json` with its `name` or
 * `manager` identity two folders above the installed executable. Zeta leaves
 * those installs to their owning app; `zetacode update` reports the manager.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isRecord } from "@linxiraos/pi-utils";

/**
 * Name of the app that manages the executable or engine directory at
 * `installPath`, judged from its real path: the manifest's `name`, else its
 * `manager`. Undefined when none does: no such path, or a missing,
 * unreadable or nameless manifest.
 */
export async function managedInstallName(installPath: string): Promise<string | undefined> {
	let resolved: string;
	try {
		resolved = fs.realpathSync.native(installPath);
	} catch {
		return undefined;
	}
	let manifest: unknown;
	try {
		manifest = await Bun.file(path.join(path.dirname(path.dirname(resolved)), "manager.json")).json();
	} catch {
		return undefined;
	}
	if (!isRecord(manifest)) return undefined;
	const name = typeof manifest.name === "string" && manifest.name ? manifest.name : manifest.manager;
	return typeof name === "string" && name ? name : undefined;
}
