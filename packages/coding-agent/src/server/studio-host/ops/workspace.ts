/**
 * Studio operations — workspace inventory and the Explorer tree.
 *
 * Owned operations: `projects.list`, `workspace.fileTree` (queries) plus
 * `workspace.open`, `workspace.hide` and `workspace.file.create` (commands).
 *
 * Operation → gateway route:
 * - `projects.list` → `GET /api/projects` (`server/web-gateway/projects.ts`),
 *   flattened from projects → workspaces into one row per `ResumeWorkspace`.
 *   A row with conversations is dated by `lastActivity`; a row with none is
 *   dated by the gateway's `lastOpened` (the persisted last-open preference
 *   inherited from the containing project), so a registered workspace with no
 *   conversations keeps its row and can be the active one.
 * - `workspace.fileTree` → `POST /api/cwd/validate` (register the workspace as
 *   a readable root, exactly what the directory picker does) then
 *   `GET /api/files/<workspace-relative path>?type=list`
 *   (`server/web-gateway/files.ts`); one level per call, as the operation's
 *   contract states.
 * - `workspace.open` → `PUT /api/projects { path }`: register the project root
 *   and stamp its `lastOpened` preference, then read the inventory back from
 *   the same answer. Zeta has no switchable "active workspace" — the gateway
 *   runs one runtime on the process default and only `defaultWorkspaceKey` is
 *   `active` — so this records the operator's open preference and reports the
 *   registry truthfully instead of claiming the runtime moved.
 * - `workspace.hide` → `PUT /api/projects { path, hidden }`: toggles the shared
 *   folder visibility preference. Hiding is reversible metadata; the folder
 *   disappears from the default inventory but its sessions stay on disk, and
 *   the TUI picker reveals it with Show hidden.
 * - `workspace.file.create` → the multipart upload primitive on `/api/files`
 *   (`POST ?type=upload&conflict=error`) carrying one empty file, because no
 *   JSON route creates a file. The root is registered first, and `conflict=error`
 *   refuses to overwrite an existing file.
 *
 * Deliberately omitted — no Zeta route can answer it without inventing state:
 * - `workspace.pick` — the picker *data* routes exist (`/api/cwd/browse`,
 *   `/api/fs/directories`), but the operation carries no folder and no route
 *   opens a native dialog or chooses a directory on the operator's behalf, so
 *   the host cannot name the picked directory.
 *
 * Workspace ids are opaque: Zeta identifies a workspace by its canonical
 * directory key, which is a path, so `WorkspaceId` is a truncated SHA-256 of
 * that key (`ws-<hex>`). It is stable across calls and restarts, and the path,
 * key, root and cwd never leave this module. `name` is Zeta's directory
 * basename (the contract pins the field to a basename), so the user alias in
 * `displayName` is not used here.
 */
import type {
	WorkspaceFileMutationResult,
	WorkspaceFileNode,
	WorkspaceFileTreeReadModel,
	WorkspaceId,
	WorkspaceListReadModel,
	WorkspaceRecord,
} from "../contract/index.js";
import { callGateway, gatewayJson, invalid, optionalString, requiredString, segment, unavailable } from "../gateway.js";
import type { StudioFamily } from "../registry.js";
import { resumePathKey } from "../../../resume/paths.js";
import { resumeWorkspaceIdentity } from "../../../resume/directory.js";
import { workspaceIdFor } from "./workspace-id.js";

const PROJECTS_ROUTE = "/api/projects";
const VALIDATE_CWD_ROUTE = "/api/cwd/validate";

/** One gateway workspace, already reduced to the facts the read models need. */
interface WorkspaceEntry {
	/** Canonical workspace key; path-bearing, never returned. */
	readonly key: string;
	/** Absolute workspace directory; path-bearing, never returned. */
	readonly path: string;
	/** Directory basename. */
	readonly name: string;
	/** Newest activity the gateway could date this workspace by, when any. */
	readonly lastOpenedAt: string | undefined;
}

/** The gateway's workspace inventory plus the key it calls the active one. */
interface ProjectDirectory {
	readonly entries: readonly WorkspaceEntry[];
	readonly defaultKey: string | undefined;
}

/** Narrow untrusted JSON to a plain object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string field, or `undefined`. */
function stringField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** A timestamp string the gateway sent, or `undefined` when absent/unreadable. */
function timestampField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = stringField(record, field);
	return value !== undefined && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** An epoch-milliseconds field the gateway sent, as an ISO timestamp when readable. */
function epochField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = record[field];
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}


