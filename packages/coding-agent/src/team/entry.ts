/**
 * TUI entry classification for a working directory inside (or outside) a Team.
 *
 * The resolver answers one question: what should `zetacode` open here?
 *
 * | cwd                                      | kind                    | open                                  |
 * | ---------------------------------------- | ----------------------- | ------------------------------------- |
 * | exactly `<team>` (`.zeta/team.json`)     | `team-root`             | Team Hub (a UI, never an Agent)       |
 * | exactly `<team>/pms/<pm>` (`.zeta/pm.json`) | `pm-root`            | Team Hub focused on that PM           |
 * | `<team>/repos/<repo>[/…]`                | `base-repo`             | coding TUI + warning, no engineer crumb |
 * | `<team>/worktrees/<repo>/<pm>/<eng>/<wt>[/…]` | `engineer-worktree` | coding TUI + breadcrumb               |
 * | any other directory below `<team>`       | `unmarked-team-subdir`  | coding TUI + warning, no guessing     |
 * | outside every Team                       | `outside`               | ordinary coding TUI                   |
 *
 * A malformed or unsupported marker never throws out of the TUI entry path: it
 * is reported as a warning so the ordinary coding session still opens. Vibe is
 * never enabled here.
 */

import { getProjectDir } from "@linxiraos/pi-utils/dirs";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	canonicalPath,
	parseTeamMemberMarker,
	resolveTeamLocation,
	samePath,
	TEAM_MEMBER_MARKER_FILE,
	type TeamLocation,
} from "./paths";

export type TeamEntryKind =
	| "outside"
	| "team-root"
	| "pm-root"
	| "base-repo"
	| "engineer-worktree"
	| "unmarked-team-subdir";

/** A worktree is either an engineer's persistent home or one task checkout. */
export type TeamEntryWorktreeKind = "home" | "task";

export interface TeamEntry {
	kind: TeamEntryKind;
	/** Absolute, canonical working directory this entry describes. */
	cwd: string;
	teamRoot?: string;
	teamId?: string;
	teamName?: string;
	pmId?: string;
	pmName?: string;
	/** Base repository name when the cwd is inside `<team>/repos/<repo>`. */
	repoName?: string;
	engineerName?: string;
	worktreeKind?: TeamEntryWorktreeKind;
	/** `home` or the task directory name. */
	worktreeName?: string;
	/**
	 * Display-only crumb parts, in the order `Team / PM / repo / engineer /
	 * worktree`. Never contains an absolute path.
	 */
	breadcrumb?: string[];
	/** Non-fatal explanation shown as a TUI warning; the coding session still opens. */
	warning?: string;
	/** A marker existed but could not be trusted (schema/parse/ownership). */
	invalidMarker?: boolean;
	/** Set when the team was reached through an external repository breadcrumb. */
	externalRepo?: boolean;
}

interface TeamMemberBreadcrumb {
	repoName: string;
}

function relativeSegments(root: string, target: string): string[] {
	const rel = path.relative(canonicalPath(root), canonicalPath(target));
	return rel.split(path.sep).filter(Boolean);
}

