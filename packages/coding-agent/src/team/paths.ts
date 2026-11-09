/**
 * Team path model: ownerless team root marker, PM workspace marker, and the
 * upward resolver that turns any cwd inside a team (repository, linked
 * worktree, PM workspace) into `{ teamRoot, teamId, pmId? }`.
 *
 * Layout (locked):
 *
 *   <team>/.zeta/team.json                       ownerless container marker
 *   <team>/pms/<pm>/.zeta/pm.json                PM workspace marker
 *   <team>/repos/<repo>/                         canonical base repository
 *   <team>/worktrees/<repo>/<pm>/<engineer>/home/
 *   <team>/worktrees/<repo>/<pm>/<engineer>/<task>/
 *
 * A repository that lives outside the team root (registered with
 * `team repo link`) carries `<repo>/.zeta/team-member.json` as an offline
 * breadcrumb; it is a discovery hint only, the database is authoritative.
 */

import { isEnoent } from "@linxiraos/pi-utils";
import { isRecord } from "@linxiraos/pi-utils/type-guards";
import * as fs from "node:fs";
import * as path from "node:path";
import { TeamError } from "./errors";

/** Current marker schema version. Bump only with a compatible reader. */
export const TEAM_SCHEMA_VERSION = 1;

export const TEAM_MARKER_FILE = path.join(".zeta", "team.json");
export const PM_MARKER_FILE = path.join(".zeta", "pm.json");
export const TEAM_MEMBER_MARKER_FILE = path.join(".zeta", "team-member.json");

export interface TeamMarker {
	schemaVersion: number;
	kind: "team";
	teamId: string;
	name: string;
}

export interface PmMarker {
	schemaVersion: number;
	kind: "pm";
	teamId: string;
	pmId: string;
	name: string;
}

export interface TeamMemberMarker {
	schemaVersion: number;
	kind: "team-member";
	teamId: string;
	repoName: string;
	teamRoot: string;
}