/** Absolute path with forward slashes and no trailing separator. */
function slashPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Read one workspace entry. A workspace with conversation history is dated by
 * `lastActivity` (its newest conversation); one with no conversations is dated
 * by `lastOpened`, the last-open preference the gateway derives from the
 * containing project. Only an entry with neither is left undated.
 */
function readWorkspaceEntry(raw: unknown): WorkspaceEntry | undefined {
	if (!isRecord(raw)) return undefined;
	const key = stringField(raw, "key");
	const path = stringField(raw, "path");
	const name = stringField(raw, "name");
	if (key === undefined || path === undefined || name === undefined) return undefined;
	return { key, path, name, lastOpenedAt: timestampField(raw, "lastActivity") ?? epochField(raw, "lastOpened") };
}

/** Narrow a `GET`/`PUT /api/projects` payload into the workspace inventory. */
function parseProjectDirectory(payload: unknown): ProjectDirectory {
	if (!isRecord(payload) || !Array.isArray(payload.projects)) {
		throw unavailable(`${PROJECTS_ROUTE} returned an unexpected payload`);
	}
	const entries: WorkspaceEntry[] = [];
	for (const project of payload.projects) {
		if (!isRecord(project)) continue;
		const workspaces = project.workspaces;
		if (!Array.isArray(workspaces)) continue;
		for (const raw of workspaces) {
			const entry = readWorkspaceEntry(raw);
			if (entry !== undefined) entries.push(entry);
		}
	}
	return { entries, defaultKey: stringField(payload, "defaultWorkspaceKey") };
}

/** `GET /api/projects` → the workspace inventory, narrowed from untrusted JSON. */
async function loadProjectDirectory(includeHidden = false): Promise<ProjectDirectory> {
	return parseProjectDirectory(await gatewayJson<unknown>(PROJECTS_ROUTE, includeHidden ? { query: "includeHidden=true" } : {}));
}

/** The inventory entry one opaque workspace id names, or a client error. */
function requireWorkspace(directory: ProjectDirectory, workspaceId: string): WorkspaceEntry {
	const entry = directory.entries.find(candidate => workspaceIdFor(candidate.key) === workspaceId);
	if (entry === undefined) throw invalid(`unknown workspace: ${workspaceId}`);
	return entry;
}

/** Keep undated workspaces; `active` continues to name the Host default. */
function toWorkspaceList(directory: ProjectDirectory): WorkspaceListReadModel {
	const workspaces: WorkspaceRecord[] = directory.entries.map(entry => ({
		workspaceId: workspaceIdFor(entry.key),
		name: entry.name,
		lastOpenedAt: entry.lastOpenedAt ?? null,
		active: entry.key === directory.defaultKey,
	}));
	workspaces.sort((left, right) =>
		(right.lastOpenedAt === null ? -Infinity : Date.parse(right.lastOpenedAt))
		- (left.lastOpenedAt === null ? -Infinity : Date.parse(left.lastOpenedAt))
		|| left.name.localeCompare(right.name),
	);
	const defaultWorkspaceId = directory.defaultKey === undefined ? undefined : workspaceIdFor(directory.defaultKey);
	return {
		workspaces,
		...(defaultWorkspaceId === undefined ? {} : { defaultWorkspaceId }),
		...(workspaces.some(workspace => workspace.active) && defaultWorkspaceId !== undefined
			? { activeWorkspaceId: defaultWorkspaceId } : {}),
	};
}

/**
 * Workspace-relative segment list from the operation's `path` input. Absolute
 * paths, drive letters and `..` are rejected: the read model only ever carries
 * workspace-relative paths, and a caller must not be able to point the listing
 * outside its workspace.
 */
function workspaceRelativeSegments(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
	if (normalized === "") return [];
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
		throw invalid("path must be relative to the workspace");
	}
	const segments = normalized.split("/").filter(part => part !== "");
	if (segments.some(part => part === "." || part === "..")) {
		throw invalid("path must stay inside the workspace");
	}
	return segments;
}

/** `/api/files/<encoded absolute path>` — one segment per call, so `/` and `:` survive. */
function filesRoute(absolute: string): string {
	return `/api/files/${absolute
		.split("/")
		.map(part => segment(part))
		.join("/")}`;
}

/** One entry of the gateway's directory listing. */
interface FileEntry {
	readonly name: string;
	readonly isDir: boolean;
}

/** Narrow the gateway's `{ entries: [...] }` listing. */
function readFileEntries(payload: unknown): FileEntry[] {
	if (!isRecord(payload) || !Array.isArray(payload.entries)) {
		throw unavailable("GET /api/files returned an unexpected payload");
	}
	const entries: FileEntry[] = [];
	for (const raw of payload.entries) {
		if (!isRecord(raw)) continue;
		const name = stringField(raw, "name");
		if (name === undefined || typeof raw.isDir !== "boolean") continue;
		entries.push({ name, isDir: raw.isDir });
	}
	return entries;
}

