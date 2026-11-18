#!/usr/bin/env bun
/**
 * Stable release eligibility and historical tag handling (ADR 0072).
 *
 *   1.5.1              previously published npm baseline
 *   1.5.2 … 1.5.9      annotated code-only tags (1.5.2 has an assets-only exception)
 *   1.5.10 and later   normal public releases (ADR 0072)
 *
 * The historical assets-only review still requires its original override.
 * Public tags continue through the standard scope and source CI gates.
 *
 * Override (owner-approved, auditable):
 *   ZETA_RELEASE_OVERRIDE_VERSION=1.5.2
 *   ZETA_RELEASE_OVERRIDE_REASON="<why this release is approved>"
 *
 * In GitHub Actions the values come from the `release_override_version` /
 * `release_override_reason` dispatch inputs or the repository variables
 * `RELEASE_FREEZE_OVERRIDE_VERSION` / `RELEASE_FREEZE_OVERRIDE_REASON`
 * (variable changes land in the org audit log).
 *
 * CLI:
 *   bun scripts/release-policy.ts decide --version 1.5.2 [--json] [--github-output]
 *   bun scripts/release-policy.ts assert-release --version 1.5.2
 *   bun scripts/release-policy.ts assert-publish --version 1.5.2
 *   bun scripts/release-policy.ts assert-assets --version 1.5.2
 *
 * `decide` never fails for a denied action (builds must keep running);
 * the `assert-*` commands exit 1 when their action is denied.
 */
import { compareVersions } from "../packages/utils/src/version";

export const RELEASE_FREEZE = {
	/** Historical internal build line. */
	frozenLine: "1.5",
	/** First internal build tag on the frozen line (1.5.1 is the public version). */
	internalBuildMin: "1.5.2",
	/** First version on the restored public release line (ADR 0072). */
	nextPublicVersion: "1.5.10",
	/** Exact 1.5.x version the owner may release as GitHub assets only (ADR 0033). */
	assetReviewVersion: "1.5.2",
} as const;

/** Mandatory marker in an internal build tag annotation. */
export const INTERNAL_BUILD_MARKER = "高速迭代 / 内部构建 / 不发布资产";

export type ReleaseChannel = "internal-build" | "public" | "invalid";

export interface PublishPolicyDecision {
	/** Normalized bare version (`v` stripped), or null when unparseable. */
	version: string | null;
	channel: ReleaseChannel;
	/** May an annotated tag be created (and pushed) for this version? */
	tagAllowed: boolean;
	/** May npm packages be published for this version? */
	publishAllowed: boolean;
	/** May GitHub Release assets be uploaded for this version? */
	assetsAllowed: boolean;
	requiresOverride: boolean;
	overrideApplied: boolean;
	reason: string;
}

export interface PublishPolicyInput {
	version: string;
	overrideVersion?: string | null;
	overrideReason?: string | null;
}

interface ParsedReleaseVersion {
	version: string;
	major: number;
	minor: number;
	patch: number;
	prerelease: string | null;
}

const STRICT_VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Strict semver core parse (leading `v` allowed). Returns null for anything else. */
export function parseReleaseVersion(input: string): ParsedReleaseVersion | null {
	const match = STRICT_VERSION.exec(input.trim());
	if (!match) return null;
	const [, major, minor, patch, prerelease] = match;
	return {
		version: `${Number(major)}.${Number(minor)}.${Number(patch)}`,
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
		prerelease: prerelease ?? null,
	};
}

function denied(version: string | null, channel: ReleaseChannel, reason: string): PublishPolicyDecision {
	return {
		version,
		channel,
		tagAllowed: false,
		publishAllowed: false,
		assetsAllowed: false,
		requiresOverride: false,
		overrideApplied: false,
		reason,
	};
}

/**
 * Classify a version against the freeze. `internal-build` covers the planned
 * historical 1.5.2–1.5.9 tag range. Stable releases at or above 1.5.10
 * use the normal public path.
 */
