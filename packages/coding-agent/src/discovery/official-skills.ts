/**
 * Official skills pack: resolution, user-directory installation, and rollback.
 *
 * The pack (`skills/official` in the repo, burned into bundles/binaries as
 * `ZETA_OFFICIAL_SKILLS_EMBED`) has two consumers:
 *
 *   1. the `zeta-official` provider in `discovery/builtin.ts`, which serves the
 *      pack as a *fallback* for names the user skills directory does not carry;
 *   2. {@link installOfficialSkills}, which copies the pack into the user skills
 *      directory (`~/.zeta/agent/skills/<name>/SKILL.md`) so the pack becomes
 *      ordinary, user-editable, versionable files.
 *
 * Installation is deliberately asymmetric towards the user:
 *
 *   - a file the user edited is never overwritten — it is kept and reported;
 *   - a file the user deleted is never resurrected by the automatic path (an
 *     explicit `zetacode skill install-official` restores it);
 *   - a recorded pack hash short-circuits the whole pass, so a settled install
 *     costs one small JSON read per session start.
 *
 * {@link uninstallOfficialSkills} (or deleting the seeded skill directories)
 * hands those names back to the provider, which serves them from the
 * system-side pack again — the documented rollback.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@linxiraos/pi-utils";

/** The pack as one content-addressed file map (`<skill>/SKILL.md` -> text). */
export interface OfficialSkillsPack {
	/** Content hash of the whole map; version key of the install marker. */
	hash: string;
	/** Relative path -> full file text including frontmatter. */
	files: Record<string, string>;
}

/** Marker recording what we installed. Lives inside the user skills directory
 * under a dot name, so the skill scanners (which skip dot entries) ignore it. */
export const OFFICIAL_SKILLS_RECORD_FILE = ".official-skills.json";

/**
 * User skills root (`~/.zeta/agent/skills` by default).
 *
 * `ZETA_SKILLS_USER_DIR` redirects it process-wide: the test preload points it
 * at a scratch path so a test run never touches the real user tree, and focused
 * tests point it at a temp dir to exercise install/upgrade/rollback end to end.
 */
export function userSkillsDir(): string {
	return process.env.ZETA_SKILLS_USER_DIR ?? path.join(getAgentDir(), "skills");
}

/**
 * Candidate directories probed in order by {@link resolveOfficialSkillsDir}.
 * Exported for tests that verify the npm source-install layout.
 */
export function officialSkillsDirCandidates(fromDir: string): string[] {
	return [path.join(fromDir, "../../../../skills/official"), path.join(fromDir, "../../skills/official")];
}

/**
 * Resolve the on-disk pack directory.
 *
 * Resolution order:
 *   1. `ZETA_OFFICIAL_SKILLS_DIR` — explicit override; a dead path disables the
 *      pack entirely (the test preload uses this for process-wide isolation).
 *   2. `ZETA_OFFICIAL_SKILLS_EMBED` — payload burned in at bundle/binary build
 *      time (see scripts/generate-official-skills-payload.ts); seeded to disk
 *      under `<agentDir>/official-skills/` so skills keep real paths.
 *   3. On-disk candidates — repo checkout (`<repo>/skills/official`, dev runs)
 *      and the packaged copy (`<pkg>/skills/official`, shipped via the
 *      package.json `files` list). src runtimes have no embed define (it is
 *      substituted at bundle/binary build time), so npm source installs rely
 *      entirely on the packaged candidate.
 */
export function resolveOfficialSkillsDir(): string | null {
	const override = process.env.ZETA_OFFICIAL_SKILLS_DIR;
	if (override !== undefined) return override;
	const embed = process.env.ZETA_OFFICIAL_SKILLS_EMBED;
	if (embed !== undefined) return seedOfficialSkillsFromEmbed(embed);
	for (const candidate of officialSkillsDirCandidates(import.meta.dir)) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function seedOfficialSkillsFromEmbed(embedJson: string): string {
	// Test processes override this to point the seed at a temp dir; mutating
	// the global agent dir from a test leaks into every later chunk sibling.
	const seedRoot = process.env.ZETA_OFFICIAL_SKILLS_SEED_DIR ?? path.join(getAgentDir(), "official-skills");
	const seedDir = seedRoot;
	const hash = createHash("sha256").update(embedJson).digest("hex").slice(0, 16);
	const hashPath = path.join(seedDir, ".embed-hash");
	let currentHash = "";
	try {
		currentHash = readFileSync(hashPath, "utf8").trim();
	} catch {
		// First seed, or the marker was removed — fall through to a rewrite.
	}
	if (currentHash === hash && existsSync(seedDir)) return seedDir;
	const files = JSON.parse(embedJson) as Record<string, string>;
	const wanted = new Set(Object.keys(files));
	mkdirSync(seedDir, { recursive: true });
	for (const [relative, body] of Object.entries(files)) {
		const target = path.join(seedDir, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, body);
	}
	writeFileSync(hashPath, `${hash}\n`);
	pruneStaleSeedFiles(seedDir, wanted);
	return seedDir;
}

/**
 * The payload is the single source of truth for the seed dir: when a new embed
 * ships fewer files (a skill retired from the pack), leftovers from the
 * previous seed must go or ghost skills keep loading from disk. Only the
 * `.embed-hash` marker itself is exempt. Runs only on rewrites — the hash
 * short-circuit above skips it for unchanged payloads.
 */
function pruneStaleSeedFiles(seedDir: string, wanted: Set<string>): void {
	const visit = (dir: string): void => {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(entryPath);
				continue;
			}
			const relative = path.relative(seedDir, entryPath).split(path.sep).join("/");
			if (relative !== ".embed-hash" && !wanted.has(relative)) {
				rmSync(entryPath, { force: true });
			}
		}
	};
	visit(seedDir);
}

