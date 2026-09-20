import { createHash } from "node:crypto";
import path from "node:path";

export interface OfficialSkillsPayload {
	/** Stable content hash of the file map (first 16 hex of sha256). */
	hash: string;
	/** Relative path (<skill>/SKILL.md) -> full file text including frontmatter. */
	files: Record<string, string>;
}

/**
 * Build the embeddable official-skills payload burned into bundles and
 * binaries as `process.env.ZETA_OFFICIAL_SKILLS_EMBED` (same mechanism as
 * PI_DOCS_EMBED). At runtime the discovery provider seeds these files into
 * `<agentDir>/official-skills/` and scans them from disk, so skills keep real
 * paths for realpath/baseDir consumers.
 */
export async function buildOfficialSkillsPayload(
	skillsDir: string = path.join(import.meta.dir, "../../../skills/official"),
): Promise<OfficialSkillsPayload> {
	const glob = new Bun.Glob("*/SKILL.md");
	const files: Record<string, string> = {};
	for await (const relative of glob.scan({ cwd: skillsDir, dot: false })) {
		const key = relative.split(path.sep).join("/");
		files[key] = await Bun.file(path.join(skillsDir, relative)).text();
	}
	const canonical = JSON.stringify(files);
	const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
	return { hash, files };
}