/** Everything the resolver can prove about the current working tree. */
export interface TeamLocation {
	teamRoot: string;
	teamId: string;
	teamName: string;
	pmId?: string;
	pmRoot?: string;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/** Read JSON, returning `undefined` when the file is absent. */
async function readJsonIfPresent(file: string): Promise<unknown | undefined> {
	try {
		return await Bun.file(file).json();
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

/** {@link readJsonIfPresent}, for the session-creation path that cannot await. */
function readJsonSyncIfPresent(file: string): unknown | undefined {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
	return JSON.parse(text) as unknown;
}

/** Parse and validate a team marker; throws with the offending path. */
export function parseTeamMarker(value: unknown, file: string): TeamMarker {
	if (!isRecord(value)) throw new TeamError(`Invalid team marker (expected an object): ${file}`);
	if (value.kind !== "team") throw new TeamError(`Invalid team marker (kind != "team"): ${file}`);
	if (value.schemaVersion !== TEAM_SCHEMA_VERSION) {
		throw new TeamError(
			`Unsupported team marker schemaVersion ${String(value.schemaVersion)} (expected ${TEAM_SCHEMA_VERSION}): ${file}`,
		);
	}
	if (!isNonEmptyString(value.teamId)) throw new TeamError(`Invalid team marker (missing teamId): ${file}`);
	if (!isNonEmptyString(value.name)) throw new TeamError(`Invalid team marker (missing name): ${file}`);
	return { schemaVersion: TEAM_SCHEMA_VERSION, kind: "team", teamId: value.teamId, name: value.name };
}

/** Parse and validate a PM workspace marker; throws with the offending path. */
export function parsePmMarker(value: unknown, file: string): PmMarker {
	if (!isRecord(value)) throw new TeamError(`Invalid PM marker (expected an object): ${file}`);
	if (value.kind !== "pm") throw new TeamError(`Invalid PM marker (kind != "pm"): ${file}`);
	if (value.schemaVersion !== TEAM_SCHEMA_VERSION) {
		throw new TeamError(
			`Unsupported PM marker schemaVersion ${String(value.schemaVersion)} (expected ${TEAM_SCHEMA_VERSION}): ${file}`,
		);
	}
	if (!isNonEmptyString(value.teamId)) throw new TeamError(`Invalid PM marker (missing teamId): ${file}`);
	if (!isNonEmptyString(value.pmId)) throw new TeamError(`Invalid PM marker (missing pmId): ${file}`);
	if (!isNonEmptyString(value.name)) throw new TeamError(`Invalid PM marker (missing name): ${file}`);
	return {
		schemaVersion: TEAM_SCHEMA_VERSION,
		kind: "pm",
		teamId: value.teamId,
		pmId: value.pmId,
		name: value.name,
	};
}

/** Parse an external-repository breadcrumb; throws with the offending path. */
export function parseTeamMemberMarker(value: unknown, file: string): TeamMemberMarker {
	if (!isRecord(value)) throw new TeamError(`Invalid team-member marker (expected an object): ${file}`);
	if (value.kind !== "team-member") {
		throw new TeamError(`Invalid team-member marker (kind != "team-member"): ${file}`);
	}
	if (value.schemaVersion !== TEAM_SCHEMA_VERSION) {
		throw new TeamError(
			`Unsupported team-member marker schemaVersion ${String(value.schemaVersion)} (expected ${TEAM_SCHEMA_VERSION}): ${file}`,
		);
	}
	if (!isNonEmptyString(value.teamId)) throw new TeamError(`Invalid team-member marker (missing teamId): ${file}`);
	if (!isNonEmptyString(value.repoName)) {
		throw new TeamError(`Invalid team-member marker (missing repoName): ${file}`);
	}
	if (!isNonEmptyString(value.teamRoot)) throw new TeamError(`Invalid team-member marker (missing teamRoot): ${file}`);
	return {
		schemaVersion: TEAM_SCHEMA_VERSION,
		kind: "team-member",
		teamId: value.teamId,
		repoName: value.repoName,
		teamRoot: value.teamRoot,
	};
}

export function teamMarkerPath(teamRoot: string): string {
	return path.join(teamRoot, TEAM_MARKER_FILE);
}

export function pmMarkerPath(pmRoot: string): string {
	return path.join(pmRoot, PM_MARKER_FILE);
}

export function teamMemberMarkerPath(repoRoot: string): string {
	return path.join(repoRoot, TEAM_MEMBER_MARKER_FILE);
}

export function pmsRoot(teamRoot: string): string {
	return path.join(teamRoot, "pms");
}

export function reposRoot(teamRoot: string): string {
	return path.join(teamRoot, "repos");
}

export function worktreesRoot(teamRoot: string): string {
	return path.join(teamRoot, "worktrees");
}

export function pmWorkspacePath(teamRoot: string, pmId: string): string {
	return path.join(pmsRoot(teamRoot), pmId);
}

export function baseRepoPath(teamRoot: string, repoName: string): string {
	return path.join(reposRoot(teamRoot), repoName);
}

/** `<team>/worktrees/<repo>/<pm>/<engineer>/home` — the engineer main-agent cwd. */
export function engineerHomePath(teamRoot: string, repoName: string, pmId: string, engineer: string): string {
	return path.join(worktreesRoot(teamRoot), repoName, pmId, engineer, "home");
}

/** `<team>/worktrees/<repo>/<pm>/<engineer>/<task>` — the task cwd. */
export function taskWorktreePath(
	teamRoot: string,
	repoName: string,
	pmId: string,
	engineer: string,
	task: string,
): string {
	return path.join(worktreesRoot(teamRoot), repoName, pmId, engineer, task);
}

/** `team/<team>/<pm>/<engineer>/integration` */
export function integrationBranch(teamId: string, pmId: string, engineer: string): string {
	return `team/${teamId}/${pmId}/${engineer}/integration`;
}

/** `team/<team>/<pm>/<engineer>/<task>` */
export function taskBranch(teamId: string, pmId: string, engineer: string, task: string): string {
	return `team/${teamId}/${pmId}/${engineer}/${task}`;
}

/** Real path when the directory exists, absolute path otherwise. */
export function canonicalPath(target: string): string {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
}

/** Compare two paths after canonicalization (case-insensitive on Windows). */
export function samePath(left: string, right: string): boolean {
	const a = canonicalPath(left);
	const b = canonicalPath(right);
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Whether `candidate` is `root` itself or lives below it. */
export function pathWithin(root: string, candidate: string): boolean {
	const rel = path.relative(canonicalPath(root), canonicalPath(candidate));
	if (rel === "") return true;
	if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
	return true;
}

/** Read the team root marker, or `null` when the path is not a team root. */
export async function readTeamMarker(teamRoot: string): Promise<TeamMarker | null> {
	const file = teamMarkerPath(teamRoot);
	const value = await readJsonIfPresent(file);
	if (value === undefined) return null;
	return parseTeamMarker(value, file);
}

/** Read a PM marker, or `null` when absent; malformed markers throw. */
export async function readPmMarker(pmRoot: string): Promise<PmMarker | null> {
	const file = pmMarkerPath(pmRoot);
	const value = await readJsonIfPresent(file);
	if (value === undefined) return null;
	return parsePmMarker(value, file);
}

/** Write the ownerless team marker. */
export async function writeTeamMarker(teamRoot: string, marker: TeamMarker): Promise<void> {
	await Bun.write(teamMarkerPath(teamRoot), `${JSON.stringify(marker, null, "\t")}\n`);
}

/** Write a PM workspace marker. */
export async function writePmMarker(pmRoot: string, marker: PmMarker): Promise<void> {
	await Bun.write(pmMarkerPath(pmRoot), `${JSON.stringify(marker, null, "\t")}\n`);
}

/** Write the external-repository breadcrumb (discovery hint only). */
export async function writeTeamMemberMarker(repoRoot: string, marker: TeamMemberMarker): Promise<void> {
	await Bun.write(teamMemberMarkerPath(repoRoot), `${JSON.stringify(marker, null, "\t")}\n`);
}

/**
 * Walk upward from `startDir` looking for `.zeta/team.json`.
 *
 * The nearest `pms/<pm>/.zeta/pm.json` below that root is returned as `pmId`;
 * the team root itself never has a PM marker, an Agent, a session, or Git.
 * When the upward walk finds no team marker, an external repository's
 * `.zeta/team-member.json` breadcrumb is honored instead.
 */
export async function resolveTeamLocation(startDir: string): Promise<TeamLocation | null> {
	const origin = canonicalPath(startDir);
	let dir = path.resolve(startDir);
	let pmCandidate: { root: string; value: unknown; file: string } | undefined;
	let memberCandidate: { root: string; value: unknown; file: string } | undefined;

	while (true) {
		const teamValue = await readJsonIfPresent(teamMarkerPath(dir));
		if (teamValue !== undefined) {
			const marker = parseTeamMarker(teamValue, teamMarkerPath(dir));
			const location: TeamLocation = { teamRoot: dir, teamId: marker.teamId, teamName: marker.name };
			if (pmCandidate && pathWithin(dir, pmCandidate.root)) {
				const pm = parsePmMarker(pmCandidate.value, pmCandidate.file);
				if (pm.teamId !== marker.teamId) {
					throw new TeamError(
						`PM marker ${pmCandidate.file} belongs to team "${pm.teamId}", not "${marker.teamId}"`,
					);
				}
				location.pmId = pm.pmId;
				location.pmRoot = pmCandidate.root;
			} else {
				// A worktree/repo cwd never walks through pms/<pm>; the locked
				// worktree layout names the PM at worktrees/<repo>/<pm>/<engineer>/…
				const rel = path.relative(canonicalPath(dir), origin).split(path.sep).filter(Boolean);
				if (rel[0] === "worktrees" && rel.length >= 4) {
					const pmRoot = pmWorkspacePath(dir, rel[2]);
					try {
						const pm = await readPmMarker(pmRoot);
						if (pm && pm.teamId === marker.teamId) {
							location.pmId = pm.pmId;
							location.pmRoot = pmRoot;
						}
					} catch {
						// A malformed PM marker is a doctor problem, not a resolution failure.
					}
				}
			}
			return location;
		}

		if (!pmCandidate) {
			const pmValue = await readJsonIfPresent(pmMarkerPath(dir));
			if (pmValue !== undefined) pmCandidate = { root: dir, value: pmValue, file: pmMarkerPath(dir) };
		}
		if (!memberCandidate) {
			const memberValue = await readJsonIfPresent(teamMemberMarkerPath(dir));
			if (memberValue !== undefined) {
				memberCandidate = { root: dir, value: memberValue, file: teamMemberMarkerPath(dir) };
			}
		}

		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	if (memberCandidate) {
		const member = parseTeamMemberMarker(memberCandidate.value, memberCandidate.file);
		const teamRoot = canonicalPath(member.teamRoot);
		const marker = await readTeamMarker(teamRoot);
		if (!marker) {
			throw new TeamError(
				`team-member marker ${memberCandidate.file} points at ${teamRoot}, which has no .zeta/team.json`,
			);
		}
		if (marker.teamId !== member.teamId) {
			throw new TeamError(
				`team-member marker ${memberCandidate.file} names team "${member.teamId}", but ${teamRoot} is "${
					marker.teamId
				}"`,
			);
		}
		return { teamRoot, teamId: marker.teamId, teamName: marker.name };
	}

	return null;
}

/**
 * Synchronous {@link resolveTeamLocation}, for session creation (which cannot
 * await before writing the header). Same rules: the nearest upward
 * `.zeta/team.json` wins, a PM marker below it supplies `pmId`, the locked
 * worktree layout supplies `pmId` through its PM workspace, and an external
 * repository's `.zeta/team-member.json` breadcrumb resolves the team. Throws
 * on a malformed marker just as the async resolver does; callers that must not
 * fail session creation catch and treat the location as absent.
 */
export function resolveTeamLocationSync(startDir: string): TeamLocation | null {
	const origin = canonicalPath(startDir);
	let dir = path.resolve(startDir);
	let pmCandidate: { root: string; value: unknown; file: string } | undefined;
	let memberCandidate: { root: string; value: unknown; file: string } | undefined;

	while (true) {
		const teamValue = readJsonSyncIfPresent(teamMarkerPath(dir));
		if (teamValue !== undefined) {
			const marker = parseTeamMarker(teamValue, teamMarkerPath(dir));
			const location: TeamLocation = { teamRoot: dir, teamId: marker.teamId, teamName: marker.name };
			if (pmCandidate && pathWithin(dir, pmCandidate.root)) {
				const pm = parsePmMarker(pmCandidate.value, pmCandidate.file);
				if (pm.teamId !== marker.teamId) {
					throw new TeamError(
						`PM marker ${pmCandidate.file} belongs to team "${pm.teamId}", not "${marker.teamId}"`,
					);
				}
				location.pmId = pm.pmId;
				location.pmRoot = pmCandidate.root;
			} else {
				const rel = path.relative(canonicalPath(dir), origin).split(path.sep).filter(Boolean);
				if (rel[0] === "worktrees" && rel.length >= 4) {
					const pmRoot = pmWorkspacePath(dir, rel[2]);
					try {
						const pm = readPmMarkerSync(pmRoot);
						if (pm && pm.teamId === marker.teamId) {
							location.pmId = pm.pmId;
							location.pmRoot = pmRoot;
						}
					} catch {
						// A malformed PM marker is a doctor problem, not a resolution failure.
					}
				}
			}
			return location;
		}

		if (!pmCandidate) {
			const pmValue = readJsonSyncIfPresent(pmMarkerPath(dir));
			if (pmValue !== undefined) pmCandidate = { root: dir, value: pmValue, file: pmMarkerPath(dir) };
		}
		if (!memberCandidate) {
			const memberValue = readJsonSyncIfPresent(teamMemberMarkerPath(dir));
			if (memberValue !== undefined) {
				memberCandidate = { root: dir, value: memberValue, file: teamMemberMarkerPath(dir) };
			}
		}

		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	if (memberCandidate) {
		const member = parseTeamMemberMarker(memberCandidate.value, memberCandidate.file);
		const teamRoot = canonicalPath(member.teamRoot);
		const markerFile = teamMarkerPath(teamRoot);
		const value = readJsonSyncIfPresent(markerFile);
		if (value === undefined) {
			throw new TeamError(
				`team-member marker ${memberCandidate.file} points at ${teamRoot}, which has no .zeta/team.json`,
			);
		}
		const marker = parseTeamMarker(value, markerFile);
		if (marker.teamId !== member.teamId) {
			throw new TeamError(
				`team-member marker ${memberCandidate.file} names team "${member.teamId}", but ${teamRoot} is "${marker.teamId}"`,
			);
		}
		return { teamRoot, teamId: marker.teamId, teamName: marker.name };
	}

	return null;
}

/** Read and validate a PM marker synchronously; `null` when absent. */
function readPmMarkerSync(pmRoot: string): PmMarker | null {
	const file = pmMarkerPath(pmRoot);
	const value = readJsonSyncIfPresent(file);
	if (value === undefined) return null;
	return parsePmMarker(value, file);
}