export function classifyReleaseVersion(input: string): PublishPolicyDecision {
	const parsed = parseReleaseVersion(input);
	if (!parsed) {
		return denied(
			null,
			"invalid",
			`"${input}" is not an explicit stable semver (X.Y.Z); prereleases/build metadata are not release-taggable`,
		);
	}
	if (parsed.prerelease) {
		return denied(
			parsed.version,
			"invalid",
			`${parsed.version}-${parsed.prerelease} is a prerelease; the freeze only considers stable versions`,
		);
	}
	if (
		parsed.major === 1 &&
		parsed.minor === 5 &&
		compareVersions(parsed.version, RELEASE_FREEZE.nextPublicVersion) < 0
	) {
		if (compareVersions(parsed.version, RELEASE_FREEZE.internalBuildMin) < 0) {
			return denied(
				parsed.version,
				"internal-build",
				`${parsed.version} is already released; 1.5.1 is the current public version and is not re-tagged`,
			);
		}
		return {
			version: parsed.version,
			channel: "internal-build",
			tagAllowed: true,
			publishAllowed: false,
			assetsAllowed: false,
			requiresOverride: false,
			overrideApplied: false,
			reason: `${parsed.version} is an internal build tag (${RELEASE_FREEZE.frozenLine}): code-only, no assets, no npm publish`,
		};
	}
	if (compareVersions(parsed.version, RELEASE_FREEZE.nextPublicVersion) < 0) {
		return denied(
			parsed.version,
			"internal-build",
			`${parsed.version} is below the first public version ${RELEASE_FREEZE.nextPublicVersion}; it never tags or publishes`,
		);
	}
	return {
		version: parsed.version,
		channel: "public",
		tagAllowed: true,
		publishAllowed: true,
		assetsAllowed: true,
		requiresOverride: false,
		overrideApplied: false,
		reason: `${parsed.version} is a stable public release`,
	};
}

/** Resolve the release decision, including the owner override. */
export function evaluatePublishPolicy(input: PublishPolicyInput): PublishPolicyDecision {
	const decision = classifyReleaseVersion(input.version);
	// One owner-review release may upload GitHub assets without npm: exact
	// version (ADR 0033), exact matching override, non-empty audit reason.
	if (
		decision.channel === "internal-build" &&
		decision.version === RELEASE_FREEZE.assetReviewVersion &&
		decision.tagAllowed
	) {
		const overrideVersion = input.overrideVersion?.trim();
		const overrideReason = input.overrideReason?.trim();
		if (!overrideVersion) {
			return {
				...decision,
				requiresOverride: true,
				reason: `${decision.version} is code-only by default; set an exact owner-review override to allow GitHub assets (npm remains disabled)`,
			};
		}
		const parsedOverride = parseReleaseVersion(overrideVersion);
		if (parsedOverride?.prerelease || parsedOverride?.version !== decision.version) {
			return {
				...decision,
				requiresOverride: true,
				reason: `${decision.reason}; asset-review override must name the exact stable ${decision.version}, not ${overrideVersion}`,
			};
		}
		if (!overrideReason) {
			return {
				...decision,
				requiresOverride: true,
				reason: `${decision.reason}; asset-review override for ${decision.version} has no audit reason`,
			};
		}
		return {
			...decision,
			channel: "public",
			tagAllowed: true,
			publishAllowed: false,
			assetsAllowed: true,
			requiresOverride: true,
			overrideApplied: true,
			reason: `${decision.version} is an owner-review GitHub-assets release; npm publish remains disabled: ${overrideReason}`,
		};
	}
	return decision;
}

/** Read the override from the environment (shared by release scripts and CI). */
export function overrideFromEnv(env: Record<string, string | undefined> = process.env): {
	overrideVersion: string | null;
	overrideReason: string | null;
} {
	return {
		overrideVersion: env.ZETA_RELEASE_OVERRIDE_VERSION ?? null,
		overrideReason: env.ZETA_RELEASE_OVERRIDE_REASON ?? null,
	};
}

export function evaluateFromEnv(version: string, env: Record<string, string | undefined> = process.env) {
	return evaluatePublishPolicy({ version, ...overrideFromEnv(env) });
}

