/**
 * Shared fixture for the workspace/file gateway routes.
 *
 * Every test runs against a throwaway agent dir, default workspace and roots
 * under the OS temp dir, then restores the environment and drops the module
 * caches. Nothing here reads or writes the real home directory.
 */

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { invalidateAllowedFileRoots } from "../../src/server/web-gateway/file-roots";
import { invalidateFileIndexCache } from "../../src/server/web-gateway/file-index";
import { invalidateSessionListCache } from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR", "ZETA_DEFAULT_WORKSPACE"] as const;

export interface FileRouteFixture {
	agentDir: string;
	workspace: string;
	/** Browsable root the tests register through `allowFileRoot`. */
	root: string;
	/** Sibling root that stays outside every allowed root. */
	outside: string;
	cleanup(): Promise<void>;
}

export async function createFileRouteFixture(prefix: string): Promise<FileRouteFixture> {
	const base = await mkdtemp(join(tmpdir(), prefix));
	const agentDir = join(base, "agent");
	const workspace = join(base, "workspace");
	const root = join(base, "root");
	const outside = join(base, "outside");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(root, { recursive: true }),
		mkdir(outside, { recursive: true }),
	]);

	const saved = ENV_KEYS.map(key => [key, process.env[key]] as const);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	process.env.ZETA_DEFAULT_WORKSPACE = workspace;
	refreshDirsFromEnv();
	invalidateSessionListCache();
	invalidateAllowedFileRoots();
	invalidateFileIndexCache();

	return {
		agentDir,
		workspace,
		root,
		outside,
		async cleanup() {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			refreshDirsFromEnv();
			invalidateSessionListCache();
			invalidateAllowedFileRoots();
			invalidateFileIndexCache();
			await rm(base, { recursive: true, force: true });
		},
	};
}

/**
 * `/api/files/<segments>` URL for an absolute path. Each path segment is
 * percent-encoded, exactly as the renderer builds it (the Windows drive
 * segment travels as `C%3A`).
 */
export function fileRouteUrl(absolutePath: string, search = ""): string {
	const segments = absolutePath
		.split(/[\\/]+/)
		.filter(Boolean)
		.map(segment => encodeURIComponent(segment))
		.join("/");
	return `http://gateway.local/api/files/${segments}${search}`;
}

/** Absolute `/api/...` URL with an encoded query string. */
export function gatewayUrl(pathname: string, query: Record<string, string> = {}): string {
	const url = new URL(pathname, "http://gateway.local");
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
	return url.toString();
}

/** Seed a discoverable session whose cwd is `cwd`, so roots derive from it. */
export async function seedSessionForCwd(cwd: string): Promise<void> {
	const id = randomUUID();
	const dir = SessionManager.getDefaultSessionDir(cwd);
	await mkdir(dir, { recursive: true });
	const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd };
	await writeFile(join(dir, `${id}.jsonl`), `${JSON.stringify(header)}\n`, "utf8");
	invalidateSessionListCache();
}
