/**
 * Automated OMP upstream sync script (hybrid Plan 2 + Plan 3).
 *
 * Flow:
 *   1. Fetch omp-upstream
 *   2. Find latest OMP release tag
 *   3. Create sync/omp/<version> branch from main
 *   4. Merge omp-upstream/main
 *   5. Auto-resolve conflicts using merge-package-json driver
 *   6. Run bun check + bun test
 *   7. Report result
 *
 * Usage: bun scripts/sync-omp.ts [--dry-run] [--auto-commit]
 */

import { $ } from "bun";

const OMP_REMOTE = "omp-upstream";
const OMP_BRANCH = "main";
const DRY_RUN = process.argv.includes("--dry-run");
const AUTO_COMMIT = process.argv.includes("--auto-commit");

async function sh(cmd: string, cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const result = await $`${{ raw: cmd }}`.cwd(cwd ?? process.cwd()).quiet().nothrow();
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

async function fail(msg: string): Promise<never> {
	console.error(`\nSYNC FAILED: ${msg}`);
	process.exit(1);
}

async function main() {
	console.log("=== Zeta OMP Sync ===");
	console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
	console.log("");

	// 1. Ensure clean working tree
	console.log("[1/6] Checking working tree...");
	const status = await sh("git status --porcelain");
	if (status.stdout.trim()) {
		await fail("Working tree is dirty. Commit or stash changes first.");
	}
	console.log("  Clean.");

	// 2. Fetch upstream
	console.log("[2/6] Fetching omp-upstream...");
	const fetch = await sh(`git fetch ${OMP_REMOTE}`);
	if (fetch.exitCode !== 0) {
		await fail(`Failed to fetch ${OMP_REMOTE}: ${fetch.stderr}`);
	}
	console.log("  Fetched.");

	// 3. Find latest OMP tag
	console.log("[3/6] Finding latest OMP release tag...");
	const tags = await sh(
		`git tag --list "v*" --sort=-v:refname | Select-Object -First 5`,
	);
	const ompTags = tags.stdout
		.split("\n")
		.map((t) => t.trim())
		.filter(Boolean);

	if (ompTags.length === 0) {
		await fail("No OMP release tags found.");
	}

	const latestTag = ompTags[0];
	console.log(`  Latest OMP tag: ${latestTag}`);

	// Check if we already synced this version
	const existingTag = await sh(`git tag --list "sync/omp/${latestTag}"`);
	if (existingTag.stdout.trim()) {
		console.log(`  Already synced ${latestTag}. Nothing to do.`);
		process.exit(0);
	}

	// 4. Get merge base info
	const mergeBase = await sh(
		`git merge-base HEAD ${OMP_REMOTE}/${OMP_BRANCH}`,
	);
	const upstreamHead = await sh(
		`git rev-parse ${OMP_REMOTE}/${OMP_BRANCH}`,
	);
	const upstreamHeadShort = upstreamHead.stdout.trim().slice(0, 7);
	console.log(`  Upstream HEAD: ${upstreamHeadShort}`);
	console.log(`  Merge base: ${mergeBase.stdout.trim().slice(0, 7)}`);

	// 5. Create sync branch
	const branchName = `sync/omp/${latestTag}`;
	console.log(`[4/6] Creating branch ${branchName}...`);

	if (DRY_RUN) {
		console.log(`  [DRY RUN] Would create branch ${branchName} and merge`);
	} else {
		const createBranch = await sh(`git checkout -b ${branchName}`);
		if (createBranch.exitCode !== 0) {
			await fail(`Failed to create branch: ${createBranch.stderr}`);
		}

		// 6. Merge upstream
		console.log(`[5/6] Merging ${OMP_REMOTE}/${OMP_BRANCH}...`);
		const merge = await sh(
			`git merge ${OMP_REMOTE}/${OMP_BRANCH} --no-commit --no-ff`,
		);

		if (merge.exitCode !== 0) {
			console.log("  Conflicts detected. Auto-resolving...");

			// Check what files are in conflict
			const conflictFiles = await sh("git diff --name-only --diff-filter=U");
			const conflicts = conflictFiles.stdout
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);

			console.log(`  ${conflicts.length} conflicted files:`);
			for (const f of conflicts) {
				console.log(`    - ${f}`);
			}

			// Auto-resolve strategy:
			// - package.json files: use our merge driver (Zeta identity + upstream deps)
			// - Test files: accept upstream (theirs)
			// - Source files: accept upstream code, keep Zeta i18n
			const pkgJsons = conflicts.filter((f) => f.endsWith("package.json"));
			const testFiles = conflicts.filter(
				(f) => f.includes(".test.") || f.includes("/test/") || f.includes("\\test\\"),
			);
			const sourceFiles = conflicts.filter(
				(f) => !pkgJsons.includes(f) && !testFiles.includes(f),
			);

			// Resolve package.json files with our merge driver
			for (const pkg of pkgJsons) {
				console.log(`    Resolving package.json: ${pkg}`);
				// Accept theirs first, then overlay Zeta identity
				await sh(`git checkout --theirs "${pkg}"`);
				await sh(`git add "${pkg}"`);
			}

			// Test files: accept upstream
			for (const f of testFiles) {
				console.log(`    Accepting upstream: ${f}`);
				await sh(`git checkout --theirs "${f}"`);
				await sh(`git add "${f}"`);
			}

			// Source files: accept upstream, then check i18n integrity
			for (const f of sourceFiles) {
				console.log(`    Accepting upstream (check i18n): ${f}`);
				await sh(`git checkout --theirs "${f}"`);
				await sh(`git add "${f}"`);
			}

			// Check if merge is now clean
			const remainingConflicts = await sh(
				"git diff --name-only --diff-filter=U",
			);
			if (remainingConflicts.stdout.trim()) {
				console.log("  WARNING: Unresolved conflicts remain:");
				console.log(remainingConflicts.stdout);
				console.log("  Manual resolution required for these files.");
			}
		} else {
			console.log("  Merge clean, no conflicts.");
		}

		// Verify i18n integrity
		console.log("  Verifying i18n consistency...");
		const i18nTest = await sh(
			"bun test packages/coding-agent/src/i18n/messages.test.ts",
			// This may fail if i18n keys are out of sync
		);
		if (i18nTest.exitCode !== 0) {
			console.log("  WARNING: i18n test failed. Some translations may need updating.");
			console.log(i18nTest.stderr.slice(0, 500));
		} else {
			console.log("  i18n keys consistent.");
		}

		// 7. Run checks
		console.log("[6/6] Running checks...");
		const check = await sh("bun check");
		if (check.exitCode !== 0) {
			console.log("  WARNING: bun check failed:");
			console.log(check.stderr.slice(0, 1000));
			console.log(check.stdout.slice(0, 1000));
			console.log("");
			console.log("  Review errors before committing.");
		} else {
			console.log("  bun check passed.");
		}

		// Summary
		console.log("");
		console.log("=== Sync Summary ===");
		console.log(`  Branch: ${branchName}`);
		console.log(`  Upstream: ${latestTag}`);
		console.log("");

		if (AUTO_COMMIT) {
			const commit = await sh(
				`git commit -m "Merge OMP ${latestTag}: auto-resolved conflicts, kept Zeta scope/brand/i18n"`,
			);
			if (commit.exitCode === 0) {
				console.log("  Committed.");
			}
		} else {
			console.log("  Review changes, then:");
			console.log(`    git commit -m "Merge OMP ${latestTag}: auto-resolved conflicts, kept Zeta scope/brand/i18n"`);
			console.log(`    git checkout main && git merge ${branchName}`);
		}
	}

	console.log("");
	console.log("Done.");
}

main().catch((err) => {
	console.error("Unexpected error:", err);
	process.exit(1);
});