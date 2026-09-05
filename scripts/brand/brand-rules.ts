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
	".omp/", // in-repo dev-tool directory (not the product config dir)
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
	"packages/coding-agent/src/modes/acp/acp-agent.ts", // ACP agent identity compat
	"packages/coding-agent/src/web/search/providers/exa.ts", // upstream referer
	"packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts", // deliberate alias table
	"packages/coding-agent/src/extensibility/plugins/legacy-pi-coding-agent-shim.ts",
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
];

/** `oh-my-pi` is allowed when embedded in these patterns (issue/URL provenance). */
export const OH_MY_PI_ALLOW_PATTERNS = [/github\.com\/can1357\/oh-my-pi/, /oh-my-pi#\d+/, /oh-my-pi issue #\d+/];

/**
 * `.omp` path-segment strings are flagged in src files unless the line matches
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
	/\.omp-plugin|\.ompshare|omp\.sh|__omp|OMP_PROFILE|ompprurl|@omp-|omp-\$\{/,
	/\.omp[a-zA-Z]*Url|ompPr|ompPersisted|ompToolViews|ompCmd|ompGroup/,
	/rewrite-changelog\.ts$/, // pre-existing main debt: doc comment on db path
	/crates\/pi-natives\/src\/oauth_callback\/tests\.rs$/, // negative assertion: .omp must NOT exist
	/extensibility\/plugins\/loader\.ts$/, // OMP/Claude project-anchor detection docs
	/packages\/browser-relay\//, // relay README pairs with OMP-compatible CLI surfaces
];

/**
 * Brand-surface files where the π family must never appear (merge-protected).
 * ζ (U+03B6) is the canonical Zeta mark; π is reserved for `icon.pi` and math.
 */
export const PI_FREE_FILES = [
	"packages/coding-agent/src/utils/title-generator.ts",
	"packages/coding-agent/src/modes/components/welcome.ts",
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
		file: "packages/coding-agent/src/modes/components/welcome.ts",
		needle: "ZETA_LOGO",
		why: "ζ char-art is the product logo surface (v18.0.3 lesson)",
	},
	{
		file: "packages/coding-agent/src/modes/theme/symbols.ts",
		needle: '"icon.omp": "ζ",',
		why: "status-line brand icon (registry: icon.omp=ζ; nerd U+F0D57 preserved separately)",
	},
	{
		file: "packages/coding-agent/src/utils/title-generator.ts",
		needle: 'const DEFAULT_TERMINAL_TITLE = "ζ";',
		why: "terminal title brand character (registry row 1)",
	},
];

/** Exact assertions: each token must NOT appear anywhere in scanned sources. */
export const MUST_NOT_CONTAIN: Array<{ needle: RegExp; why: string }> = [
	{ needle: /PI_LOGO/, why: "upstream logo constant must never return" },
	{ needle: /USER_AGENT = `omp\//, why: "upstream UA template" },
	{ needle: /const PREVIEW_TITLE = "omp"/, why: "shape-preview stand-in title is ζ" },
	{ needle: /const APP_NAME = "omp"/, why: "init-xdg must import APP_NAME from pi-utils" },
	{ needle: /display: "omp"/, why: "profile alias default command is zeta" },
	{ needle: /@oh-my-pi\//, why: "upstream npm scope never appears in product sources" },
	{
		needle: /runs-on:.*(omp-kata|\bomp\b)/,
		why: "Zeta CI runs exclusively on GitHub-hosted runners; upstream runner labels never resolve here and stall release jobs",
	},
];
