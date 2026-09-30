/**
 * CI release-surface registry — machine-checkable inventory of the Zeta CI
 * workflow jobs, needs wiring, and artifact-name rules that an OMP merge must
 * preserve.
 *
 * This is the mechanical form of AGENTS.md damage classes 7 (upstream CI
 * infrastructure merged wholesale: v18.4.3 merge 7137261d83e silently dropped
 * four Zeta-only jobs; the squash-sync era lost desktop_linux/desktop_windows/
 * web_ui_build and let upstream omp-* artifact names through) and 10
 * (release_github must not publish before desktop artifacts exist).
 *
 * brand-check.ts cannot cover this surface: its SCAN_EXT excludes .yml, and a
 * job inventory is structural, not a line-token problem. This file lives under
 * scripts/brand/ so it inherits that guard's SKIP_PREFIXES exemption (the omp-
 * literals below are the tokens the check asserts against, not brand residue).
 *
 * Enforcement: `bun scripts/check-ci-surface.ts`. Maintenance: every platform
 * trim, job rename, or artifact rename decision updates this registry in the
 * same PR — deleting rows to make the check pass is the failure mode it
 * exists to catch.
 */

export interface WorkflowSurface {
	/** Repo-relative workflow path. */
	file: string;
	/** Required job subset — not exhaustive: upstream may legally add jobs without a hit. */
	requiresAll: Array<{ job: string; why: string }>;
	/** needs-superset assertions: the job's `needs: [..]` must contain every listed dependency. */
	needsEdges: Array<{ job: string; needs: string[]; why: string }>;
	/** Line-scoped naming assertions (download/upload/checksum/runner lines). */
	artifactRules: Array<{
		/** Which lines the assertions apply to. */
		scope: RegExp;
		/** Optional positive assertion on the same scoped lines. */
		mustContain?: RegExp;
		mustNotContain: Array<{
			needle: RegExp;
			/** Exemption matched against the same line (container/temp/provenance names). */
			allow?: RegExp;
			/** Violation rule tag (default: artifact-name). */
			tag?: string;
			why: string;
		}>;
	}>;
	/** Job-count floor for this workflow (whole-file regression guard). */
	minJobs?: number;
}

/**
 * Hard floor: ci.yml must never fall below this many top-level jobs, and the
 * registry itself must never hold fewer required jobs (both checked by
 * scripts/check-ci-surface.ts, zeta-sentinels MIN floor style).
 */
export const MIN_CI_JOBS = 27;

