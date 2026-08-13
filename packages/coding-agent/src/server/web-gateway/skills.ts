/**
 * Web Gateway skills handlers.
 *
 * Semantic port of `web-ui/app/api/skills*` routes: the listing is loaded
 * through the runtime-native `DefaultResourceLoader` (so configured skill
 * paths, package skills, and `.agents/skills` directories are all included),
 * annotated with `.skill-lock.json` install info, and install/check/update
 * run the `skills` CLI through the shell-free npx wrapper. The DTO contract
 * mirrors the web-ui route handlers byte-compatibly.
 *
 * The web-ui never imports zeta; the gateway owns the runtime side here.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { logger } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { Settings } from "../../config/settings";
import {
	DefaultResourceLoader,
	type Skill as LoaderSkill,
	parseFrontmatter,
} from "../../extensibility/legacy-pi-coding-agent-shim";
import type { SkillInfo, SkillSearchResult } from "./dto";
import { runNpx } from "./npx";
import { buildSkillUpdateArgs, checkSkillUpdates } from "./skill-updates";
import { annotateSkillsWithInstallInfo } from "./skills-lock";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Load the runtime skill set for `cwd` and annotate it with lock-file install
 * info. Uses an isolated Settings instance so the gateway never mutates the
 * process-global settings singleton (which is owned by the CLI session).
 */
function toSkillInfo(skill: LoaderSkill): SkillInfo {
	return {
		name: skill.name,
		description: skill.description,
		filePath: skill.filePath,
		baseDir: skill.baseDir,
		disableModelInvocation: skill.hide === true,
		sourceInfo: {
			...(skill.source ? { source: skill.source } : {}),
			...(skill._source?.level ? { scope: skill._source.level } : {}),
		},
	};
}

async function loadSkills(cwd: string) {
	const agentDir = getAgentDir();
	const settings = await Settings.loadIsolated({ cwd, agentDir });
	const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings });
	await loader.reload();
	const { skills, diagnostics } = loader.getSkills();
	return {
		skills: annotateSkillsWithInstallInfo(skills.map(toSkillInfo), { cwd, agentDir }),
		diagnostics,
	};
}

// GET /api/skills?cwd=<path>
export async function handleSkillsGet(req: Request): Promise<Response> {
	const { searchParams } = new URL(req.url);
	const cwd = searchParams.get("cwd");
	if (!cwd) return json({ error: "cwd required" }, 400);
	if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);
	try {
		return json(await loadSkills(cwd));
	} catch (e) {
		return json({ error: String(e) }, 500);
	}
}

// PATCH /api/skills  body: { filePath, disableModelInvocation }
export async function handleSkillsPatch(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { filePath?: unknown; disableModelInvocation?: unknown };
		const filePath = typeof body.filePath === "string" ? body.filePath : "";
		const disableModelInvocation = Boolean(body.disableModelInvocation);
		if (!filePath) return json({ error: "filePath required" }, 400);
		if (!existsSync(filePath)) return json({ error: "file not found" }, 404);

		const content = readFileSync(filePath, "utf8");
		const key = "disable-model-invocation";

		// Use parseFrontmatter to check the current value, then do a surgical
		// line edit to preserve the original YAML formatting of all other fields.
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		const alreadySet = Boolean(frontmatter[key]);

		let updated = content;
		if (disableModelInvocation && !alreadySet) {
			// Add key after the opening --- line
			updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
			// If no frontmatter exists, create one
			if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
		} else if (!disableModelInvocation && alreadySet) {
			// Remove the key line entirely
			updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
		}

		writeFileSync(filePath, updated, "utf8");
		return json({ success: true });
	} catch (e) {
		return json({ error: String(e) }, 500);
	}
}

// POST /api/skills/install  body: { package, scope, cwd? }
export async function handleSkillsInstall(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { package?: unknown; scope?: unknown; cwd?: unknown };
		const pkg = typeof body.package === "string" ? body.package.trim() : "";
		if (!pkg) return json({ error: "package required" }, 400);

		const isGlobal = body.scope !== "project";
		const cwd = typeof body.cwd === "string" ? body.cwd : "";
		if (!isGlobal) {
			if (!cwd) return json({ error: "cwd required for project install" }, 400);
			if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);
		}
		const args = ["skills", "add", pkg, "-y", "--agent", "omp"];
		if (isGlobal) args.push("-g");

		logger.debug("skills install", { args });
		const { stdout, stderr } = await runNpx(args, {
			timeout: 60_000,
			cwd: !isGlobal && cwd ? cwd : undefined,
			env: { ...process.env, FORCE_COLOR: "0" },
		});

		const output = (stdout + stderr).replace(ANSI_RE, "");
		const success = /Installation complete|Installed \d+ skill/.test(output);
		if (!success) {
			return json({ error: output.slice(-300) || "Install failed" }, 500);
		}
		return json({ success: true, output });
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
		return json({ error: output || (err.message ?? String(e)) }, 500);
	}
}

