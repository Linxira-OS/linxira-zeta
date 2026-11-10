/**
 * PM → engineer skill assignment and engineer-session injection.
 *
 * The fixture is a real Team root, real linked worktrees, and the global Team
 * database; skills are real files so the autoload prompt reads a real body.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { FileSessionStorage } from "@linxiraos/zeta/session/session-storage";
import { TeamDb } from "@linxiraos/zeta/team/db";
import {
	assignEngineerSkill,
	engineerSkillRoot,
	loadEngineerAssignments,
	removeEngineerSkill,
	resolveEngineerSkillContext,
	resolveOwnedEngineer,
	skillQualifiedName,
	skillRisk,
} from "@linxiraos/zeta/team/engineer-skills";
import { addEngineer, addPm, addRepoLink, bindRepo, initTeam } from "@linxiraos/zeta/team/service";
import type { EngineerSkillInjectionSession } from "@linxiraos/zeta/session/engineer-skills";
import { applyEngineerSkillAssignments } from "@linxiraos/zeta/session/engineer-skills";
import type { CustomMessageEntry, SessionEntry } from "@linxiraos/zeta/session/session-entries";
import type { Skill } from "@linxiraos/zeta/extensibility/skills";
import { EngineerSkillsTool } from "@linxiraos/zeta/tools/engineer-skills";
import type { ToolSession } from "@linxiraos/zeta/tools";

const GIT_NAME = "Zeta Test";
const GIT_EMAIL = "zeta-test@example.invalid";

function runGit(cwd: string, ...args: string[]): string {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	return proc.stdout.toString().trim();
}

function makeFixtureRepo(parent: string, name: string): string {
	const repo = path.join(parent, name);
	fs.mkdirSync(repo, { recursive: true });
	runGit(repo, "init", "-b", "main");
	fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
	runGit(repo, "add", "README.md");
	runGit(repo, "-c", `user.name=${GIT_NAME}`, "-c", `user.email=${GIT_EMAIL}`, "commit", "-m", "init");
	return repo;
}

function makeSkill(root: string, name: string, provider: string, level = "project"): Skill {
	const baseDir = path.join(root, "skills", name);
	fs.mkdirSync(baseDir, { recursive: true });
	const filePath = path.join(baseDir, "SKILL.md");
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} test skill\n---\n# ${name}\nbody\n`);
	return {
		name,
		description: `${name} test skill`,
		filePath,
		baseDir,
		source: `${provider}:${level}`,
		_source: {
			provider,
			providerName: provider,
			path: filePath,
			level: level === "user" ? "user" : "project",
		},
	};
}

interface FakeSession {
	session: EngineerSkillInjectionSession;
	entries: SessionEntry[];
}

function makeFakeSession(cwd: string, skills: readonly Skill[], allowlist: string[] = []): FakeSession {
	const entries: SessionEntry[] = [];
	const session: EngineerSkillInjectionSession = {
		sessionManager: { getCwd: () => cwd, getEntries: () => entries },
		skills,
		settings: Settings.isolated({ "team.skillAllowlist": allowlist }),
		async sendCustomMessage(message, _options) {
			const payload = typeof message === "string" ? { customType: "text", content: message } : message;
			entries.push({
				type: "custom_message",
				id: `entry-${entries.length}`,
				parentId: null,
				timestamp: new Date().toISOString(),
				customType: payload.customType ?? "text",
				content: payload.content ?? "",
				display: payload.display ?? false,
				details: payload.details,
				attribution: payload.attribution,
			});
			return false;
		},
	};
	return { session, entries };
}

describe("PM → engineer skill assignment", () => {
	let scratch: string;
	let teamRoot: string;
	let dbPath: string;
	let aliceHome: string;
	let bobHome: string;
	let carolHome: string;

	beforeAll(async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-engineer-skills-"));
		teamRoot = path.join(scratch, "acme-team");
		dbPath = path.join(scratch, "team.db");
		process.env.ZETA_TEAM_DB = dbPath;
		const fixtureRepo = makeFixtureRepo(scratch, "api-base");

		await initTeam({ name: "Acme", root: teamRoot, dbPath });
		await addPm({ pm: "core", teamRoot, dbPath });
		await addPm({ pm: "other", teamRoot, dbPath });
		await addRepoLink({ repo: "api", path: fixtureRepo, teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "core", teamRoot, dbPath });
		await bindRepo({ repo: "api", pm: "other", teamRoot, dbPath });
		aliceHome = (await addEngineer({ name: "alice", pm: "core", repo: "api", teamRoot, dbPath })).worktree.path;
		bobHome = (await addEngineer({ name: "bob", pm: "other", repo: "api", teamRoot, dbPath })).worktree.path;
		carolHome = (await addEngineer({ name: "carol", pm: "core", repo: "api", teamRoot, dbPath })).worktree.path;
	}, 120_000);

	afterAll(() => {
		delete process.env.ZETA_TEAM_DB;
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
		} catch {
			// Windows may still hold a SQLite handle; the temp dir is disposable.
		}
	});

	function nativeSkill(name: string, level = "project"): Skill {
		return makeSkill(scratch, name, "native", level);
	}

	it("assigns an owned engineer's skill and records the assigning PM", () => {
		const skill = nativeSkill("review");
		const record = assignEngineerSkill({
			teamId: "acme",
			pmId: "acme:core",
			engineer: "alice",
			skill,
			dbPath,
		});
		expect(record).toMatchObject({
			teamId: "acme",
			pmId: "acme:core",
			engineerId: "acme:core:alice",
			skillName: "review",
			source: "native:project",
			qualifiedName: "native:review",
			assignedBy: "acme:core",
		});
		expect(record.createdAt).toBeGreaterThan(0);
		expect(loadEngineerAssignments("acme:core:alice", { dbPath }).map(row => row.skillName)).toEqual(["review"]);
	});

	it("rejects another PM's engineer, another PM, and the PM itself", () => {
		const skill = nativeSkill("review");
		expect(() => assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "bob", skill, dbPath })).toThrow(
			/another PM/,
		);
		expect(() =>
			assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "other", skill, dbPath }),
		).toThrow(/PM, not an engineer/);
		expect(() => assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "core", skill, dbPath })).toThrow(
			/PM, not an engineer/,
		);
		expect(() =>
			assignEngineerSkill({ teamId: "acme", pmId: "acme:other", engineer: "alice", skill, dbPath }),
		).toThrow(/another PM/);
	});

	it("requires the operator allowlist for plugin/registry skills", () => {
		const pluginSkill = makeSkill(scratch, "hooked", "zeta-plugins");
		expect(skillRisk(pluginSkill)).toBe("high");
		expect(() =>
			assignEngineerSkill({
				teamId: "acme",
				pmId: "acme:core",
				engineer: "alice",
				skill: pluginSkill,
				dbPath,
			}),
		).toThrow(/high-risk/);
		const record = assignEngineerSkill({
			teamId: "acme",
			pmId: "acme:core",
			engineer: "alice",
			skill: pluginSkill,
			allowlist: ["zeta-plugins:hooked"],
			dbPath,
		});
		expect(record.qualifiedName).toBe("zeta-plugins:hooked");
	});

	it("rejects duplicate and same-name different-source assignments", () => {
		const skill = nativeSkill("dupe");
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill, dbPath });
		expect(() =>
			assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill, dbPath }),
		).toThrow(/already assigned/);
		const sameName = makeSkill(scratch, "dupe", "custom");
		expect(() =>
			assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill: sameName, dbPath }),
		).toThrow(/from source "native:project"/);
	});

	it("removes an assignment and reports a missing one", () => {
		const skill = nativeSkill("remove-me");
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill, dbPath });
		const removed = removeEngineerSkill({
			teamId: "acme",
			pmId: "acme:core",
			engineer: "alice",
			skill: "remove-me",
			dbPath,
		});
		expect(removed?.qualifiedName).toBe("native:remove-me");
		expect(loadEngineerAssignments("acme:core:alice", { dbPath }).some(row => row.skillName === "remove-me")).toBe(
			false,
		);
		expect(
			removeEngineerSkill({
				teamId: "acme",
				pmId: "acme:core",
				engineer: "alice",
				skill: "remove-me",
				dbPath,
			}),
		).toBeNull();
	});

	it("rejects hidden/manual-only skills (no hidden injection)", () => {
		const hidden = { ...nativeSkill("hidden"), hide: true };
		expect(() =>
			assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill: hidden, dbPath }),
		).toThrow(/hidden or manual-only/);
	});

	it("resolves the engineer only inside its registered worktree", () => {
		expect(resolveEngineerSkillContext(aliceHome, { dbPath })).toMatchObject({
			teamId: "acme",
			pmId: "acme:core",
			engineerId: "acme:core:alice",
			engineerName: "alice",
			worktreePath: aliceHome,
		});
		expect(resolveEngineerSkillContext(path.join(aliceHome, "src"), { dbPath })?.engineerId).toBe("acme:core:alice");
		expect(resolveEngineerSkillContext(path.join(teamRoot, "pms", "core"), { dbPath })).toBeNull();
		expect(resolveEngineerSkillContext(teamRoot, { dbPath })).toBeNull();
		expect(resolveEngineerSkillContext(scratch, { dbPath })).toBeNull();
		expect(engineerSkillRoot("acme", "acme:core:alice", { dbPath })).toBe(aliceHome);
		expect(engineerSkillRoot("acme", "acme:other:bob", { dbPath })).toBe(bobHome);
	});

	it("injects assigned skills as hidden autoload messages, once per transcript", async () => {
		const review = nativeSkill("injected");
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill: review, dbPath });
		const { session, entries } = makeFakeSession(aliceHome, [review]);
		const first = await applyEngineerSkillAssignments(session, { dbPath });
		expect(first.applied).toContain("injected");
		const injectedEntry = entries.find(
			entry => entry.type === "custom_message" && entry.customType === "skill-prompt",
		);
		expect(injectedEntry?.type === "custom_message" ? injectedEntry.display : undefined).toBe(false);
		expect(injectedEntry?.type === "custom_message" ? injectedEntry.attribution : undefined).toBe("agent");
		expect(injectedEntry?.type === "custom_message" ? JSON.stringify(injectedEntry.details) : "").toContain(
			"injected",
		);

		const second = await applyEngineerSkillAssignments(session, { dbPath });
		expect(second.applied).toEqual([]);
		expect(second.alreadyLoaded).toContain("injected");
		expect(entries.filter(entry => entry.type === "custom_message")).toHaveLength(1);
	});

	it("applies a later assignment only through an explicit reload", async () => {
		const early = nativeSkill("early");
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill: early, dbPath });
		const late = nativeSkill("late");
		const { session, entries } = makeFakeSession(aliceHome, [early, late]);
		await applyEngineerSkillAssignments(session, { dbPath });
		const before = entries.length;
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "alice", skill: late, dbPath });
		expect(entries.length).toBe(before);
		const reloaded = await applyEngineerSkillAssignments(session, { dbPath });
		expect(reloaded.applied).toEqual(["late"]);
		expect(entries.length).toBe(before + 1);
	});

	it("skips an assignment whose skill is no longer discovered or no longer allowlisted", async () => {
		const plugin = makeSkill(scratch, "plugin-late", "zeta-plugins");
		assignEngineerSkill({
			teamId: "acme",
			pmId: "acme:core",
			engineer: "alice",
			skill: plugin,
			allowlist: ["zeta-plugins:plugin-late"],
			dbPath,
		});
		const { session } = makeFakeSession(aliceHome, [plugin], []);
		const result = await applyEngineerSkillAssignments(session, { dbPath });
		expect(result.blocked).toContain("zeta-plugins:plugin-late");

		const { session: missingSession } = makeFakeSession(aliceHome, []);
		const missing = await applyEngineerSkillAssignments(missingSession, { dbPath });
		expect(missing.missing.length).toBeGreaterThan(0);
	});

	it("does nothing outside an engineer worktree", async () => {
		const skill = nativeSkill("ignored");
		const { session, entries } = makeFakeSession(path.join(teamRoot, "pms", "core"), [skill]);
		const result = await applyEngineerSkillAssignments(session, { dbPath });
		expect(result.engineerId).toBeUndefined();
		expect(result.applied).toEqual([]);
		expect(entries).toEqual([]);
	});

	it("resolves ownership through the database row id too", () => {
		const db = new TeamDb(dbPath);
		try {
			expect(resolveOwnedEngineer(db, "acme", "acme:core", "acme:core:alice").name).toBe("alice");
			expect(skillQualifiedName(nativeSkill("qualified"))).toBe("native:qualified");
		} finally {
			db.close();
		}
	});

	it("lets a PM list, assign, and remove only through discovered names", async () => {
		const skillDir = path.join(carolHome, ".zeta", "skills", "tool-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"---\nname: tool-skill\ndescription: Tool test skill\n---\nbody\n",
		);
		const toolSession: ToolSession = {
			cwd: path.join(teamRoot, "pms", "core"),
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated({}),
		};
		const tool = new EngineerSkillsTool(toolSession);

		const listed = await tool.execute("1", { action: "list", engineer: "carol" });
		expect(listed.details?.available?.some(skill => skill.name === "tool-skill")).toBe(true);
		expect(listed.details?.available?.find(skill => skill.name === "tool-skill")?.approved).toBe(true);

		const assigned = await tool.execute("2", { action: "assign", engineer: "carol", skill: "tool-skill" });
		expect(assigned.details?.assigned?.qualifiedName).toBe("native:tool-skill");
		expect(assigned.details?.assigned?.assignedBy).toBe("acme:core");

		const removed = await tool.execute("3", { action: "remove", engineer: "carol", skill: "tool-skill" });
		expect(removed.details?.removed?.skillName).toBe("tool-skill");

		await expect(tool.execute("4", { action: "assign", engineer: "bob", skill: "tool-skill" })).rejects.toThrow(
			/another PM/,
		);
		await expect(tool.execute("5", { action: "assign", engineer: "carol", skill: "/etc/passwd" })).rejects.toThrow(
			/not discovered/,
		);
	});

	it("injects assignments at real session creation in an engineer worktree", async () => {
		const skill = nativeSkill("sdk-injected");
		assignEngineerSkill({ teamId: "acme", pmId: "acme:core", engineer: "carol", skill, dbPath });
		const agentDir = path.join(scratch, "agent-sdk");
		const authStorage = await AuthStorage.create(path.join(scratch, "auth-sdk.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(scratch, "models-sdk.yml"));
		const created = await createAgentSession({
			cwd: carolHome,
			agentDir,
			sessionManager: SessionManager.create(carolHome, path.join(scratch, "sessions-sdk"), new FileSessionStorage()),
			modelRegistry,
			settings: Settings.isolated({}),
			skills: [skill],
		});
		try {
			const injected = created.session.sessionManager
				.getEntries()
				.filter(
					(entry): entry is CustomMessageEntry =>
						entry.type === "custom_message" && entry.customType === "skill-prompt",
				);
			expect(injected).toHaveLength(1);
			expect(JSON.stringify(injected[0]?.details)).toContain("sdk-injected");
		} finally {
			await created.session.dispose();
			authStorage.close();
		}
	});
});
