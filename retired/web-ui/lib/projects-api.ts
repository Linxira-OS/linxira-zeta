import type {
	StudioProjectPatch,
	StudioProjectSummary,
	StudioProjectsResponse,
} from "@/components/studio/adapters/types";

/**
 * Project registry client — `/api/projects`.
 *
 * The registry (`~/.zeta/agent/resume-projects.json`) is shared with the
 * terminal resume picker, so registering a project here also lists it there.
 * Nothing is cached: every call returns the whole list, and callers replace
 * their state with it. There is no "本机" pseudo-project and no install-path
 * project — a project exists only because a directory was registered.
 */

async function parseOk<T>(res: Response, fallback: string): Promise<T> {
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `${fallback}: HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export async function fetchProjects(): Promise<StudioProjectsResponse> {
	const res = await fetch("/api/projects", { cache: "no-store" });
	return parseOk(res, "list projects");
}

/** Register a directory, or update its alias / pin / collapse state. */
export async function putProject(patch: StudioProjectPatch): Promise<StudioProjectsResponse> {
	const res = await fetch("/api/projects", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	return parseOk(res, "update project");
}

/** Drop a project from the registry. Its sessions are left on disk. */
export async function unregisterProject(path: string): Promise<StudioProjectsResponse> {
	return putProject({ path, registered: false });
}

/** Cascade-delete every session whose cwd is inside `path`. */
export async function deleteProjectSessions(path: string): Promise<{ deleted: number }> {
	const res = await fetch("/api/projects", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	});
	return parseOk(res, "delete project sessions");
}

/** Project whose workspace list contains `cwd`, else null. */
export function projectForPath(
	projects: readonly StudioProjectSummary[],
	path: string | null,
): StudioProjectSummary | null {
	if (!path) return null;
	const needle = path.replace(/\\/g, "/").toLowerCase();
	return (
		projects.find(project =>
			project.workspaces.some(workspace => workspace.path.replace(/\\/g, "/").toLowerCase() === needle),
		) ?? null
	);
}