/**
 * Read the pack file map from the embed when present, else from the resolved
 * on-disk pack directory. Returns null when there is no pack (the common case
 * in a source checkout without `skills/official`, and under the test preload's
 * dead `ZETA_OFFICIAL_SKILLS_DIR`).
 */
export function resolveOfficialSkillsPack(): OfficialSkillsPack | null {
	const embed = process.env.ZETA_OFFICIAL_SKILLS_EMBED;
	if (embed !== undefined) {
		const files = JSON.parse(embed) as Record<string, string>;
		return { hash: packHashOf(files), files };
	}
	const dir = resolveOfficialSkillsDir();
	if (!dir || !existsSync(dir)) return null;
	const files: Record<string, string> = {};
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const skillFile = path.join(dir, entry.name, "SKILL.md");
		let content: string;
		try {
			content = readFileSync(skillFile, "utf8");
		} catch {
			continue;
		}
		files[`${entry.name}/SKILL.md`] = content;
	}
	if (Object.keys(files).length === 0) return null;
	return { hash: packHashOf(files), files };
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Order-independent content hash of the file map (key order is not part of the pack identity). */
function packHashOf(files: Record<string, string>): string {
	const canonical = JSON.stringify(
		Object.keys(files)
			.sort()
			.map(key => [key, files[key]]),
	);
	return hashText(canonical);
}

/** One installed file: its content hash and whether we own it (safe to upgrade). */
export interface OfficialSkillsFileRecord {
	sha: string;
	/**
	 * `true` when the file at this path is ours (we wrote it, or adopted a
	 * byte-identical copy). `false` marks a path a *foreign* file already owned:
	 * we record the collision so the pass does not warn again, and never write.
	 */
	owned: boolean;
}

export interface OfficialSkillsInstallRecord {
	/** Pack version the record reflects; equal means the install is settled. */
	packHash?: string;
	/** User opted out of the user-directory install; only an explicit install clears it. */
	optOut?: boolean;
	files?: Record<string, OfficialSkillsFileRecord>;
}

export function readOfficialSkillsInstallRecord(dir: string = userSkillsDir()): OfficialSkillsInstallRecord {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(dir, OFFICIAL_SKILLS_RECORD_FILE), "utf8"));
		if (parsed && typeof parsed === "object") return parsed as OfficialSkillsInstallRecord;
	} catch {
		// Missing or corrupt marker: a fresh install overwrites it.
	}
	return {};
}

function writeOfficialSkillsInstallRecord(dir: string, record: OfficialSkillsInstallRecord): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, OFFICIAL_SKILLS_RECORD_FILE), `${JSON.stringify(record, null, "\t")}\n`);
}

/**
 * Skill directory names our installer owns. The official provider uses this to
 * yield a name the user skills directory already carries: once the pack is
 * installed, the user's file is the authoritative copy, and re-advertising the
 * provider copy would only add a `zeta-official/<name>` ghost when the user
 * edited it (identical copies collapse silently, differing ones get namespaced).
 */
export function officialSkillsInstalledNames(dir: string = userSkillsDir()): Set<string> {
	const names = new Set<string>();
	for (const [relative, entry] of Object.entries(readOfficialSkillsInstallRecord(dir).files ?? {})) {
		if (entry?.owned) names.add(relative.split("/")[0]);
	}
	return names;
}

export interface OfficialSkillsSyncResult {
	/** User skills directory the pass targeted. */
	dir: string;
	/** Pack version this pass synced to. */
	packHash: string;
	/** Newly written files (the name was absent). */
	installed: string[];
	/** Rewritten files (our copy was untouched since the previous seed). */
	upgraded: string[];
	/** Rewritten files the user had deleted (explicit installs only). */
	restored: string[];
	/** Files left exactly as the user wrote them (edited, or foreign collisions). */
	kept: string[];
	/** Seeded files the user deleted; the automatic path leaves them deleted. */
	skipped: string[];
	/** Nothing on disk changed. */
	unchanged: boolean;
}

