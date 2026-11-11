/**
 * Build provenance for the coding-agent artifact (REQ-036).
 *
 * A local `dist/cli.js` must not be able to masquerade as a release build: the
 * bundler/compiler embeds the source commit, `--smoke-test` prints it back, and
 * release checks compare the value read from the artifact with the commit the
 * release was cut from. Unknown is allowed at runtime (npm/git-less installs
 * stay usable); only the release check refuses it.
 */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Resolve the commit to embed: explicit env wins, then git HEAD, else unknown. */
export function resolveBuildCommit(root: string): string {
	const explicit = process.env.ZETA_BUILD_COMMIT?.trim();
	if (explicit && COMMIT_PATTERN.test(explicit)) return explicit;
	const result = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.success) {
		const sha = result.stdout.toString().trim();
		if (COMMIT_PATTERN.test(sha)) return sha;
	}
	return "unknown";
}

/**
 * Fail the build when CI expects a specific commit and the tree does not
 * resolve to it. Local builds without `ZETA_EXPECTED_COMMIT` stay allowed.
 */
export function assertExpectedBuildCommit(commit: string): void {
	const expected = process.env.ZETA_EXPECTED_COMMIT?.trim();
	if (!expected) return;
	if (commit.toLowerCase() !== expected.toLowerCase()) {
		throw new Error(
			`refusing to build a release artifact for ${expected}: the tree resolves to ${commit}. ` +
				"A stale local checkout/dist must not masquerade as this release (REQ-036).",
		);
	}
}
