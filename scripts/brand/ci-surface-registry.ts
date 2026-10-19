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
				job: "release_product_binaries",
				why: "bare zeta-ide binary build/upload for distribution repackaging; release_github preflight expects zeta-ide-* assets (the zeta-work-* legs left with the 1.3.0 TUI hold, the zeta-editor-* legs retired 2026-10-16)",
			},
			{
				job: "release_desktop_archives",
				why: "Zeta-only: packages the zetawork desktop app (Windows zip with the WebView2 loader, Linux .pkg.tar.zst + AppImage) from the product legs. It needs BOTH Linux legs, so it cannot live inside the matrix; release_github waits on it",
				job: "release_plugin_packages_manual",
				why: "Zeta-only: the plugin publish without the release gate, driven by the `publish_plugins` dispatch input. npm validates a trusted-publisher entry only through a real publish and its window is days wide; retries must not queue behind the 40-minute bazel chain. Mutually exclusive with release_plugin_packages",
			},
			{
				job: "web_ui_build",
				why: "Zeta-only web-ui pipeline job, absent upstream; silently lost in the squash-sync era (damage class 7)",
			},
			{
				job: "web_desktop_tests",
				why: "PR-path test job for the desktop contract suite + the CLI's Web UI launcher resolution (v1.2.1 shipped `npx zeta-web` 404 with the desktop adopting the corpse, because both live in release-only jobs); upstream has no counterpart, so a merge trimming ci.yml would re-open that hole",
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
				job: "release_main_packages",
				why: "Zeta-only workbench npm publish (@linxiraos/main + leaves) via main-publish.yml; restored with the 1.3.1 TUI re-ship after the 1.3.0 hold, and ordered after both companion lines so a release never publishes a workbench whose peers lag",
			},
			{
				job: "release_editor_packages",
				why: "Zeta-only editor package publish — the @linxiraos/editor distribution (the built-in editor's termide-editor payload, which took the name over from the retired TTT editor on 2026-10-17); v18.4.3 merge dropped it, breaking tag-triggered publishing (damage class 7 追记)",
			},
			{
				job: "termide_tests",
				why: "Zeta-only termide test bucket; v18.4.3 merge 7137261d83e silently dropped it (damage class 7 追记)",
			},
			{ job: "main_tests", why: "main test bucket" },
			{
				job: "release_ide_packages",
				why: "Zeta-only ide package publish (renamed from release_work_packages in 7d588b2503b; damage class 7 追记)",
			},
			{
				job: "release_plugin_packages",
				why: "Zeta-only official-plugin publish leg (@linxiraos/pi-messenger). Before it existed the plugin had no CI publish path at all: it was last shipped by hand via scripts/publish-missing-packages.ts, so the repo version (1.2.1) and the npm version (1.1.1) had drifted apart while the manifest kept advertising a publish that never happened. It packs the plugin directory as-authored rather than riding release_npm's workspace table, because that table's `typescript` kind emits declarations this source-shipped plugin cannot consume. Losing this job silently returns the plugin to the hand-publish regime",
			},
		],
		needsEdges: [
			{
				job: "release_github",
				needs: [
					"release_metadata",
					"release_gate",
					"release_binary",
					"release_product_binaries",
					"release_desktop_archives",
				],
				why: "damage class 10: every family the release uploads must be built and uploaded before the release is created (1.3.0: zeta-cli-* and zeta-ide-*)",
			},
			{
				job: "web_desktop_tests",
				needs: ["native_addons"],
				why: "the job's `bun test` legs import coding-agent modules whose import chain reaches the native addon; without the artifact wiring the legs die in the loader (first run of the job failed exactly there)",
			},
			{
				job: "release_plugin_packages",
				needs: ["release_metadata", "release_gate"],
				why: "same two edges as the other publish legs: is-release keeps the plugin off ordinary pushes, and release_gate is the release-state prerequisite (`check`'s guard steps must pass before anything publishes). No build-artifact edge: the plugin ships source, packed inside the job from the tagged tree, so there is no upload to race",
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
			{
				// The upstream build-server upload step must never come back: it is
				// permanently 403 for this fork (build.stencil.so accepts only the
				// upstream orgs can1357/stencil-hq), so a release run only fails
				// *after* npm has already shipped — v1.2.0 and v1.2.1 both reddened
				// this way. Zeta publishes binaries to its own GitHub Release only.
				// Neither token may appear anywhere in the workflow, comments
				// included: a comment is how the step's intent gets resurrected by
				// the next merge.
				scope: /ci-build-upload|build\.stencil\.so/,
				mustNotContain: [
					{
						needle: /ci-build-upload|build\.stencil\.so/,
						tag: "stencil-upload",
						why: "the fork has no build.stencil.so publish rights (permanent 403); the uploader step/script was removed 2026-10-14 (damage class 11)",
					},
				],
			},
		],
	},
	{
		file: ".github/workflows/editor-publish.yml",
		// Kept as a file and as this requirement: npm binds a trusted publisher
		// to the workflow FILE that runs the publish, so the editor leg must
		// keep its own dispatchable entry point (ci.yml's
		// release_editor_packages dispatches it and waits).
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
				why: "manual main-branch package publish path; must survive every merge like its ide sibling (damage class 7)",
			},
		],
		needsEdges: [],
		artifactRules: [],
	},
	{
		file: ".github/workflows/generated-freshness.yml",
		minJobs: 2,
		requiresAll: [
			{
				job: "bun_lock_freshness",
				why: "Zeta-only early-feedback gate for the generated nix/bun.nix (PR #181 shipped a stale expression and only the slow `Zeta Nix` flake job noticed). Upstream has no such workflow, so a merge that trims .github/workflows re-opens that gap (damage class 7)",
			},
			{
				job: "relay_assets_freshness",
				why: "same class for the committed browser-relay embeds (extension-assets/*.txt): nothing regenerated them outside the release job, so the copies drifted with only a license test noticing",
			},
		],
		needsEdges: [],
		artifactRules: [],
	},
];
