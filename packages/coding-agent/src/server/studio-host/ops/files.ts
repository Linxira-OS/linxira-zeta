/**
 * Studio operations — workspace directory creation and session artifacts.
 *
 * Owned operations: `workspace.file.create`, `workspace.directory.create`,
 * `artifacts.list|text.read|saveText|delete` (plus `artifacts.storage.get`,
 * which the host spec classifies C).
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`,
 * `gatewayJson`, `gatewayOk`, `invalid`, `unavailable`). A name this file does
 * not export is simply not advertised in the capability manifest, so leaving
 * an operation out hides its surface in the Renderer — never answer with made
 * up data.
 *
 * Operation → gateway route:
 * - `workspace.directory.create` → `POST /api/fs/directories` (the gateway
 *   creates the folder recursively and returns the absolute path).
 * - `artifacts.list` → `GET /api/sessions/:id/artifacts`, fanned out over the
 *   sessions whose cwd sits inside the requested workspace
 *   (`GET /api/projects` resolves the opaque workspace id, `GET /api/sessions`
 *   enumerates the sessions). The gateway entry now carries `artifactId`,
 *   `kind`, `mimeType`, `bytes`, `createdAt` and `sha256`.
 * - `artifacts.text.read` → `GET /api/sessions/:id/artifacts/:name`, then the
 *   same list route to refresh the record.
 * - `artifacts.saveText` → `PUT /api/sessions/:id/artifacts/:name` with the
 *   text as the raw request body (`RawBody` on the bridge); the route stores
 *   request bytes verbatim, so the file holds the text and not a JSON string.
 * - `artifacts.delete` → `DELETE /api/sessions/:id/artifacts/:name`.
 *
 * Artifact ids are opaque: the gateway's own `artifactId` is the file name,
 * which is only unique inside one session, while the contract hands an
 * `artifactId` back on its own (`text.read`/`delete` carry no session id).
 * This host therefore exposes a reversible, opaque token over
 * `sessionId + name`; the client echoes it unchanged and it is resolved here.
 * Page cursors are likewise opaque (a base64 offset) and are only interpreted
 * by this file.
 *
 * Deliberately omitted — no Zeta route can answer it:
 * - `artifacts.storage.get` — C-class in the host spec: Zeta exposes no
 *   artifact storage location, quota or writability surface.
 *   (`workspace.file.create` and `artifacts.saveText` are owned by
 *   `ops/workspace.ts` and by this file respectively; both need the bridge's
 *   multipart and raw-body modes.)
 *
 * `artifacts.text.read` goes through `callGateway`, which parses a JSON body
 * instead of preserving its bytes; a `.json` artifact is therefore returned in
 * compact serialized form (same values, normalized whitespace). Every other
 * text artifact is returned byte for byte.
 */
import * as path from "node:path";
import { isRecord } from "@linxiraos/pi-utils";
import type { CommandInput, QueryInput, WorkspaceFileMutationResult } from "../contract/index.js";
import { callGateway, gatewayJson, invalid, optionalString, requiredString, segment, unavailable } from "../gateway.js";
import {
	ARTIFACT_KINDS,
	ARTIFACT_TEXT_MAX_BYTES,
	type ArtifactKind,
	type ArtifactPage,
	type ArtifactRecord,
	type ArtifactTextResult,
} from "../protocol/index.js";
import type { StudioFamily } from "../registry.js";
import { resolveWorkspacePath } from "./workspace.js";

const SESSIONS_ROUTE = "/api/sessions";
const DIRECTORIES_ROUTE = "/api/fs/directories";

/** Text artifacts are the extensions `ArtifactTextInput` accepts. */
const TEXT_ARTIFACT_NAME_RE = /\.(?:json|jsonl|txt|md|csv)$/iu;

// ---------------------------------------------------------------------------
// Untrusted JSON helpers
// ---------------------------------------------------------------------------