export const CI_SURFACE: WorkflowSurface[] = [
	{
		file: ".github/workflows/ci.yml",
		minJobs: MIN_CI_JOBS,
		requiresAll: [
			{
				job: "release_metadata",
				why: "release chain head: every downstream job keys on its is-release/release-tag outputs",
			},
			{
				job: "check",
				why: "lint/type-check/web-build gate job (damage class 7: upstream CI rewrites must keep the Zeta check surface)",
			},
			{
				job: "bazel_lock",
				why: "bazel lockfile freshness gate; Cargo.lock repairs depend on it (damage class 7: upstream rewrites dropped it)",
			},
			{
				job: "rust_validate",
				why: "rustfmt/clippy/test gate; the triage fingerprint relies on its exit-1 vs exit-3 split",
			},
			{
				job: "native_addons",
				why: "zeta natives binary builder; every binary/smoke/release job consumes its artifacts",
			},
			{
				job: "native_addons_cross",
				why: "cross-compiled natives matrix; losing it silently narrows the release binary matrix",
			},
			{
				job: "test_workspace",
				why: "workspace test bucket (damage class 7: test contracts are the only guard for Zeta-only registration blocks)",
			},
			{
				job: "test_coding_agent_singleton",
				why: "singleton bucket hosts the official-skills provider sentinels (v18.4.3 damage class 4 detection)",
			},
			{ job: "test_ts_native", why: "natives bindings test bucket" },
			{ job: "test_coding_agent_ui", why: "coding-agent UI test bucket" },
			{ job: "test_coding_agent_runtime", why: "coding-agent runtime test bucket" },
			{ job: "test_coding_agent_native", why: "coding-agent natives test bucket" },
			{ job: "test_smoke", why: "smoke bucket" },
			{ job: "install_methods", why: "install-methods bucket; verifies the documented install surface" },
			{ job: "release_gate", why: "release aggregation gate; release_github/release_npm key on its result" },
			{
				job: "release_binary",
				why: "primary zeta binary build/upload; feeds release_github checksums and installer assets",
			},
			{
				job: "web_ui_build",
				why: "Zeta-only web-ui pipeline job, absent upstream; silently lost in the squash-sync era (damage class 7)",
			},
			{
				job: "desktop_linux",
				why: "Zeta-only desktop Linux packaging; release_github preflight expects zeta-desktop-* assets (damage classes 7+10)",
			},
			{
				job: "desktop_windows",
				why: "Zeta-only desktop Windows packaging; release_github preflight expects zeta-desktop-* assets (damage classes 7+10)",
			},
			{
				job: "release_native_leaves",
				why: "publishes the @linxiraos native leaf packages (upstream has no counterpart)",
			},
			{
				job: "release_github",
				why: "GitHub release assembly; the desktop-asset preflight lives here (damage class 10)",
			},
			{ job: "release_npm", why: "npm publish of the zeta CLI package" },
			{
				job: "editor_tests",
				why: "Zeta-only editor test bucket; v18.4.3 merge 7137261d83e silently dropped it (damage class 7 追记)",
			},
			{
				job: "termide_tests",
				why: "Zeta-only termide test bucket; v18.4.3 merge 7137261d83e silently dropped it (damage class 7 追记)",
			},
			{ job: "main_tests", why: "main test bucket" },
			{
				job: "release_editor_packages",
				why: "Zeta-only editor package publish; v18.4.3 merge dropped it, breaking tag-triggered publishing (damage class 7 追记)",
			},
			{
				job: "release_ide_packages",
				why: "Zeta-only ide package publish (renamed from release_work_packages in 7d588b2503b; damage class 7 追记)",
			},
			{
				job: "release_main_packages",
				why: "Zeta-only workbench package publish; wired 2026-09-30 after npm trusted publishing was configured for main-publish.yml (manual 1.1.21 bootstrap preceded)",
			},
		],
		needsEdges: [
			{
				job: "release_github",
				needs: ["release_metadata", "release_gate", "release_binary", "desktop_linux", "desktop_windows"],
				why: "damage class 10: publishing before the desktop jobs upload yields 0 zeta-desktop-* installer assets",
			},
			{
				job: "desktop_linux",
				needs: ["release_metadata", "native_addons"],
				why: "desktop packaging consumes release detection and the zeta natives binaries",
			},
			{
				job: "desktop_windows",
				needs: ["release_metadata", "native_addons"],
				why: "desktop packaging consumes release detection and the zeta natives binaries",
			},
		],
		artifactRules: [
			{
				// Download/upload/checksum declarations: binary_path:, pattern:, path:.
				scope: /\b(?:binary_path|pattern|path):/,
				mustNotContain: [
					{
						needle: /omp-(binary|darwin|windows|linux|cli)-/,
						allow: /\/usr\/local\/bin\/omp|omp-smoke|omp-pack|can1357|ci-macos-sign/,
						why: "release artifacts must carry zeta-cli-*/zeta-binary-*/zeta-desktop-* names — upstream omp-* names overwrite Zeta assets (damage class 7; squash-sync lesson)",
					},
				],
			},
			{
				// Runner-label ban. brand-check has the same token in MUST_NOT_CONTAIN
				// but its SCAN_EXT never sees .yml files, so this scoped rule is the
				// only one that actually reads ci.yml.
				scope: /\bruns-on:/,
				mustNotContain: [
					{
						needle: /omp-kata/,
						allow: /not omp-kata/,
						tag: "runner-label",
						why: "upstream self-hosted runner label never resolves in this repo and stalls release jobs (damage class 7)",
					},
				],
			},
		],
	},
	{
		file: ".github/workflows/editor-publish.yml",
		requiresAll: [
			{
				job: "publish",
				why: "manual editor re-publish path; the v18.4.3 ci.yml outage was survivable only because this workflow survived (damage class 7 追记)",
			},
		],
		needsEdges: [],
		artifactRules: [],
	},
	{
		file: ".github/workflows/ide-publish.yml",
		requiresAll: [
			{
				job: "publish",
				why: "manual ide package re-publish path (ide rename round); sole recovery channel when the tag-triggered chain breaks (damage class 7 追记)",
			},
		],
		needsEdges: [],
		artifactRules: [],
	},
	{
		file: ".github/workflows/main-publish.yml",
		requiresAll: [
			{
				job: "publish",
				why: "manual main-branch package publish path; must survive every merge like its editor/ide siblings (damage class 7)",
			},
		],
		needsEdges: [],
		artifactRules: [],
	},
];
