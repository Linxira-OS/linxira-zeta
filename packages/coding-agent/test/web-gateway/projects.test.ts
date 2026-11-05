/**
 * /api/projects contract — the shell's project registry.
 *
 * The registry is shared with the terminal resume picker (`resume-projects.json`
 * under the agent dir), so these routes must:
 * - list a registered project back with its canonical root,
 * - refuse a directory that does not exist,
 * - keep registration, alias clearing and pinning independent,
 * - drop a project from the registry on `{ registered: false }` while leaving
 *   the default workspace project unremovable,
 * - keep the cascade session delete on DELETE.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { webGatewayFetch } from "../../src/server/web-gateway";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"] as const;
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];
let agentDir = "";
let projectDir = "";

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-projects-"));
	projectDir = await mkdtemp(join(tmpdir(), "zeta-gw-payload-"));
	cleanups.push(() =>
		// The gateway opens `history.db` under the agent dir; on Windows that
		// handle can outlive the test by a few ticks, so retry and then leave the
		// temp dir behind rather than failing a passing assertion.
		rm(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(() => undefined),
	);
	cleanups.push(() => rm(projectDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	refreshDirsFromEnv();
});

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const value = savedEnv.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function call(path: string, init?: RequestInit): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${path}`, init), "127.0.0.1");
}

function put(body: unknown): Promise<Response> {
	return call("/api/projects", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

interface ProjectsResponse {
	projects: Array<{
		path: string;
		displayName: string;
		alias: string | null;
		pinned: boolean;
		collapsed: boolean;
		removable: boolean;
		workspaces: Array<{ path: string; displayName: string }>;
	}>;
	defaultProjectKey: string;
	defaultWorkspaceKey: string;
}

async function readProjects(): Promise<ProjectsResponse> {
	const response = await call("/api/projects");
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectsResponse;
}

/**
 * The registry key is the canonical project identity: `resumePathKey` lowercases
 * it on Windows, where the filesystem is case-insensitive anyway.
 */
function canonicalPath(value: string): string {
	return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function findProject(body: ProjectsResponse, dir: string) {
	const wanted = canonicalPath(dir);
	return body.projects.find(project => canonicalPath(project.path) === wanted);
}

describe("/api/projects", () => {
	test("registers a directory and lists it back", async () => {
		const response = await put({ path: projectDir });
		expect(response.status).toBe(200);
		const body = (await response.json()) as ProjectsResponse;
		const registered = findProject(body, projectDir);
		expect(registered).toBeDefined();
		expect(registered?.displayName).toBe(registered?.displayName.length ? registered.displayName : "missing");
	});

	test("rejects a directory that does not exist", async () => {
		const response = await put({ path: join(projectDir, "not-there") });
		expect(response.status).toBe(400);
	});

	test("rejects a body without a path", async () => {
		const response = await put({ alias: "x" });
		expect(response.status).toBe(400);
	});

	test("alias, pin and collapse are stored independently and survive a reload", async () => {
		await put({ path: projectDir });
		await put({ path: projectDir, alias: "zeta", pinned: true });

		const body = await readProjects();
		const project = findProject(body, projectDir);
		expect(project?.alias).toBe("zeta");
		expect(project?.pinned).toBe(true);

		await put({ path: projectDir, collapsed: true });
		const reloaded = await readProjects();
		const again = findProject(reloaded, projectDir);
		expect(again?.collapsed).toBe(true);
		expect(again?.alias).toBe("zeta");
		expect(again?.pinned).toBe(true);
	});

	test("a null alias clears the alias but keeps the registry entry", async () => {
		await put({ path: projectDir, alias: "temporary" });
		await put({ path: projectDir, alias: null });
		const body = await readProjects();
		const project = findProject(body, projectDir);
		expect(project).toBeDefined();
		expect(project?.alias).toBeNull();
	});

	test("registered: false drops the project from the registry", async () => {
		await put({ path: projectDir });
		const removed = await put({ path: projectDir, registered: false });
		expect(removed.status).toBe(200);
		const body = (await removed.json()) as ProjectsResponse;
		expect(findProject(body, projectDir)).toBeUndefined();
	});

	test("the registry persists to resume-projects.json under the agent dir", async () => {
		await put({ path: projectDir, alias: "kept" });
		const raw = await readFile(join(agentDir, "resume-projects.json"), "utf8");
		const parsed = JSON.parse(raw) as { projects: Record<string, { registered?: boolean; alias?: string }> };
		const entry = Object.values(parsed.projects).find(value => value.alias === "kept");
		expect(entry?.registered).toBe(true);
	});

	test("DELETE still means cascade session delete, not registry removal", async () => {
		await put({ path: projectDir });
		const response = await call("/api/projects", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: projectDir }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { deleted: number };
		expect(body.deleted).toBe(0);
		const still = await readProjects();
		expect(findProject(still, projectDir)).toBeDefined();
	});
});