/** Directory-first, name-sorted Explorer nodes rooted at `base` (a relative path). */
function toFileNodes(entries: readonly FileEntry[], base: string): WorkspaceFileNode[] {
	const nodes: WorkspaceFileNode[] = entries.map(entry => ({
		type: entry.isDir ? "dir" : "file",
		name: entry.name,
		path: base === "" ? entry.name : `${base}/${entry.name}`,
	}));
	return nodes.sort((left, right) => {
		if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
		return left.name.localeCompare(right.name);
	});
}

/** `projects.list` handler → `GET /api/projects`. */
async function listProjects(): Promise<WorkspaceListReadModel> {
	return toWorkspaceList(await loadProjectDirectory());
}

/**
 * Path-free display name per Studio `WorkspaceId`, for read models that group
 * by workspace without exposing the inventory itself.
 */
export async function readWorkspaceNames(): Promise<ReadonlyMap<WorkspaceId, string>> {
	const directory = await loadProjectDirectory(true);
	return new Map(directory.entries.map(entry => [workspaceIdFor(entry.key), entry.name]));
}

/** Resolve a canonical session cwd to its real gateway workspace row. */
export async function readWorkspaceIdentities(cwds: readonly string[] = []): Promise<ReadonlyMap<string, { workspaceId: WorkspaceId; workspaceName: string }>> {
	const directory = await loadProjectDirectory(true);
	const identities = new Map(directory.entries.map(entry => [resumePathKey(entry.path), {
		workspaceId: workspaceIdFor(entry.key), workspaceName: entry.name,
	}]));
	// Archived-only cwds are not in the live inventory. Reuse the gateway's
	// workspace identity rule (not its project-root grouping) for those rows.
	for (const cwd of cwds) {
		const { key, name } = resumeWorkspaceIdentity(cwd);
		if (key && !identities.has(key)) identities.set(key, { workspaceId: workspaceIdFor(key), workspaceName: name });
	}
	return identities;
}

/** Hidden folders can still own an open session; paths never cross the wire. */
export async function resolveWorkspacePath(workspaceId: string): Promise<string> {
	return requireWorkspace(await loadProjectDirectory(true), workspaceId).path;
}

/**
 * `workspace.fileTree` handler → `POST /api/cwd/validate` (root only) then
 * `GET /api/files/<path>?type=list`.
 *
 * The root listing first registers the workspace with the gateway's own
 * picker route: the gateway only reads directories under its allowed roots
 * (session cwds, project roots, the default workspace, and directories the
 * operator chose in this process), and expanding a registered project in the
 * Explorer is that choice. One level is returned per call; the Renderer
 * attaches the children itself.
 */
async function listFileTree(input: unknown): Promise<WorkspaceFileTreeReadModel> {
	// Validated at runtime, then branded: the transport hands the input over as JSON.
	const workspaceId = requiredString(input, "workspaceId") as WorkspaceId;
	const segments = workspaceRelativeSegments(optionalString(input, "path"));
	const directory = await loadProjectDirectory(true);
	const entry = directory.entries.find(candidate => workspaceIdFor(candidate.key) === workspaceId);
	if (entry === undefined) throw invalid(`unknown workspace: ${workspaceId}`);

	if (segments.length === 0) {
		const registered = await callGateway(VALIDATE_CWD_ROUTE, { method: "POST", body: { cwd: entry.path } });
		if (registered.status < 200 || registered.status >= 300) {
			throw unavailable(`workspace is not readable: ${VALIDATE_CWD_ROUTE} → ${registered.status}`);
		}
	}

	const base = segments.join("/");
	const target = [slashPath(entry.path), ...segments].join("/");
	const reply = await callGateway(filesRoute(target), { query: "type=list" });
	if (reply.status === 400) throw invalid(`not a directory: ${base}`);
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`cannot list workspace directory ${base || "."}: GET /api/files → ${reply.status}`);
	}
	return { workspaceId, nodes: toFileNodes(readFileEntries(reply.body), base) };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `workspace.open` → `PUT /api/projects {path}`.
 *
 * Zeta has no switchable active workspace: the gateway runs one runtime on the
 * process default, and `defaultWorkspaceKey` alone is reported as `active`.
 * `PUT /api/projects` registers the project root and stamps its `lastOpened`
 * preference — the registry's own record of opening a folder. The receipt is
 * the inventory re-read from that answer, so the row moves to the top and
 * `active` keeps naming the gateway's real default instead of echoing the
 * caller's choice.
 */
