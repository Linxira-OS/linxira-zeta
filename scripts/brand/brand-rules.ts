/**
 * Zeta brand-surface rule table — the single source of truth for what the
 * brand overlay may rewrite and what the CI guard enforces.
 *
 * Every rule carries a one-line rationale. Merge procedure: after a complete
 * OMP tag merge, run `bun scripts/brand/brand-overlay.ts` (apply) on the sync
 * branch, resolve the judgment-call hits by hand, then `brand-check.ts` must
 * exit 0 before the branch can merge. The tables below encode the v18.1.10
 * merge census; extend them whenever a new marker class appears.
 */

/** Path prefixes (repo-relative, forward slashes) never scanned. */
export const SKIP_PREFIXES = [
	"web-ui/", // separate OMP Web snapshot with its own AGENTS.md
	"temp/", // local reference clones, never committed
	"document/", // internal docs: upstream provenance lives here by design
	"docs/", // runtime docs may reference upstream interop surfaces
	"python/", // robomp harness: OMP-native by design; brand decision tracked separately
	"AGENTS.md", // the registry prose itself discusses the tokens
	"UPDATE-LOG.md", // released entries are immutable history
	"crates/vendor/", // vendored upstream code
	"crates/pi-natives/tools/cache/", // tokenizer vocab dumps (byte soup)
	"crates/pi-natives/src/utok/", // multilingual tokenizer fixtures
	"crates/pi-natives/src/syntaxes/", // highlight grammars (Julia π constant)
	"plugins/", // shipped extension assets
	"infra/", // self-hosted ARC deployment docs/lists; historical runner labels are data
	".zeta/", // in-repo dev-tool directory (not the product config dir)
	".oxlintrc.json", // lint-glob config; tooling cleanup tracked separately
	"scripts/brand/", // the guard's own rule table names the tokens it bans
	".zcode/",
];

/** Files whose `oh-my-pi` mentions are deliberate (upstream provenance/interop). */
export const OH_MY_PI_ALLOW_FILES = [
	"packages/ai/src/telemetry-export-otlp.ts", // upstream collector identity
	"packages/coding-agent/src/blob-broker/uploaders-legacy.ts", // legacy share URLs
	"packages/coding-agent/src/cli/git-tui/avatar.ts", // GitHub avatar URL for upstream repo
	"packages/coding-agent/src/mcp/oauth-flow.ts", // upstream OAuth client_name compat
	"packages/coding-agent/src/web/search/providers/exa.ts", // upstream referer
	"packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts", // deliberate alias table
	"packages/coding-agent/src/extensibility/plugins/legacy-pi-coding-agent-shim.ts",
	"packages/coding-agent/test/extensibility/legacy-pi-canonical-require.test.ts", // deliberate legacy-scope remap fixture
	"packages/ai/test/fixtures/harmony-leak-corpus.json", // leak corpus fixture
	"packages/ai/test/cursor-exec-modern.test.ts", // upstream repo fixtures
	"packages/ai/test/deepinfra-reasoning-contract.test.ts", // issue-reference comments
	"packages/ai/test/github-copilot-long-context-wire.test.ts",
	// Pre-existing main debt (identical on main; OMP_REPO env overrides) —
	// tracked for a follow-up sweep, out of scope for merge-residue repair.
	"scripts/fix-changelogs.ts",
	"scripts/fix-changelogs.test.ts",
	"scripts/ci-macos-upload-secrets.sh",
	"packages/coding-agent/test/tools/web-scrapers/git-hosting.test.ts", // scraper fixture repo name
	"packages/coding-agent/test/update-cli.test.ts", // upstream manifest-key compat fixtures
	"packages/coding-agent/test/status-line-git-utils.test.ts", // parse fixture: arbitrary repo slug
	"packages/coding-agent/test/tools/gh.test.ts", // upstream repo fixtures for gh tool
	"packages/coding-agent/test/tools/web-search-exa.test.ts", // asserts the compat x-exa-source value
	"packages/natives/test/windows-staging.test.ts", // staging layout fixture path
	"packages/coding-agent/test/oauth-flow.test.ts", // asserts upstream client_name compat value
	"packages/coding-agent/test/otel-export-probe.ts", // probe service name mirrors otlp exporter
	"packages/coding-agent/test/otel-signals-probe.ts", // probe service name mirrors otlp exporter
	"packages/coding-agent/test/read-tool-group.test.ts", // pr:// fixture URL
	"packages/coding-agent/test/event-controller-mixed-assistant-render.test.ts", // repo_view fixture
	"packages/coding-agent/test/blob-uploaders-self-hosted-legacy.test.ts", // legacy form-field value
	"packages/coding-agent/test/modes/components/status-line/component.test.ts", // negative assertion
	"packages/coding-agent/src/telemetry-export-otlp.ts", // OTLP SERVICE_NAME compat (collector-side identity)
	"packages/coding-agent/src/telemetry-export.ts", // provenance doc comment
	"packages/coding-agent/src/tools/acp-bridge.ts", // example session-path doc comment
	"crates/pi-shell/src/minimizer/filters/git.rs", // git output fixtures (arbitrary remotes)
	"packages/coding-agent/src/cli/gallery-fixtures/", // TUI gallery sample data
	"packages/coding-agent/src/cli/update-cli.ts", // pre-existing main debt: self-update REPO/MISE fallbacks
	"package.json", // pre-existing main debt: PI_IMAGE docker tag default + robomp scripts
	"CONTRIBUTING.md", // pre-existing main debt: upstream-facing contributing doc
	"packages/coding-agent/CHANGELOG.md", // changelog entries describe the residue itself
	"scripts/merge-package-json.ts", // merge driver: must name the upstream @oh-my-pi scope to map it back
	"scripts/merge-package-json.test.ts", // driver test: fixtures carry the upstream scope to prove the mapping
];