/** Annotated tag message for an internal build tag. */
export function internalBuildTagMessage(version: string): string {
	return [
		`Zeta ${version} — ${INTERNAL_BUILD_MARKER}`,
		"",
		"内部高速迭代构建：仅包含源代码（tag 指向代码提交）。",
		"不发布 npm 包、不生成 GitHub Release 资产、不提供安装包或二进制。",
		"Internal build only: code-only tag. No npm publish, no release assets,",
		"no installers or binaries are produced for this version.",
	].join("\n");
}

/** Throw when the version may not be tagged; used by `scripts/release-v2.ts`. */
export function assertTagAllowed(
	version: string,
	env: Record<string, string | undefined> = process.env,
): PublishPolicyDecision {
	const decision = evaluateFromEnv(version, env);
	if (decision.tagAllowed) return decision;
	throw new Error(`release freeze: refusing to tag ${decision.version ?? version}.\n  ${decision.reason}`);
}

/** Throw when the version may not publish to npm; used by every publish entry point. */
export function assertPublishAllowed(version: string, env: Record<string, string | undefined> = process.env): void {
	const decision = evaluateFromEnv(version, env);
	if (decision.publishAllowed) return;
	throw new Error(`release freeze: refusing to publish ${decision.version ?? version}.\n  ${decision.reason}`);
}

/** Throw when the version may not upload GitHub Release assets. */
export function assertAssetsAllowed(version: string, env: Record<string, string | undefined> = process.env): void {
	const decision = evaluateFromEnv(version, env);
	if (decision.assetsAllowed) return;
	throw new Error(
		`release freeze: refusing to upload release assets for ${decision.version ?? version}.\n  ${decision.reason}`,
	);
}

// =============================================================================
// CLI
// =============================================================================

function argValue(args: string[], flag: string): string | null {
	const withEquals = args.find(arg => arg.startsWith(`${flag}=`));
	if (withEquals) return withEquals.slice(flag.length + 1);
	const index = args.indexOf(flag);
	return index === -1 ? null : (args[index + 1] ?? null);
}

async function emitGithubOutputs(decision: PublishPolicyDecision): Promise<void> {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) return;
	const lines = [
		`tag-allowed=${decision.tagAllowed}`,
		`publish-allowed=${decision.publishAllowed}`,
		`assets-allowed=${decision.assetsAllowed}`,
		`release-channel=${decision.channel}`,
		`policy-reason=${decision.reason.replace(/\r?\n/g, " ")}`,
	];
	await Bun.write(outputPath, `${lines.join("\n")}\n`, { createPath: true });
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const command = args[0] ?? "decide";
	const version = argValue(args, "--version");
	if (!version) {
		console.error(
			"usage: bun scripts/release-policy.ts <decide|assert-release|assert-publish|assert-assets> --version X.Y.Z",
		);
		process.exit(2);
	}
	const decision = evaluateFromEnv(version);

	if (command === "decide") {
		if (args.includes("--json")) console.log(JSON.stringify(decision, null, 2));
		else {
			console.log(`release-policy: ${decision.version ?? version} -> ${decision.channel}`);
			console.log(`  tag-allowed: ${decision.tagAllowed}`);
			console.log(`  publish-allowed: ${decision.publishAllowed}`);
			console.log(`  assets-allowed: ${decision.assetsAllowed}`);
			console.log(`  ${decision.reason}`);
		}
		if (args.includes("--github-output")) await emitGithubOutputs(decision);
		// A denied action is data, not a failure: builds must keep running.
		process.exit(0);
	}

	const actions = {
		"assert-release": { allowed: decision.tagAllowed, verb: "tag/release" },
		"assert-publish": { allowed: decision.publishAllowed, verb: "publish" },
		"assert-assets": { allowed: decision.assetsAllowed, verb: "upload release assets for" },
	} as const;
	const action = actions[command as keyof typeof actions];
	if (!action) {
		console.error(`unknown command "${command}" (expected decide|assert-release|assert-publish|assert-assets)`);
		process.exit(2);
	}
	if (action.allowed) {
		console.log(`release-policy: ${decision.version} may ${action.verb} — ${decision.reason}`);
		process.exit(0);
	}
	console.error(`release freeze: refusing to ${action.verb} ${decision.version ?? version}.`);
	console.error(`  ${decision.reason}`);
	process.exit(1);
}