function stringField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = record[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberField(record: Readonly<Record<string, unknown>>, field: string): number | undefined {
	const value = record[field];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isArtifactKind(value: string): value is ArtifactKind {
	return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** A `local://` name that cannot escape the session artifact root. */
function isSafeArtifactName(name: string): boolean {
	return (
		name !== "" &&
		!name.includes("\u0000") &&
		!name.startsWith("/") &&
		!name.split("/").some(part => part === "" || part === "." || part === "..")
	);
}

// ---------------------------------------------------------------------------
// Artifact ids and page cursors (opaque to the client)
// ---------------------------------------------------------------------------

const ARTIFACT_ID_TAG = "zeta-artifact";
const ARTIFACT_CURSOR_TAG = "zeta-artifact-page";

interface ArtifactAddress {
	readonly sessionId: string;
	readonly name: string;
}

/** Opaque, reversible handle for one session-scoped artifact. */
function artifactIdFor(address: ArtifactAddress): string {
	const payload = `${ARTIFACT_ID_TAG}\u0000${address.sessionId}\u0000${address.name}`;
	return Buffer.from(payload, "utf8").toString("base64url");
}

/** Decode a client-echoed `artifactId`; malformed or foreign ids are client errors. */
function addressOf(input: unknown): ArtifactAddress {
	const artifactId = requiredString(input, "artifactId");
	const decoded = Buffer.from(artifactId, "base64url").toString("utf8");
	const parts = decoded.split("\u0000");
	if (parts.length !== 3 || parts[0] !== ARTIFACT_ID_TAG) {
		throw invalid("artifactId is not a Zeta artifact id");
	}
	const [, sessionId = "", name = ""] = parts;
	if (sessionId === "" || !isSafeArtifactName(name)) {
		throw invalid("artifactId does not address a session artifact");
	}
	return { sessionId, name };
}

function encodeCursor(offset: number): string {
	return Buffer.from(`${ARTIFACT_CURSOR_TAG}\u0000${offset}`, "utf8").toString("base64url");
}

function cursorOffset(cursor: string | undefined): number {
	if (cursor === undefined) return 0;
	const decoded = Buffer.from(cursor, "base64url").toString("utf8");
	const match = /^zeta-artifact-page\u0000(\d+)$/u.exec(decoded);
	if (!match?.[1]) throw invalid("cursor is not a Zeta artifacts page cursor");
	const offset = Number(match[1]);
	if (!Number.isSafeInteger(offset)) throw invalid("cursor is not a Zeta artifacts page cursor");
	return offset;
}

// ---------------------------------------------------------------------------
// Gateway artifact entries
// ---------------------------------------------------------------------------

/** One artifact as the gateway lists it, already narrowed to the Studio fields. */
interface GatewayArtifact {
	readonly kind: ArtifactKind;
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: number;
	readonly createdAt: string;
	readonly sha256: string;
}

function readArtifactEntry(raw: unknown): GatewayArtifact | undefined {
	if (!isRecord(raw)) return undefined;
	const name = stringField(raw, "name");
	const kind = stringField(raw, "kind");
	const mimeType = stringField(raw, "mimeType");
	const createdAt = stringField(raw, "createdAt");
	const sha256 = stringField(raw, "sha256");
	const bytes = numberField(raw, "bytes") ?? numberField(raw, "size");
	if (
		name === undefined ||
		kind === undefined ||
		!isArtifactKind(kind) ||
		mimeType === undefined ||
		createdAt === undefined ||
		sha256 === undefined ||
		bytes === undefined
	) {
		return undefined;
	}
	if (
		!isSafeArtifactName(name) ||
		!/^[a-f0-9]{64}$/u.test(sha256) ||
		Number.isNaN(Date.parse(createdAt)) ||
		!Number.isSafeInteger(bytes) ||
		bytes < 0
	) {
		return undefined;
	}
	return { kind, name, mimeType, bytes, createdAt, sha256 };
}

function collectionPath(sessionId: string): string {
	return `${SESSIONS_ROUTE}/${segment(sessionId)}/artifacts`;
}

function artifactPath(address: ArtifactAddress): string {
	return `${collectionPath(address.sessionId)}/${segment(address.name)}`;
}

/**
 * `GET /api/sessions/:id/artifacts` → every artifact in one session.
 * `null` means the session itself is gone (404); every other non-2xx throws.
 */
async function fetchSessionArtifacts(sessionId: string): Promise<GatewayArtifact[] | null> {
	const route = collectionPath(sessionId);
	const reply = await callGateway(route);
	if (reply.status === 404) return null;
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET ${route} → ${reply.status}`);
	}
	if (!isRecord(reply.body) || !Array.isArray(reply.body.entries)) {
		throw unavailable(`GET ${route} returned an unexpected payload`);
	}
	const entries: GatewayArtifact[] = [];
	for (const raw of reply.body.entries) {
		const entry = readArtifactEntry(raw);
		if (entry === undefined) {
			throw unavailable(`GET ${route} returned an artifact without the Studio record fields`);
		}
		entries.push(entry);
	}
	return entries;
}

function toArtifactRecord(sessionId: string, entry: GatewayArtifact): ArtifactRecord {
	return {
		artifactId: artifactIdFor({ sessionId, name: entry.name }),
		kind: entry.kind,
		name: entry.name,
		mimeType: entry.mimeType,
		bytes: entry.bytes,
		createdAt: entry.createdAt,
		sessionId,
		sha256: entry.sha256,
	};
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

/** True when `candidate` is `root` or sits below it (platform path semantics). */
function isWithinWorkspace(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	if (relative === "") return true;
	if (path.isAbsolute(relative) || relative === "..") return false;
	return !relative.startsWith(`..${path.sep}`);
}

/** Sessions whose working directory sits inside the workspace. */
async function sessionsInWorkspace(workspacePath: string): Promise<string[]> {
	const payload = await gatewayJson<unknown>(SESSIONS_ROUTE);
	if (!isRecord(payload) || !Array.isArray(payload.sessions)) {
		throw unavailable(`${SESSIONS_ROUTE} returned an unexpected payload`);
	}
	const ids: string[] = [];
	for (const raw of payload.sessions) {
		if (!isRecord(raw)) continue;
		const id = stringField(raw, "id");
		const cwd = stringField(raw, "cwd");
		if (id !== undefined && cwd !== undefined && isWithinWorkspace(workspacePath, cwd)) ids.push(id);
	}
	return ids;
}

// ---------------------------------------------------------------------------
// artifacts.list
// ---------------------------------------------------------------------------

interface ScopedArtifact {
	readonly sessionId: string;
	readonly entry: GatewayArtifact;
}

function pageLimit(input: QueryInput<"artifacts.list">): number | undefined {
	const limit = input.limit;
	if (limit === undefined) return undefined;
	if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200) {
		throw invalid("limit must be an integer between 1 and 200");
	}
	return limit;
}

async function collectArtifacts(input: QueryInput<"artifacts.list">): Promise<ScopedArtifact[]> {
	const sessionId = optionalString(input, "sessionId");
	const workspaceId = optionalString(input, "workspaceId");
	if (sessionId !== undefined) {
		const entries = await fetchSessionArtifacts(sessionId);
		if (entries === null) throw invalid(`session ${sessionId} was not found`);
		return entries.map(entry => ({ sessionId, entry }));
	}
	if (workspaceId !== undefined) {
		const workspacePath = await resolveWorkspacePath(requiredString(input, "workspaceId"));
		const collected: ScopedArtifact[] = [];
		for (const id of await sessionsInWorkspace(workspacePath)) {
			const entries = await fetchSessionArtifacts(id);
			// A session deleted between the two listing calls contributes nothing.
			if (entries === null) continue;
			for (const entry of entries) collected.push({ sessionId: id, entry });
		}
		return collected;
	}
	throw invalid("artifacts.list requires a workspaceId or a sessionId");
}

/**
 * `artifacts.list` → session artifact listings, merged newest first.
 *
 * Workspace scope is the renderer's default (it passes the opaque workspace
 * id), while the gateway is session-scoped, so the page is assembled here and
 * paginated with an opaque offset cursor.
 */
async function listArtifacts(input: QueryInput<"artifacts.list">): Promise<ArtifactPage> {
	const kind = optionalString(input, "kind");
	if (kind !== undefined && !isArtifactKind(kind)) throw invalid(`unknown artifact kind: ${kind}`);
	const limit = pageLimit(input);
	const offset = cursorOffset(optionalString(input, "cursor"));

	const items = await collectArtifacts(input);
	const filtered = kind === undefined ? items : items.filter(item => item.entry.kind === kind);
	filtered.sort(
		(left, right) =>
			Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt) ||
			left.entry.name.localeCompare(right.entry.name),
	);

	const window = limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit);
	const consumed = offset + window.length;
	return {
		artifacts: window.map(item => toArtifactRecord(item.sessionId, item.entry)),
		total: filtered.length,
		totalBytes: filtered.reduce((sum, item) => sum + item.entry.bytes, 0),
		...(consumed < filtered.length ? { nextCursor: encodeCursor(consumed) } : {}),
	};
}

// ---------------------------------------------------------------------------
// artifacts.text.read
// ---------------------------------------------------------------------------

async function findArtifact(address: ArtifactAddress): Promise<ArtifactRecord> {
	const entries = await fetchSessionArtifacts(address.sessionId);
	if (entries === null) throw invalid("the artifact's session was not found");
	const entry = entries.find(candidate => candidate.name === address.name);
	if (entry === undefined) throw invalid("artifact not found");
	return toArtifactRecord(address.sessionId, entry);
}

/** `artifacts.text.read` → the artifact's record plus its text content. */
async function readArtifactText(input: QueryInput<"artifacts.text.read">): Promise<ArtifactTextResult> {
	const address = addressOf(input);
	if (!TEXT_ARTIFACT_NAME_RE.test(address.name)) throw invalid("artifact is not a text artifact");

	const artifact = await findArtifact(address);
	if (artifact.bytes > ARTIFACT_TEXT_MAX_BYTES) {
		throw invalid("artifact is too large to read as text");
	}
	const route = artifactPath(address);
	const reply = await callGateway(route);
	if (reply.status === 404) throw invalid("artifact not found");
	if (reply.status === 413) throw invalid("artifact is too large to read as text");
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`GET ${route} → ${reply.status}`);
	}
	const text =
		reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
	return { artifact, text };
}

// ---------------------------------------------------------------------------
// artifacts.delete
// ---------------------------------------------------------------------------

/** `artifacts.delete` → unlink one session artifact after containment checks. */
async function deleteArtifact(input: CommandInput<"artifacts.delete">): Promise<{
	readonly deleted: true;
	readonly artifactId: string;
}> {
	const artifactId = requiredString(input, "artifactId");
	const address = addressOf(input);
	const route = artifactPath(address);
	const reply = await callGateway(route, { method: "DELETE" });
	if (reply.status === 404) throw invalid("artifact not found");
	if (reply.status < 200 || reply.status >= 300) {
		throw unavailable(`DELETE ${route} → ${reply.status}`);
	}
	return { deleted: true, artifactId };
}

// ---------------------------------------------------------------------------
// workspace.directory.create
// ---------------------------------------------------------------------------

/** Normalize a workspace-relative path, refusing anything that can escape it. */
function relativeWorkspacePath(value: string): string {
	if (value.includes("\u0000")) throw invalid("path must not contain NUL");
	const slashed = value.replaceAll("\\", "/");
	if (slashed.startsWith("/") || /^[A-Za-z]:/u.test(slashed)) {
		throw invalid("path must be workspace-relative");
	}
	const segments = slashed.split("/");
	if (segments.some(part => part === "" || part === "." || part === "..")) {
		throw invalid("path must not contain empty or .. segments");
	}
	return segments.join("/");
}

/**
 * `workspace.directory.create` → `POST /api/fs/directories`.
 *
 * The gateway takes an absolute parent plus a folder name and creates the
 * folder recursively; the workspace-relative path stays inside this module and
 * the result echoes the normalized relative path, never the absolute one.
 */
async function createDirectory(
	input: CommandInput<"workspace.directory.create">,
): Promise<WorkspaceFileMutationResult> {
	const workspaceId = requiredString(input, "workspaceId");
	const relative = relativeWorkspacePath(requiredString(input, "path"));
	const root = await resolveWorkspacePath(workspaceId);
	const target = path.join(root, ...relative.split("/"));

	const response = await gatewayJson<unknown>(DIRECTORIES_ROUTE, {
		method: "POST",
		body: { parentPath: path.dirname(target), folderName: path.basename(target) },
	});
	if (!isRecord(response) || response.success !== true) {
		throw unavailable("POST /api/fs/directories did not report success");
	}
	return { applied: true, kind: "directory", path: relative };
}

// ---------------------------------------------------------------------------
// artifacts.saveText
// ---------------------------------------------------------------------------

/** The session a text artifact is written into: the caller's, else the live one. */
async function artifactSessionId(input: unknown): Promise<string> {
	const explicit = optionalString(input, "sessionId");
	if (explicit !== undefined && explicit !== "") return explicit;
	// Imported lazily: `registry.ts` merges the family list that includes this
	// file, so a static import of `session.js` would close the module cycle.
	const { currentSessionId } = await import("./session.js");
	return await currentSessionId();
}

/**
 * `artifacts.saveText` → `PUT /api/sessions/:id/artifacts/:name` with the text
 * as the raw request body.
 *
 * The route stores the request bytes verbatim, so the bridge's `rawBody` sends
 * the text unchanged (a JSON-encoded body would add quotes and escapes to the
 * stored file). The receipt is the record the gateway's own listing reports
 * afterwards: `kind` is derived there from the name, because `local://`
 * artifacts carry no sidecar metadata, and `workspaceId`/`runId` are omitted
 * rather than echoed from the input — the file belongs to a session.
 */
async function saveTextArtifact(input: CommandInput<"artifacts.saveText">): Promise<ArtifactRecord> {
	const name = requiredString(input, "name");
	if (!isSafeArtifactName(name)) throw invalid("name must be one artifact file name");
	if (!TEXT_ARTIFACT_NAME_RE.test(name)) throw invalid("name must end in .json, .jsonl, .txt, .md or .csv");
	const text = input.text;
	if (typeof text !== "string") throw invalid("text must be a string");
	if (text.includes("\u0000")) throw invalid("text must not contain NUL");
	if (Buffer.byteLength(text, "utf8") > ARTIFACT_TEXT_MAX_BYTES) {
		throw invalid("text is too large to save as a text artifact");
	}
	if (!["annotation", "judgment", "benchmark", "transcript", "export"].includes(input.kind)) {
		throw invalid(`unknown text artifact kind: ${String(input.kind)}`);
	}

	const sessionId = await artifactSessionId(input);
	const route = artifactPath({ sessionId, name });
	const reply = await callGateway(route, { method: "PUT", rawBody: text });
	if (reply.status === 404) throw invalid("the artifact's session was not found");
	if (reply.status === 403) throw invalid("name must stay inside the session's artifact root");
	if (reply.status === 413) throw invalid("artifact is too large to save");
	if (reply.status < 200 || reply.status >= 300) throw unavailable(`PUT ${route} → ${reply.status}`);

	const entries = await fetchSessionArtifacts(sessionId);
	const entry = entries?.find(candidate => candidate.name === name);
	if (entry === undefined) throw unavailable(`the gateway did not list the saved artifact ${name}`);
	return toArtifactRecord(sessionId, entry);
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/**
 * Files family: directory/file creation, the artifact reads/deletes the
 * gateway can answer, and the raw-body text write. `artifacts.storage.get`
 * stays unadvertised: Zeta exposes no storage location or quota surface.
 */
export const filesOps: StudioFamily = {
	id: "files",
	queries: {
		"artifacts.list": listArtifacts,
		"artifacts.text.read": readArtifactText,
	},
	commands: {
		"workspace.directory.create": createDirectory,
		"artifacts.saveText": saveTextArtifact,
		"artifacts.delete": deleteArtifact,
	},
};
