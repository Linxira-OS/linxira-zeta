import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, getBaseConfigRoot } from "@linxiraos/pi-utils";

/** Published only in the private serve registration, never in HTTP bootstrap. */
export interface StudioPrivateResources {
	readonly schema: 1;
	readonly mediaDirectory: string;
	readonly socketDirectory: string;
}

let resources: { key: string; promise: Promise<StudioPrivateResources> } | undefined;
export function studioPrivateResources(): Promise<StudioPrivateResources> {
	const mediaDirectory = path.resolve(getAgentDir(), "run", "studio", String(process.pid), "media");
	const socketDirectory =
		process.platform === "win32"
			? path.resolve(getAgentDir(), "run", "studio", String(process.pid), "sockets")
			: path.resolve(getBaseConfigRoot(), "run", "s", String(process.pid));
	const key = JSON.stringify([mediaDirectory, socketDirectory]);
	if (resources?.key === key) return resources.promise;
	const promise = (async (): Promise<StudioPrivateResources> => {
		// Unix-domain socket suffix b-<16 hex>.sock adds 24 bytes including separator.
		if (process.platform !== "win32" && Buffer.byteLength(socketDirectory) + 24 > 103) {
			throw new Error("Studio private socket directory exceeds the platform path limit");
		}
		await Promise.all(
			[mediaDirectory, socketDirectory].map(directory => mkdir(directory, { recursive: true, mode: 0o700 })),
		);
		return { schema: 1, mediaDirectory, socketDirectory };
	})();
	resources = { key, promise };
	void promise.catch(() => {
		if (resources?.promise === promise) resources = undefined;
	});
	return promise;
}