// POST /api/skills/search  body: { query, limit? }
export async function handleSkillsSearch(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { query?: unknown; limit?: unknown };
		const query = typeof body.query === "string" ? body.query.trim() : "";
		if (!query) return json({ error: "query required" }, 400);
		const limit = parseLimit(body.limit);

		try {
			const results = await searchSkillsApi(query, limit);
			return json({ results });
		} catch {
			const { stdout, stderr } = await runNpx(["skills", "find", query], {
				timeout: 20_000,
				env: { ...process.env, FORCE_COLOR: "0" },
			});

			const results = parseSearchOutput(stdout + stderr).slice(0, limit);
			return json({ results });
		}
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
		return json({ error: output || (err.message ?? String(e)) }, 500);
	}
}

// POST /api/skills/check  body: { cwd, package?, scope? }
export async function handleSkillsCheck(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { cwd?: unknown; package?: unknown; scope?: unknown };
		const cwd = typeof body.cwd === "string" ? body.cwd : "";
		if (!cwd) return json({ error: "cwd required" }, 400);
		if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);

		const pkg = typeof body.package === "string" ? body.package : undefined;
		const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
		if ((pkg && !scope) || (!pkg && scope)) {
			return json({ error: "package and scope must be provided together" }, 400);
		}

		const { skills } = await loadSkills(cwd);
		const installs = skills
			.map(skill => skill.install)
			.filter((install): install is NonNullable<typeof install> => Boolean(install))
			.filter(install => !pkg || (install.package === pkg && install.scope === scope));

		if (pkg && installs.length === 0) {
			return json({ error: "Installed skill not found" }, 404);
		}

		const updates = await checkSkillUpdates(installs, {
			githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
		});
		return json({ updates });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

// POST /api/skills/update  body: { cwd, package, scope }
export async function handleSkillsUpdate(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { cwd?: unknown; package?: unknown; scope?: unknown };
		const cwd = typeof body.cwd === "string" ? body.cwd : "";
		const pkg = typeof body.package === "string" ? body.package : "";
		const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
		if (!cwd || !pkg || !scope) {
			return json({ error: "cwd, package, and scope are required" }, 400);
		}
		if (!isDirectory(cwd)) return json({ error: "Access denied" }, 403);

		const { skills } = await loadSkills(cwd);
		const skill = skills.find(item => item.install?.package === pkg && item.install.scope === scope);
		if (!skill?.install) {
			return json({ error: "Installed skill not found" }, 404);
		}
		if (!skill.install.canCheckForUpdates) {
			return json({ error: "This skill cannot be updated automatically" }, 400);
		}

		const { stdout, stderr } = await runNpx(buildSkillUpdateArgs(skill.install), {
			timeout: 60_000,
			cwd: scope === "project" ? cwd : undefined,
			env: { ...process.env, FORCE_COLOR: "0" },
		});

		const refreshed = await loadSkills(cwd);
		const updatedSkill = refreshed.skills.find(item => item.install?.package === pkg && item.install.scope === scope);
		return json({
			success: true,
			skill: updatedSkill,
			output: `${stdout}${stderr}`.slice(-500),
		});
	} catch (error: unknown) {
		const detail = error as { stdout?: string; stderr?: string; message?: string };
		const output = `${detail.stdout ?? ""}${detail.stderr ?? ""}`;
		return json({ error: output || detail.message || String(error) }, 500);
	}
}

// ---------------------------------------------------------------------------
// Search helpers (semantic port of web-ui/app/api/skills/search/route.ts)
// ---------------------------------------------------------------------------

interface SkillsApiSkill {
	id?: string;
	name?: string;
	source?: string;
	installs?: number;
}

interface SkillsApiResponse {
	skills?: SkillsApiSkill[];
}

function parseLimit(value: unknown): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function formatInstalls(count?: number): string {
	if (!count || count <= 0) return "";
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
	return `${count} install${count === 1 ? "" : "s"}`;
}

function parseSearchOutput(raw: string): SkillSearchResult[] {
	const clean = raw.replace(ANSI_RE, "");
	const results: SkillSearchResult[] = [];
	const lines = clean.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		// package line: "owner/repo@skill  NNK installs"
		const pkgMatch = line.match(/^([\w.-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
		if (pkgMatch) {
			const urlLine = lines[i + 1]?.trim().replace(/^\u2192\s*/, "");
			results.push({
				package: pkgMatch[1],
				installs: pkgMatch[2],
				url: urlLine?.startsWith("https://") ? urlLine : "",
			});
		}
	}
	return results;
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
	const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

	const data = (await res.json()) as SkillsApiResponse;
	return (data.skills ?? [])
		.map(skill => {
			const name = skill.name?.trim();
			const source = skill.source?.trim();
			const slug = skill.id?.trim();
			if (!name || (!source && !slug)) return null;

			const pkg = `${source || slug}@${name}`;
			return {
				package: pkg,
				installs: formatInstalls(skill.installs),
				url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
			};
		})
		.filter((skill): skill is SkillSearchResult => skill !== null)
		.sort((a, b) => parseInstallCount(b.installs) - parseInstallCount(a.installs));
}

function parseInstallCount(installs: string): number {
	const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
	if (!match) return 0;
	const value = Number(match[1]);
	if (!Number.isFinite(value)) return 0;
	const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
	return value * multiplier;
}
