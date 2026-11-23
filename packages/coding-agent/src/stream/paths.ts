import * as path from "node:path";
import { ipcEndpoint } from "@linxiraos/pi-natives";
import { getDaemonDir } from "@linxiraos/pi-utils";
import { canonicalProjectDir } from "../launch/paths";

/**
 * Resolve the local IPC endpoint `zetacode stream` listens on for one project
 * directory. Shares the daemon broker's canonical-cwd hashing so every zetacode
 * process in the same directory agrees on the endpoint.
 */
export async function streamSocketEndpoint(projectDir: string): Promise<string> {
	const key = Bun.hash
		.wyhash(await canonicalProjectDir(projectDir))
		.toString(16)
		.padStart(16, "0");
	return ipcEndpoint(path.join(getDaemonDir(), "streams", key), "stream");
}