async function openWorkspace(input: unknown): Promise<WorkspaceListReadModel> {
	const workspaceId = requiredString(input, "workspaceId");
	const entry = requireWorkspace(await loadProjectDirectory(true), workspaceId);
	const reply = await callGateway(PROJECTS_ROUTE, { method: "PUT", body: { path: entry.path } });
	if (reply.status === 400 || reply.status === 404) {
		throw invalid(`cannot open workspace ${workspaceId}: the gateway rejected its directory`);
	}
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`PUT ${PROJECTS_ROUTE} → ${reply.status}`);
	}
	return toWorkspaceList(parseProjectDirectory(reply.body));
}

/**
 * `workspace.hide` → `PUT /api/projects { path, hidden }`.
 *
 * The renderer only knows the opaque workspace id, so the host resolves it
 * back to the registry path. The gateway reads the same preference file as the
 * TUI resume picker; this is metadata, never a registry removal or a delete.
 */
async function hideWorkspace(input: unknown): Promise<WorkspaceListReadModel> {
	const workspaceId = requiredString(input, "workspaceId");
	const hidden =
		typeof (input as { hidden?: unknown }).hidden === "boolean" ? (input as { hidden: boolean }).hidden : true;
	const entry = requireWorkspace(await loadProjectDirectory(true), workspaceId);
	const reply = await callGateway(PROJECTS_ROUTE, { method: "PUT", body: { path: entry.path, hidden } });
	if (reply.status === 400 || reply.status === 404) {
		throw invalid(`cannot hide workspace ${workspaceId}: the gateway rejected its directory`);
	}
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`PUT ${PROJECTS_ROUTE} → ${reply.status}`);
	}
	return toWorkspaceList(parseProjectDirectory(reply.body));
}

/**
 * `workspace.file.create` → `POST /api/files/<parent>?type=upload&conflict=error`.
 *
 * The gateway's only create primitive is the multipart upload, so an empty file
 * is uploaded under the requested name; `conflict=error` is the route's default
 * and keeps an existing file untouched. The root is registered first through
 * `POST /api/cwd/validate` — the same call the Explorer's first expand makes —
 * because `/api/files` only writes under allowed roots.
 */
async function createFile(input: unknown): Promise<WorkspaceFileMutationResult> {
	const workspaceId = requiredString(input, "workspaceId");
	const segments = workspaceRelativeSegments(requiredString(input, "path"));
	if (segments.length === 0) throw invalid("path must name a file inside the workspace");
	const name = segments[segments.length - 1] as string;
	const parentSegments = segments.slice(0, -1);
	const relative = segments.join("/");
	const entry = requireWorkspace(await loadProjectDirectory(true), workspaceId);

	const registered = await callGateway(VALIDATE_CWD_ROUTE, { method: "POST", body: { cwd: entry.path } });
	if (registered.status < 200 || registered.status >= 300) {
		throw unavailable(`workspace is not readable: ${VALIDATE_CWD_ROUTE} → ${registered.status}`);
	}

	const form = new FormData();
	form.append("files", new File([], name, { type: "application/octet-stream" }));
	const parent = [slashPath(entry.path), ...parentSegments].join("/");
	const reply = await callGateway(filesRoute(parent), {
		method: "POST",
		query: "type=upload&conflict=error",
		formData: form,
	});
	const parentRelative = parentSegments.length === 0 ? "." : parentSegments.join("/");
	if (reply.status === 404) throw invalid(`directory not found: ${parentRelative}`);
	if (reply.status === 409) throw invalid(`a file already exists at ${relative}`);
	if (reply.status === 403) throw unavailable(`workspace is not writable: ${workspaceId}`);
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`POST /api/files → ${reply.status}`);
	}
	const uploaded = isRecord(reply.body) && Array.isArray(reply.body.uploaded) ? reply.body.uploaded : [];
	if (!uploaded.includes(name)) {
		throw unavailable(`POST /api/files did not report creating ${relative}`);
	}
	return { applied: true, kind: "file", path: relative };
}

/** Workspace family: the inventory read, the Explorer tree, and the two writes. */
export const workspaceOps: StudioFamily = {
	id: "workspace",
	queries: {
		"projects.list": listProjects,
		"workspace.fileTree": listFileTree,
	},
	commands: {
		"workspace.open": openWorkspace,
		"workspace.hide": hideWorkspace,
		"workspace.file.create": createFile,
	},
};