function isInside(root: string, target: string): boolean {
	const rel = path.relative(canonicalPath(root), canonicalPath(target));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Find `.zeta/team-member.json` from `startDir` upward; it only links a team to a repo. */
async function findTeamMemberBreadcrumb(startDir: string): Promise<TeamMemberBreadcrumb | null> {
	let dir = path.resolve(startDir);
	while (true) {
		const file = path.join(dir, TEAM_MEMBER_MARKER_FILE);
		try {
			const value: unknown = await Bun.file(file).json();
			return { repoName: parseTeamMemberMarker(value, file).repoName };
		} catch {
			// Absent (or malformed) breadcrumb: keep walking. The team root marker
			// walk is authoritative, so a hint never blocks entry resolution.
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function baseFields(location: TeamLocation, cwd: string): TeamEntry {
	return {
		kind: "outside",
		cwd,
		teamRoot: location.teamRoot,
		teamId: location.teamId,
		teamName: location.teamName,
		pmId: location.pmId,
	};
}

/**
 * Classify `cwd` for the TUI entry matrix. Never opens a database and never
 * creates a session; the markers are the discovery input.
 */
export async function resolveTeamEntry(cwd: string = getProjectDir()): Promise<TeamEntry> {
	const canonicalCwd = canonicalPath(cwd);
	let location: TeamLocation | null;
	try {
		location = await resolveTeamLocation(canonicalCwd);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			kind: "outside",
			cwd: canonicalCwd,
			warning: `Team markers could not be read (${message}). Opening a normal coding session.`,
			invalidMarker: true,
		};
	}
	if (!location) return { kind: "outside", cwd: canonicalCwd };

	const entry = baseFields(location, canonicalCwd);
	const teamName = location.teamName;

	// A linked repository lives outside the team root; its breadcrumb is the only
	// discovery hint. It is still a base repository, never an Agent cwd.
	if (!isInside(location.teamRoot, canonicalCwd)) {
		let repoName: string;
		try {
			repoName = (await findTeamMemberBreadcrumb(canonicalCwd))?.repoName ?? path.basename(canonicalCwd);
		} catch {
			repoName = path.basename(canonicalCwd);
		}
		return {
			...entry,
			kind: "base-repo",
			repoName,
			externalRepo: true,
			breadcrumb: [teamName, "repos", repoName],
			warning: `This is the linked base repository "${repoName}" for team "${teamName}". A base repository is not an agent workspace; open an engineer home or task worktree instead.`,
		};
	}

	const segments = relativeSegments(location.teamRoot, canonicalCwd);

	if (segments.length === 0) {
		return { ...entry, kind: "team-root" };
	}

	// Exact PM workspace: the marker walk found `.zeta/pm.json` at this very dir.
	if (location.pmRoot && samePath(location.pmRoot, canonicalCwd)) {
		const name = await readPmDisplayName(location);
		return { ...entry, kind: "pm-root", pmName: name };
	}

	if (segments[0] === "repos" && segments.length >= 2) {
		const repoName = segments[1]!;
		return {
			...entry,
			kind: "base-repo",
			repoName,
			breadcrumb: [teamName, "repos", repoName],
			warning: `This is the canonical base repository "${repoName}" for team "${teamName}". A base repository stays on its default branch and is never an agent workspace; open an engineer home or task worktree instead.`,
		};
	}

	if (segments[0] === "worktrees" && segments.length >= 5) {
		const [, repoName, pmDir, engineerName, worktreeName] = segments;
		const pmName = (await readPmDisplayName(location)) ?? pmDir;
		const worktreeKind: TeamEntryWorktreeKind = worktreeName === "home" ? "home" : "task";
		return {
			...entry,
			kind: "engineer-worktree",
			repoName,
			pmId: location.pmId ?? pmDir,
			pmName,
			engineerName,
			worktreeKind,
			worktreeName,
			breadcrumb: [teamName, pmName ?? pmDir!, repoName!, engineerName!, worktreeName!],
		};
	}

	const detail =
		segments[0] === "pms" && segments.length >= 2
			? `PM workspace area "${segments.slice(0, 2).join("/")}"`
			: segments[0] === "worktrees"
				? "the team worktree area"
				: `a subdirectory of team "${teamName}"`;
	const pmName = await readPmDisplayName(location);
	if (pmName) entry.pmName = pmName;
	return {
		...entry,
		kind: "unmarked-team-subdir",
		breadcrumb: pmName ? [teamName, pmName] : [teamName],
		warning: `${detail} has no PM, repository, or engineer worktree marker; opening a normal coding session. Team Hub is available with /team hub.`,
	};
}

/** Read the PM marker's display name, tolerating a missing/malformed marker. */
async function readPmDisplayName(location: TeamLocation): Promise<string | undefined> {
	if (!location.pmRoot) return location.pmId;
	try {
		const file = path.join(location.pmRoot, ".zeta", "pm.json");
		const value: unknown = await Bun.file(file).json();
		const record = value as { name?: unknown };
		if (typeof record.name === "string" && record.name.length > 0) return record.name;
	} catch {
		// Fall through to the directory/id label.
	}
	if (location.pmId) return location.pmId;
	return fs.existsSync(location.pmRoot) ? path.basename(location.pmRoot) : undefined;
}

/** Whether this entry launches the Team Hub instead of a coding session. */
export function isTeamHubEntry(entry: TeamEntry): boolean {
	return entry.kind === "team-root" || entry.kind === "pm-root";
}
