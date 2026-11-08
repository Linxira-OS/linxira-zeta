import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getAppName,
	getCommitCacheDbPath,
	getGithubCacheDbPath,
	getJudgmentCacheDbPath,
} from "@linxiraos/pi-utils/dirs";

const ENV_KEYS = [
	"ZETA_GITHUB_CACHE_DB",
	"OMP_GITHUB_CACHE_DB",
	"ZETA_COMMIT_CACHE_DB",
	"OMP_COMMIT_CACHE_DB",
	"ZETA_JUDGMENT_CACHE_DB",
	"OMP_JUDGMENT_CACHE_DB",
	"ZETA_APP_NAME",
	"OMP_APP_NAME",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = {};
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("cache DB path env overrides", () => {
	test("ZETA_GITHUB_CACHE_DB sets the GitHub view cache path", () => {
		process.env.ZETA_GITHUB_CACHE_DB = "/tmp/zeta-github.db";
		expect(getGithubCacheDbPath()).toBe("/tmp/zeta-github.db");
	});

	test("OMP_GITHUB_CACHE_DB is read as the pre-rename alias", () => {
		process.env.OMP_GITHUB_CACHE_DB = "/tmp/omp-github.db";
		expect(getGithubCacheDbPath()).toBe("/tmp/omp-github.db");
	});

	test("ZETA_GITHUB_CACHE_DB wins when both spellings are set", () => {
		process.env.ZETA_GITHUB_CACHE_DB = "/tmp/zeta-github.db";
		process.env.OMP_GITHUB_CACHE_DB = "/tmp/omp-github.db";
		expect(getGithubCacheDbPath()).toBe("/tmp/zeta-github.db");
	});

	test("commit inference cache honors both spellings", () => {
		process.env.OMP_COMMIT_CACHE_DB = "/tmp/omp-commit.db";
		expect(getCommitCacheDbPath()).toBe("/tmp/omp-commit.db");
		process.env.ZETA_COMMIT_CACHE_DB = "/tmp/zeta-commit.db";
		expect(getCommitCacheDbPath()).toBe("/tmp/zeta-commit.db");
	});

	test("judgment cache honors both spellings", () => {
		process.env.OMP_JUDGMENT_CACHE_DB = "/tmp/omp-judgment.db";
		expect(getJudgmentCacheDbPath()).toBe("/tmp/omp-judgment.db");
		process.env.ZETA_JUDGMENT_CACHE_DB = "/tmp/zeta-judgment.db";
		expect(getJudgmentCacheDbPath()).toBe("/tmp/zeta-judgment.db");
	});
});

describe("usage attribution app name", () => {
	test("defaults to zeta", () => {
		expect(getAppName()).toBe("zeta");
	});

	test("ZETA_APP_NAME wins over the OMP_APP_NAME alias", () => {
		process.env.OMP_APP_NAME = "legacy-bot";
		expect(getAppName()).toBe("legacy-bot");
		process.env.ZETA_APP_NAME = "robomp";
		expect(getAppName()).toBe("robomp");
	});
});