/** `oh-my-pi` is allowed when embedded in these patterns (issue/URL provenance). */
export const OH_MY_PI_ALLOW_PATTERNS = [/github\.com\/can1357\/oh-my-pi/, /oh-my-pi#\d+/, /oh-my-pi issue #\d+/];

/**
 * `.zeta` path-segment strings are flagged in src files unless the line matches
 * an allow pattern. Each entry: the interop surface that must keep reading or
 * writing OMP-native locations. Test fixtures are exempt (self-consistent
 * temp paths; the per-bucket merge procedure resolves them when CI proves a
 * real divergence — the skillful-toggle lesson).
 */
export const OMP_PATH_ALLOW = [
	/\/discovery\/(helpers|omp-plugins|claude-plugins)\.ts$/, // OMP plugin interop
	/omp-extension-roots\.ts$/,
	/\/plugins\/[^/]+\.ts$/, // pkg.omp manifest loaders
	/extensibility\/extensions\/loader\.ts$/,
	/config\/discovery\/builtin\.ts$/, // Builtin provider probing OMP installs
	/export\/share\.ts$/, // .ompshare gist export
	/utils\/title-generator\.ts$/, // \uE000omp-title-visible\uE000 wire sentinel
	/legacy-pi-compat\.ts$|legacy-pi-coding-agent-shim\.ts$/,
	/packages\/browser-relay\//, // chrome.storage keys (ompGroupTitle family)
	/\.omp-plugin|\.ompshare|omp\.sh|__omp|ZETA_PROFILE|ompprurl|@omp-|omp-\$\{/,
	/\.omp[a-zA-Z]*Url|ompPr|ompPersisted|ompToolViews|ompCmd|ompGroup/,
	/rewrite-changelog\.ts$/, // pre-existing main debt: doc comment on db path
	/crates\/pi-natives\/src\/oauth_callback\/tests\.rs$/, // negative assertion: .zeta must NOT exist
	/extensibility\/plugins\/loader\.ts$/, // OMP/Claude project-anchor detection docs
	/packages\/browser-relay\//, // relay README pairs with OMP-compatible CLI surfaces
	// Read-only upstream OMP model-config compatibility (user decision 2026-10-02):
	// the probe must name the upstream `~/.omp/agent` default root to find it.
	/"\.omp", "agent"/,
	/~\/\.omp\/agent/,
];

/**
 * Brand-surface files where the π family must never appear (merge-protected).
 * ζ (U+03B6) is the canonical Zeta mark; π is reserved for `icon.pi` and math.
 */
export const PI_FREE_FILES = [
	"packages/coding-agent/src/utils/title-generator.ts",
	"packages/tui/src/prompt/welcome.ts",
	"packages/coding-agent/src/modes/setup-wizard/scenes/splash.ts",
	"packages/coding-agent/src/modes/setup-wizard/scenes/outro.ts",
	"packages/coding-agent/src/modes/setup-wizard/wizard-overlay.ts",
];

/** Unicode π-family codepoints scanned in PI_FREE_FILES. */
export const PI_FAMILY = /[\u03A0\u03C0\u03D6\u220F\u213C\u{1D6A2}-\u{1D7CB}]/u;

/** Exact assertions: each entry must appear in the named file (merge-protected). */
export const MUST_CONTAIN: Array<{ file: string; needle: string; why: string }> = [
	{
		file: "packages/utils/src/dirs.ts",
		needle: "USER_AGENT = `zeta/${" + "VERSION}`;",
		why: "UA constant drives every provider request (v18.1.10 merge reverted it to omp/)",
	},
	{
		file: "packages/utils/src/dirs.ts",
		needle: 'export const CONFIG_DIR_NAME: string = ".zeta";',
		why: "config dir identity",
	},
	{
		file: "packages/utils/src/dirs.ts",
		needle: 'export const APP_NAME: string = "zeta";',
		why: "app name identity",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		needle: "ZETA_LOGO",
		why: "ζ char-art is the product logo surface (v18.0.3 lesson)",
	},
	{
		file: "packages/tui/src/prompt/composer.ts",
		needle: "new WelcomeComponent(",
		why: "welcome entry liveness: the composer must construct the Zeta welcome component — an upstream reroute that renders a different welcome is the v18.6.0 structural blind-spot class (guards checked welcome.ts while the runtime could have been fed another entry)",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		needle: 'builtin: "zeta"',
		why: "the native-rendered welcome logo must be the terminal's builtin zeta mark, never an inline upstream asset",
	},
	{
		file: "packages/tui/src/prompt/welcome.ts",
		needle: "APP_NAME} v${this.version}",
		why: "the welcome version line is `zeta v<package version>` driven by APP_NAME (registry: 版本行); a hardcoded upstream version literal or omp wordmark here is the v18.6.0 regression shape",
	},
	{
		file: "packages/tui/src/theme/symbols.ts",
		needle: '"icon.omp": "ζ",',
		why: "status-line brand icon (registry: icon.omp=ζ; nerd U+F0D57 preserved separately)",
	},
	{
		file: "packages/coding-agent/src/utils/title-generator.ts",
		needle: 'const DEFAULT_TERMINAL_TITLE = "ζ";',
		why: "terminal title brand character (registry row 1)",
	},
	{
		file: "packages/coding-agent/src/utils/title-generator.ts",
		needle: 'const NATIVE_TERMINAL_TITLE = "zeta";',
		why: "native TSP tab title brand word while no session is named (the OMP_PATH_ALLOW exemption for the \\uE000omp-title-visible\\uE000 wire sentinel otherwise hides upstream omp here)",
	},
	{
		file: "packages/utils/src/logger.ts",
		needle: 'filenamePrefix: "zeta",',
		why: "rotating log file identity (upstream v18.1.17+ writes omp.*.log; test pair must match)",
	},
	{
		file: "scripts/merge-package-json.ts",
		needle: '"@oh-my-pi/"',
		why: "the driver must keep the literal upstream npm scope in OMP_SCOPE or the mapping silently no-ops (swept away twice; v18.2.4-era regression ran the v18.3.1/v18.3.2 merges unmapped)",
	},
	{
		file: "scripts/merge-package-json.ts",
		needle: '"@mariozechner/"',
		why: "the driver must keep upstream's original author scope in LEGACY_AUTHOR_SCOPE or historical manifests merge unmapped (v18.4.11 install-smoke regression: @mariozechner/pi-coding-agent passed through)",
	},
	{
		file: "scripts/merge-package-json.test.ts",
		needle: "@oh-my-pi/",
		why: "driver-test upstream fixtures must carry the real upstream scope or this guard pair cannot fail",
	},
];

/**
 * Exact assertions: each token must NOT appear anywhere in scanned sources.
 * The upstream npm scope (`@oh-my-pi/…`) is deliberately NOT here: the merge
 * driver and its test must name it literally to map it back (they are
 * allow-listed files, and MUST_CONTAIN asserts the scope survives), and the
 * oh-my-pi token scan in brand-check.ts covers every other file.
 */
export const MUST_NOT_CONTAIN: Array<{ needle: RegExp; why: string }> = [
	{ needle: /PI_LOGO/, why: "upstream logo constant must never return" },
	{ needle: /USER_AGENT = `omp\//, why: "upstream UA template" },
	{ needle: /const PREVIEW_TITLE = "omp"/, why: "shape-preview stand-in title is ζ" },
	{ needle: /const APP_NAME = "omp"/, why: "init-xdg must import APP_NAME from pi-utils" },
	{ needle: /display: "omp"/, why: "profile alias default command is zeta" },
	{
		needle: /runs-on:.*(omp-kata|\bomp\b)/,
		why: "Zeta CI runs exclusively on GitHub-hosted runners; upstream runner labels never resolve here and stall release jobs",
	},
	{
		needle: /omp:\/\//,
		why: "the internal docs URL scheme is zeta:// only (registry row: 内部 URL scheme); upstream omp:// literals — code, prompts, docs, test fixtures — are swept at every merge",
	},
	{
		needle: /M14 16h36/,
		why: "upstream TTT-mark welcome SVG path fingerprint (v18.6.0: the upstream logo art sat as a dead asset beside the live ZETA_LOGO; path data carries no brand token, so token scans cannot see this class)",
	},
	{
		needle: /WELCOME_LOGO_SVG|welcomeLogoBlob/,
		why: "the welcome logo is ZETA_LOGO text art plus the terminal's builtin zeta mark; any re-introduced inline welcome logo asset is upstream residue (deleted with v18.6.0's dead TTT SVG)",
	},
	// ── Cross-surface token pairs (added after the v18.4.3 CI round) ──────────
	// These tokens exist on TWO sides (producer + consumer). Sweeping only one
	// side compiles fine and fails at runtime/CI — the worst damage class,
	// because check:ts cannot see it. Each rule below pins BOTH sides to the
	// Zeta spelling; a hit means one side still carries the upstream literal.
	{
		needle: /__omp_worker_/,
		why: "worker argv protocol: cli.ts dispatches only __zeta_worker_* — an upstream __omp_worker_* spawn arg boots the full CLI as a normal command (v18.4.3: eval worker init 10-15s + 'No models available' smoke death)",
	},
	{
		needle: /PI_CODING_AGENT_DIR/,
		why: "agent-dir env contract: dirs.ts reads only ZETA_CODING_AGENT_DIR — a test setting PI_CODING_AGENT_DIR silently isolates nothing (v18.4.3: agent-storage CANTOPEN)",
	},
	{
		needle: /USER_AGENT = `omp\//,
		why: "(duplicate guard on the test side) any UA producer/consumer pair must both say zeta/",
	},
	{
		needle: /toMatch\(\/\^omp\/\\d/,
		why: "UA test regexes must expect zeta/<version>, not omp/<version> (task-branch names like omp/task/… are a kept upstream convention and do not match)",
	},
	{
		needle: /Run `omp /,
		why: "user-facing CLI hints name the zeta binary (v18.4.3: 'Run `omp --resume`' broke the session-resolution contract)",
	},
	// ── Stats dashboard brand surface (added after the v18.4.4 round) ─────────
	// The stats client shipped with upstream branding since the fork (never
	// overlayed) and regressed visually every release merge. These pin the
	// user-visible dashboard tokens to the Zeta spelling; port-conflict's
	// deliberate `omp` process-match keepers are narrower literals and do not
	// match any of these.
	{
		needle: /<title>omp stats<\/>/,
		why: "stats dashboard tab/window title is 'zeta stats' (v18.4.4: shipped as 'omp stats' since the fork)",
	},
	{
		needle: /Everything omp did/,
		why: "stats Overview subtitle names zeta, not upstream",
	},
	{
		needle: /X-Omp-Stats-Action/,
		why: "stats action header is X-Zeta-Stats-Action on both client and server sides",
	},
	{
		needle: /omp-stats-theme/,
		why: "stats theme localStorage key is zeta-stats-theme (client + useSystemTheme pair)",
	},
	{
		needle: /omp-mark-grad/,
		why: "stats logo gradient id is zeta-mark-grad (ζ mark, not π)",
	},
	// ── CLI command-surface red lines (PR #43 round) ──────────────────────
	{
		needle: /`zeta (code|work|editor|ide)`/,
		why: "red line: the space form is internal hand-off syntax only and must never appear in any user-visible string; display the canonical bins (zetacode/zetawork/zetaeditor/zetaide). UPDATE-LOG.md is exempt because released entries are immutable history",
	},
	{
		needle: /\$\{APP_NAME\} [a-z]{2,}/,
		why: "usage/help run-strings must interpolate CLI_BIN_NAME (the CLI command), not APP_NAME (product identity: bare `zeta` is the workbench bin). Product-identity contexts (splash wordmark, log-file names, attribution) use no space-separated command word and do not match",
	},
];

/**
 * User-visible brand surfaces scanned verbatim regardless of file extension
 * (SCAN_EXT only covers code/doc extensions, so .txt copies rendered straight
 * to the screen were invisible to every rule — the v18.6.0 tips.txt leak).
 * `forbid` runs line-by-line on the exact file; any hit fails the gate.
 * Extend whenever a new verbatim-rendered copy surface appears.
 */
export const USER_SURFACE_FILES: Array<{ file: string; forbid: RegExp; why: string }> = [
	{
		file: "packages/tui/src/prompt/tips.txt",
		forbid: /\bomp\b|PI_DIALECT|clanker/,
		why: "the welcome Tip row renders this file verbatim: the binary is zeta, and upstream env/slang tokens (PI_DIALECT, clanker) never surface (v18.6.0 shipped 7 omp tips + a PI_DIALECT tip here)",
	},
	{
		file: "packages/coding-agent/src/i18n/en.ts",
		forbid: /PI_DIALECT/,
		why: "tip copy is user-visible; the upstream inference-dialect env var name never renders (v18.6.0: i18n tip23 leaked it — the functional env plumbing in packages/agent is fine, only rendered copy is banned)",
	},
	{
		file: "packages/coding-agent/src/i18n/zh.ts",
		forbid: /PI_DIALECT/,
		why: "tip copy is user-visible; the upstream inference-dialect env var name never renders (v18.6.0: i18n tip23 leaked it)",
	},
];