/**
 * Sync the official pack into the user skills directory.
 *
 * `mode: "auto"` is the session-startup path: it honors a recorded opt-out,
 * short-circuits on a settled pack hash, and leaves user deletions alone.
 * `mode: "explicit"` (`zetacode skill install-official`) clears an opt-out and
 * restores deleted files. Neither mode overwrites a file the user edited.
 *
 * Returns null when there is no pack to install from, or when an automatic pass
 * is a no-op (opted out, or already settled).
 */
export function installOfficialSkills(
	options: {
		dir?: string;
		pack?: OfficialSkillsPack | null;
		mode?: "auto" | "explicit";
		dryRun?: boolean;
	} = {},
): OfficialSkillsSyncResult | null {
	const dir = options.dir ?? userSkillsDir();
	const mode = options.mode ?? "auto";
	const pack = options.pack === undefined ? resolveOfficialSkillsPack() : options.pack;
	if (!pack) return null;
	// An explicit pack-directory override means the operator manages where the
	// pack lives; copying it into the user tree is not ours to decide. This is
	// also what keeps the test preload's dead `ZETA_OFFICIAL_SKILLS_DIR` from
	// installing a pack into a developer's real home during a test run.
	if (mode === "auto" && options.pack === undefined && process.env.ZETA_OFFICIAL_SKILLS_DIR !== undefined) return null;
	const record = readOfficialSkillsInstallRecord(dir);
	if (mode === "auto" && (record.optOut === true || record.packHash === pack.hash)) return null;

	const nextFiles: Record<string, OfficialSkillsFileRecord> = { ...record.files };
	const result: OfficialSkillsSyncResult = {
		dir,
		packHash: pack.hash,
		installed: [],
		upgraded: [],
		restored: [],
		kept: [],
		skipped: [],
		unchanged: false,
	};
	for (const [relative, body] of Object.entries(pack.files)) {
		const target = path.join(dir, relative);
		const previous = record.files?.[relative];
		const existing = readTextIfExists(target);

		if (existing !== undefined && previous && !previous.owned) {
			result.kept.push(relative);
			continue;
		}
		if (existing === undefined) {
			if (previous?.owned && mode === "auto") {
				// The user deleted our copy: leave it deleted, and keep the record so
				// a later released pack does not resurrect it either.
				result.skipped.push(relative);
				continue;
			}
			if (!options.dryRun) {
				mkdirSync(path.dirname(target), { recursive: true });
				writeFileSync(target, body);
			}
			nextFiles[relative] = { sha: hashText(body), owned: true };
			(previous ? result.restored : result.installed).push(relative);
			continue;
		}

		const existingSha = hashText(existing);
		if (!previous) {
			if (existing === body) {
				// A byte-identical copy already on disk (a previous install whose
				// marker was lost, or a manual copy): adopt it without writing.
				nextFiles[relative] = { sha: existingSha, owned: true };
				result.installed.push(relative);
			} else {
				nextFiles[relative] = { sha: existingSha, owned: false };
				result.kept.push(relative);
			}
			continue;
		}
		if (existingSha === previous.sha) {
			if (existing === body) continue; // untouched and current
			if (!options.dryRun) writeFileSync(target, body);
			nextFiles[relative] = { sha: hashText(body), owned: true };
			result.upgraded.push(relative);
			continue;
		}
		// Edited by the user: preserved in every mode, reported so an upgraded
		// pack does not silently skip the change.
		result.kept.push(relative);
	}

	if (!options.dryRun) writeOfficialSkillsInstallRecord(dir, { packHash: pack.hash, files: nextFiles });
	// "unchanged" means nothing was written: kept/skipped are reports about files
	// the pass deliberately left alone, not changes to the user's tree.
	result.unchanged = result.installed.length === 0 && result.upgraded.length === 0 && result.restored.length === 0;
	return result;
}

export interface OfficialSkillsUninstallResult {
	dir: string;
	/** Files we removed (ours, untouched since the seed). */
	removed: string[];
	/** Files we left (the user edited them). */
	kept: string[];
}

/**
 * Remove the files we installed and record an opt-out so the automatic path
 * stops re-installing them. Edited files stay (and keep shadowing the pack's
 * copy of that name). Names with no live file left fall back to the
 * system-side provider — the documented way back to "the pack is just builtin".
 */
export function uninstallOfficialSkills(
	options: { dir?: string; dryRun?: boolean } = {},
): OfficialSkillsUninstallResult {
	const dir = options.dir ?? userSkillsDir();
	const record = readOfficialSkillsInstallRecord(dir);
	const result: OfficialSkillsUninstallResult = { dir, removed: [], kept: [] };
	for (const [relative, entry] of Object.entries(record.files ?? {})) {
		if (!entry?.owned) continue;
		const existing = readTextIfExists(path.join(dir, relative));
		if (existing === undefined) continue;
		if (hashText(existing) !== entry.sha) {
			result.kept.push(relative);
			continue;
		}
		if (!options.dryRun) rmSync(path.join(dir, relative), { force: true });
		result.removed.push(relative);
	}
	if (!options.dryRun) writeOfficialSkillsInstallRecord(dir, { optOut: true });
	return result;
}

function readTextIfExists(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
}
