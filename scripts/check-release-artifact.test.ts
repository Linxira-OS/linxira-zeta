import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const checker = resolve(import.meta.dir, "check-release-artifact.ts");
const commit = "1234567890abcdef1234567890abcdef12345678";
const olderCommit = "abcdef1234567890abcdef1234567890abcdef12";
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function artifact(stdout: string, exitCode = 0): Promise<{ dir: string; path: string }> {
	const dir = await mkdtemp(join(tmpdir(), "zeta-build-marker-"));
	directories.push(dir);
	const path = join(dir, "cli.js");
	await writeFile(path, `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${exitCode};\n`);
	return { dir, path };
}

function check(path: string, args: string[] = [], cwd = import.meta.dir, extraEnv: Record<string, string> = {}) {
	const env = { ...process.env };
	delete env.GITHUB_SHA;
	delete env.ZETA_EXPECTED_COMMIT;
	Object.assign(env, extraEnv);
	const result = Bun.spawnSync([process.execPath, checker, "--path", path, ...args], {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

describe("built artifact provenance gate (REQ-036)", () => {
	test("executes the artifact and accepts its matching embedded commit", async () => {
		const built = await artifact(`smoke-test: ok\nbuild-commit: ${commit}\n`);
		const result = check(built.path, ["--expect-commit", commit]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain(`build-commit ${commit} matches ${commit}`);
	});

	test("refuses an older dist even when its smoke test succeeds", async () => {
		const built = await artifact(`smoke-test: ok\nbuild-commit: ${olderCommit}\n`);
		const result = check(built.path, ["--expect-commit", commit]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain(`was built from ${olderCommit}, expected ${commit}`);
	});

	test.each(["", "build-commit: unknown\n"])(
		"refuses a missing or unknown marker in release mode (%s)",
		async marker => {
			const built = await artifact(`smoke-test: ok\n${marker}`);
			const result = check(built.path, ["--expect-commit", commit, "--allow-unknown"]);
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("must name its source commit");
		},
	);

	test("does not accept a marker when the artifact smoke test fails", async () => {
		const built = await artifact(`smoke-test: ok\nbuild-commit: ${commit}\n`, 7);
		const result = check(built.path, ["--expect-commit", commit]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("--smoke-test exited 7");
	});

	test("prepack honors the release build's expected commit even without git metadata", async () => {
		const built = await artifact(`smoke-test: ok\nbuild-commit: ${olderCommit}\n`);
		const result = check(built.path, ["--allow-unknown"], built.dir, { ZETA_EXPECTED_COMMIT: commit });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain(`expected ${commit}`);
	});

	test("allows unknown provenance only in an explicitly permitted git-less install", async () => {
		const built = await artifact("smoke-test: ok\nbuild-commit: unknown\n");
		expect(check(built.path, ["--allow-unknown"], built.dir).exitCode).toBe(0);
		expect(check(built.path, [], built.dir).exitCode).toBe(1);
	}, 20_000);

	test("a git-less pack cannot use allow-unknown to accept a markerless old bundle", async () => {
		const built = await artifact("smoke-test: ok\n");
		const result = check(built.path, ["--allow-unknown"], built.dir);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("build-commit (missing)");
	}, 20_000);

	test("missing staged output fails unless the caller explicitly permits its absence", async () => {
		const built = await artifact("");
		const missing = join(built.dir, "absent.js");
		expect(check(missing, ["--staged"]).exitCode).toBe(1);
		expect(check(missing, ["--staged", "--if-exists"]).exitCode).toBe(0);
	});
});
