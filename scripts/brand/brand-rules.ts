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
	"scripts/scan-brand-regressions.ts", // the merge-diff scanner names the same tokens as match patterns
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
	"scripts/check-scope-imports.ts", // the class-3 guard documents the exact upstream→Zeta leaf mappings it exists to catch
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
		file: "packages/coding-agent/src/launch/protocol.ts",
		needle: "ZETA_DAEMON_IDLE_GRACE_MS",
		why: "the broker's idle-grace env key stays the Zeta spelling the broker actually reads (producer/consumer pair: broker.ts + launch client)",
	},
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
		needle: "alt: APP_NAME,",
		why: "the welcome hero is the built-in ζ mark with the APP_NAME alt (registry: welcome/splash); upstream replaced it with a wordmark lockup and the π art, which must not return (v18.0.3/v18.6.0 lessons)",
	},
	{
		file: "packages/tui/src/status-line/segments.ts",
		needle: 'export const PLAN_ULTRA_LABEL = "Plan-Ultra";',
		why: "the ultra plan workflow keeps its own status-line label; the upstream status-line refactor (v18.8.8) dropped it because only the plain `Plan` string survived, so the exact form is pinned",
	},
	{
		file: "packages/tui/src/theme/symbols.ts",
		needle: '"icon.omp": "ζ",',
		why: "status-line brand icon (registry: icon.omp=ζ; nerd U+F0D57 preserved separately)",
	},
	{
		file: "packages/tui/src/theme/symbols.ts",
		needle: '"icon.omp": "zeta",',
		why: "the ascii preset of the same icon — on terminals that cannot draw ζ this literal word is what users see, and upstream's ascii fallback is `pi` (their brand), so a merge re-introduces it silently unless the exact form is pinned (registry: icon.omp ascii preset `zeta`)",
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
	{
		file: "packages/coding-agent/src/main.ts",
		needle: "const TELEMETRY_EXPORT_ENABLED = false;",
		why: "OTLP export is hard-off by policy (no collector to process events); flipping this constant or restoring the opt-in setting requires a deliberate decision, not a merge (see the doc comment above it)",
	},
	{
		file: "packages/coding-agent/src/main.ts",
		needle: "initTelemetryExport, TELEMETRY_EXPORT_ENABLED);",
		why: "the call site must read the hard-off constant, not a settings lookup or literal — otherwise a merge can leave the constant alone while exporting anyway",
	},
	// ── External-identity surface (2026-10-10 sweep) ────────────────────────
	// These are the names the OS, the browser, the desktop environment and our
	// own peers see. A merge that restores the upstream spelling silently
	// re-registers the product as `zetacode` at the platform level, which no
	// docs/sources-only guard can catch.
	{
		file: "crates/pi-natives/src/oauth_callback/darwin.rs",
		needle: 'const BUNDLE_PREFIX: &str = "dev.zeta.oauth-callback.";',
		why: "macOS bundle id for the OAuth callback handler; upstream is dev.omp.oauth-callback and appears in LaunchServices + any bundle inventory",
	},
	{
		file: "crates/pi-natives/src/oauth_callback/windows.rs",
		needle: 'const MARKER_NAME: &str = "Zeta OAuth Callback Transaction";',
		why: "HKCU registry transaction name for the Windows URL protocol handler",
	},
	{
		file: "crates/pi-natives/src/oauth_callback/linux.rs",
		needle: 'const DESKTOP_ID_PREFIX: &str = "dev.zeta.oauth-callback.";',
		why: "XDG desktop-entry id for the Linux URL protocol handler",
	},
	{
		file: "crates/pi-builtins/src/host.rs",
		needle: "zeta-descriptor://",
		why: "file-descriptor URL scheme handed to the opener; upstream omp-descriptor:// registers under his name",
	},
	{
		file: "crates/pi-natives/src/lib.rs",
		needle: "pub fn omp_install_tokio_runtime()",
		why: "the Tokio install export keeps its upstream name ON PURPOSE — sweeping it to __zeta* made Tokio silently fail to install (v18.0.10)",
	},
	{
		file: "packages/coding-agent/src/ida/protocol.ts",
		needle: 'export const IDA_DAEMON_PREFIX = "zeta.ida.";',
		why: "IDA daemon name shown in `zetacode ps`; upstream is omp.ida.*",
	},
	{
		file: "packages/coding-agent/src/stream/recording.ts",
		needle: 'export const RECORDING_EXTENSION = ".zetacast";',
		why: "session-recording file extension; upstream is .ompcast",
	},
	{
		file: "packages/utils/src/dirs.ts",
		needle: '"omp-plugins.lock.json"',
		why: "the plugin lockfile keeps its upstream filename on purpose — existing installs carry runtime state (enabled features, versions) in it, so renaming would reset every user's plugins on upgrade. The doc comment above getPluginsLockfile says the same; do not rebrand it",
	},
	// ── v18.8.7/v18.8.8 merge-residue pins (2026-10-11 sweep) ──────────────
	// These are file-local strings the whole-tree token bans cannot express
	// (an `omp` in the same file may be a deliberate interop token); pin the
	// exact Zeta form so a merge that restores upstream's spelling fails here.
	{
		file: "packages/coding-agent/src/modes/acp/acp-agent.ts",
		needle: 'name: "zeta",',
		why: "ACP agentInfo advertises the product identity `zeta`; upstream's `omp` mislabels the agent at initialize (acp-initialize-conformance asserts name+title)",
	},
	{
		file: "packages/coding-agent/src/modes/acp/acp-agent.ts",
		needle: '"Set up zeta in terminal"',
		why: "ACP terminal-auth method name is Zeta-branded (upstream is 'Set up omp in terminal')",
	},
	{
		file: "packages/coding-agent/src/modes/utils/ui-helpers.ts",
		needle: "const command = `${CLI_BIN_NAME} update`;",
		why: "the update hint must interpolate CLI_BIN_NAME; a literal 'omp update' is upstream residue (theme-lazy-status-color asserts the rendered line)",
	},
	{
		file: "packages/coding-agent/src/cli/update-cli.ts",
		needle: "does not report a ${CLI_BIN_NAME} version when run directly",
		why: "the version-probe refusal interpolates CLI_BIN_NAME; upstream hardcodes an 'OMP version' string",
	},
	{
		file: "packages/coding-agent/src/main.ts",
		needle: "the `zeta-plugins` discovery provider",
		why: "main.ts's trusted-extension comment names our discovery provider id (zeta-plugins is the canonical write form; `omp-plugins` is read-only interop, kept elsewhere)",
	},
	{
		file: "packages/tui/src/prompt/attachment-chips.ts",
		needle: 'Symbol("zeta.imagePng")',
		why: 'the PNG-cache symbol description is zeta-branded (upstream Symbol("omp.imagePng"))',
	},
	{
		file: "packages/coding-agent/src/server/web-gateway/dto.ts",
		needle: 'export const SKILLS_CLI_AGENT = "pi";',
		why: "the third-party `skills` CLI validates --agent against its own registry and rejects `omp` (Invalid agents: omp — installs nothing); `pi` writes to .agents/skills, which our `agents` skill provider and .skill-lock.json reader use",
	},
	{
		file: "packages/coding-agent/src/dap/session.ts",
		needle: "clientID: APP_NAME,",
		why: "DAP initialize identity is the product name, not upstream's literal",
	},
	{
		file: "packages/coding-agent/src/hindsight/bank.ts",
		needle: 'const DEFAULT_BANK_NAME = "zeta";',
		why: "the fallback Hindsight bank is zeta (docs/memory.md records the rename and the continuity note)",
	},
	{
		file: "packages/coding-agent/src/grievances/client.ts",
		needle: "agent: APP_NAME,",
		why: "bug-report attribution is the product name — the composition moved from report-tool-issue.ts to the GitHub Issues client, the source of truth stays APP_NAME",
	},
	{
		file: "packages/catalog/src/compat/rules/auth/openai-codex.kdl",
		needle: 'originator "zeta"',
		why: "the Codex authorize param must equal OPENAI_HEADER_VALUES.ORIGINATOR_CODEX, which every API-request header already sends (packages/catalog/src/wire/codex.ts)",
	},
	{
		file: "packages/coding-agent/src/modes/rpc/wire/index.ts",
		needle: "linxira-zeta/main/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json",
		why: "the generated RPC wire $id points at the Zeta repo, like the mcp/theme schema URLs",
	},
	{
		file: "packages/browser-relay/extension/manifest.json",
		needle: '"name": "Zeta Browser Relay"',
		why: "the shipped browser extension is branded Zeta",
	},
	{
		file: "packages/coding-agent/src/utils/run-status.ts",
		needle: ":app=${APP_NAME}",
		why: "the OSC 7501 `app=` field is our identity in a terminal protocol — pinned by APP_NAME so a merge cannot swap it back to upstream's literal (the merged run-status.test.ts asserted `app=omp`; see the MUST_NOT_CONTAIN twin)",
	},
	{
		file: "packages/coding-agent/src/prompts/system/system-prompt.md",
		needle: "You are Zeta's trusted coding assistant.",
		why: "first line the model reads; it must name Zeta (2026-10-11: said omp, and the model repeated it to the user)",
	},
	{
		file: "packages/coding-agent/src/predict/protocol.ts",
		needle: "zetacode text-predict listening on",
		why: "writer + TEXT_PREDICT_READY_PATTERN reader must both name the zetacode bin",
	},
	{
		file: "packages/coding-agent/src/tiny/worker-server.ts",
		needle: "zetacode tiny worker listening on",
		why: "writer side of the tiny-worker banner",
	},
	{
		file: "packages/coding-agent/src/tiny/title-client.ts",
		needle: '"zetacode tiny worker listening on "',
		why: "reader side: the client filters the worker's banner lines — a one-sided spelling silently stops filtering (found split omp/zetacode, 2026-10-11)",
	},
	{
		file: "packages/coding-agent/src/lsp/mux/server.ts",
		needle: '"zetacode lsp mux"',
		why: "process title must match LSP_MUX_READY_PATTERN's zetacode prefix",
	},
	{
		file: "packages/coding-agent/src/modes/rpc/wire/index.ts",
		needle: '"Zeta RPC wire protocol"',
		why: "protocol identity string surfaced in the wire handshake",
	},
];

/**
 * Exact assertions: each token must NOT appear anywhere in scanned sources.
 * The upstream npm scope (`@oh-my-pi/…`) is deliberately NOT here: the merge
 * driver and its test must name it literally to map it back (they are
 * allow-listed files, and MUST_CONTAIN asserts the scope survives), and the
 * oh-my-pi token scan in brand-check.ts covers every other file.
 */
export const MUST_NOT_CONTAIN: Array<{ needle: RegExp; why: string; exempt?: string[] }> = [
	{ needle: /PI_LOGO/, why: "upstream logo constant must never return" },
	// ── The three-name hierarchy (2026-10-10) ────────────────────────────────
	// Zeta has three distinct names and swapping them is a real defect, not a
	// style preference:
	//   zeta     — product/app identity: config root, log names, UA product
	//              token, splash, attribution headers, process-global identity
	//   zetawork — the workbench CLI (@linxiraos/main, bin `zeta`/`zetawork`)
	//   zetacode — the coding-agent CLI (@linxiraos/zeta, bin `zetacode`)
	// A config path or product token spelled `zetacode` points users at a
	// directory that does not exist; a command spelled `zeta` invokes the
	// workbench instead of the agent.
	{
		needle: /\.zetacode(?![A-Za-z0-9-])/,
		why: "the config/app identity is `zeta`, never `zetacode` — `.zetacode/` would be a directory no install ever creates",
	},
	{
		needle: /XDG_[A-Z_]*HOME\/zetacode/,
		why: "XDG roots are keyed by APP_NAME (`zeta`), not the CLI binary name",
	},
	{
		needle: /USER_AGENT = `zetacode\//,
		why: "the UA product token is the app name (`zeta/`); CLI_BIN_NAME appears in user-facing command strings, not in the UA template",
	},
	{
		needle: /telemetry\.otlpExportEnabled/,
		why: "the OTLP export opt-in was deleted, not defaulted off — Zeta runs no collector, so export has no on-switch at all; a merge must not resurrect the setting (hard-off policy in main.ts)",
		exempt: ["CHANGELOG.md"],
	},
	// ── External-identity bans (2026-10-10 sweep) ───────────────────────────
	// Names the operating system, the browser, or our own peers would use to
	// identify this product as upstream. Word-boundary anchored so ordinary
	// English words containing the letters (Component, composite) never match.
	{
		needle: /dev\.omp\.oauth-callback/,
		why: "OAuth callback bundle/desktop id belongs to Zeta; upstream spelling re-registers the handler under his name",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /(?<![A-Za-z0-9])omp-descriptor(?![A-Za-z0-9])/,
		why: "file-descriptor URL scheme is zeta-descriptor://",
	},
	{
		needle: /(?<![A-Za-z0-9])omp\.ida\./,
		why: "IDA daemon name is zeta.ida.<id>",
	},
	{
		needle: /(?<![A-Za-z0-9])omp-file-lock-/,
		why: "advisory lock path prefix is zeta-file-lock-",
	},
	{
		needle: /zeta-plugins\.lock\.json/,
		why: "the lockfile we WRITE is Zeta-named (DUAL verdict: read the legacy name, write ours) — but the legacy name must stay, it holds every existing install's plugin state",
		exempt: [
			"CHANGELOG.md",
			"packages/utils/src/dirs.ts",
			"document/brand-surface-rules.md",
			// The migration test must name both spellings to assert the contract.
			"test/plugins/lockfile-migration.test.ts",
		],
	},
	{
		needle: /(?<![A-Za-z0-9])ompcast/,
		why: "session-recording extension/format key is zetacast; the two read-old sites are the deliberate upgrade path for recordings captured by an earlier install, not brand residue",
		exempt: ["CHANGELOG.md", "src/stream/recording.ts", "test/stream/recording-compat.test.ts"],
	},
	{
		needle: /(?<![A-Za-z0-9`])omp --/,
		why: "there is no `omp` binary in this product — the CLI is zetacode; `omp --flag` in prose or a help string is a leaked upstream invocation",
		exempt: ["CHANGELOG.md", "python/robomp/", "document/upstream-sync.md"],
	},
	{
		needle: /`omp(?![A-Za-z0-9-._])/,
		why: "a backticked bare `omp` is a CLI reference; the CLI is zetacode. Excluded by design: plain prose ('the omp process'), hyphenated temp prefixes (`omp-which-${pid}`), the upstream manifest fields `omp.rename` / `omp.dist`, and stencil.kdl where `omp` is the OAuth public client id registered with a third-party issuer",
		exempt: ["CHANGELOG.md", "python/robomp/", "document/upstream-sync.md", "compat/rules/auth/stencil.kdl"],
	},
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
		needle: /@linxiraos\/pi-coding-agent\//,
		why: "package-name mapping (damage class 3): our product package is @linxiraos/zeta (registry: pi-coding-agent→zeta), and it is the one workspace member that is NOT linked under its upstream leaf name — a plain scope swap from @oh-my-pi/pi-coding-agent/ yields a specifier that resolves nowhere, so every self-import breaks check:ts (v18.9.1: 62 files swept back to @linxiraos/zeta/)",
		exempt: ["scripts/brand/brand-rules.ts"],
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
	{
		needle: /app=omp(?![A-Za-z0-9])/,
		why: "the OSC 7501 program-status `app=` field is our product identity in a third-party terminal protocol; the implementation emits `:app=${APP_NAME}` (= zeta), so an `app=omp` in code or its test is upstream identity left by a merge (v18.8.8 merged run-status.test.ts with `app=omp` ×10 while utils/run-status.ts emitted zeta — the suite was red on CI and locally)",
	},
	{
		needle: /ZETA_NO_TITLE/,
		why: "titling gate is PI_NO_TITLE on both sides: main.ts sets it for --no-title/rpc/acp and agent-session.ts/interactive-mode.ts read it. A ZETA_ spelling on the read (or a test setting it) silently disables the check instead of failing",
	},
	{
		needle: /OMP_DAEMON_IDLE_GRACE_MS/,
		why: "the daemon broker reads DAEMON_IDLE_GRACE_ENV, which this tree spells ZETA_DAEMON_IDLE_GRACE_MS (all three DAEMON_*_ENV keys are Zeta-owned). A caller setting the upstream spelling is ignored — the browser-relay test then waits the 3 s default instead of its 200 ms override",
	},
	// ── Stats dashboard brand surface (added after the v18.4.4 round) ─────────
	// The stats client shipped with upstream branding since the fork (never
	// overlayed) and regressed visually every release merge. These pin the
	// user-visible dashboard tokens to the Zeta spelling; port-conflict's
	// deliberate `zetacode` process-match keepers are narrower literals and do not
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
	// ── v18.8.7/v18.8.8 merge residue (2026-10-11 sweep) ─────────────────────
	// The overlay's token table had no rule for these prose/identifier variants,
	// so the merge silently reverted a Zeta spelling and brand-check stayed
	// green. Each pins the class the pre-merge tree spelled the Zeta way.
	{
		needle: /"Usage: omp /,
		why: "throw-string CLI usage names the zetacode binary — there is no `omp` command in this product (v18.8.7: auth-broker login/import usage reverted)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /(?<![A-Za-z0-9_.-])omp update(?![A-Za-z0-9_.-])/,
		why: "the update hint is `zetacode update`: ui-helpers.ts must interpolate CLI_BIN_NAME, not a literal (theme-lazy-status-color asserts the rendered line)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /(?<![A-Za-z0-9_.-])omp say(?![A-Za-z0-9_.-])/,
		why: "the say command's examples and TTS settings copy name the zetacode command",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /since omp started/,
		why: "worktree-on-exit description counts worktrees since zetacode started (task/settings.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /(?<![A-Za-z0-9_])omp\.browser\.relay/,
		why: "the relay daemon name is zeta.browser.relay.<port>; the restart tests describe the same name, so pinning one side alone leaves the pair mismatched (sweep both or neither)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle:
			/echo "# Shell snapshot - generated by omp agent"|__omp_funcs|__omp_emit_referenced_exports|__omp_sq_quote/,
		why: "the shell-snapshot script and its helper names are __zeta_*; the generator and shell-snapshot-fn-env.sh must agree or the snapshot sources a function that does not exist",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /\.omp-tmp\./,
		why: "the ssh staging-file prefix is .zeta-tmp. (ssh/file-transfer.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /\.omp-sessions/,
		why: "the session-file comment example is .zeta-sessions/ (session/session-paths.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /\.omp\/config\.yml/,
		why: "the project config dir is .zeta — copy pointing at .omp/config.yml sends users to a path the product never reads (v18.9.1: docs/context-files.md taught it)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /(?<![A-Za-z0-9_.-])omp\.(imagePng|composer|editor|working|queue|status|note|run)(?![A-Za-z0-9_-])/,
		why: "TUI semantic roles and symbol descriptions are zeta.* (composer chips/send/stop/effort/rate/model/bar/focus, editor modes, working row, queue pills, status, notes, image cache symbol, run box/foot/state/time/facts/status/caption). v18.9.1 shipped upstream's composer tests asserting omp.composer.* while the sources emit zeta.* — the rule only knew omp.composer.chips and omp.run",
		exempt: ["CHANGELOG.md", "document/upstream-sync.md"],
	},
	{
		needle: /f=b21w|i=omp-probe-/,
		why: "the OSC 99 notification probe id and its base64 `f=` app field carry our identity (terminal.ts emits zeta-probe-<n> and base64 zeta); the v18.9.1 merge brought upstream's test asserting omp/b21w",
		exempt: ["CHANGELOG.md", "document/upstream-sync.md"],
	},
	{
		needle: /__omp_(fn|re)(?![\w])|__omp_(prelude|helpers|display|call_tool|current_run_id)__/,
		why: "runtime globals the sources inject as __zeta_* (computer/browser preludes serialize __zeta_fn/__zeta_re, the eval prelude reads __zeta_helpers__/__zeta_call_tool__/__zeta_display__, runtime.ts installs __zeta_prelude__, runner.py's run-id getter is __zeta_current_run_id__). The v18.9.1 merge swept the producer side but left test fixtures and one consumer on the upstream spelling, failing as 'not a function'/'not an object' plus one silent degrade. Only source-defined globals belong here: internal protocol markers (__omp_with_call_site__, __omp_tool_bridge__, __omp_final_expr__, mcp__omp__*) and test-local probes stay upstream-shaped",
		exempt: ["CHANGELOG.md", "document/upstream-sync.md", "document/merge-playbook.md"],
	},
	{
		needle: /ompRelayVersion:\s*"18\.|restartOwned\("18\./,
		why: "relay fixtures must not hardcode the upstream 18.x line: isOlderRelayVersion compares with Bun.semver.order against our VERSION (1.x), so '18.0.0' reads as *newer* and every older-relay case inverts into 'a newer zeta owns it' (v18.9.1 PR CI). Use OLDER_RELAY_VERSION in test/tools/browser-relay-*.test.ts",
		exempt: ["CHANGELOG.md", "document/upstream-sync.md"],
	},
	{
		needle: /`omp\.(cmd|ps1|bunx|exe)`/,
		why: "the CLI's npm/bun shims and release binary are named after CLI_BIN_NAME (zetacode.*); the bare `omp.*` spelling is upstream's. The stale pre-merge `zeta.cmd` is not the target either",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /does not report an OMP version/,
		why: "the version-probe refusal must interpolate CLI_BIN_NAME, not name upstream (cli/update-cli.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /^\s*name: "omp",\s*$/,
		why: "the ACP agentInfo name is the product identity `zeta`; acp-initialize-conformance asserts name+title=zeta at initialize",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /Set up omp in terminal/,
		why: "the ACP terminal-auth method name is Zeta-branded (modes/acp/acp-agent.ts)",
		exempt: ["CHANGELOG.md", "test/hook-selector-overflow.test.ts"], // changelog history + an arbitrary label fixture unrelated to the ACP method
	},
	{
		needle: /Launch the omp TUI/,
		why: "the ACP terminal-auth description is Zeta-branded (modes/acp/acp-agent.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /configured under ~\/\.omp\./,
		why: "the ACP auth description names the Zeta config root ~/.zeta (modes/acp/acp-agent.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /TempDir\.createSync\("@omp-lsp-/,
		why: "LSP regression fixtures use the @zeta-lsp- prefix (the merge reverted ~109 of them to @omp-)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /"\.omp", "plugins"|"\.omp", "plugin-overrides\.json"|path\.join\(cwd, "\.omp"\)/,
		why: "issue-14518 plugin-override fixtures resolve under .zeta, not the upstream root",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /p\.app === "omp"/,
		why: "the broker client app label defaults to zeta (getAppName); the assertion must expect zeta, and no producer emits `omp`",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /TempDir\.createSync\("@omp-agent-live-/,
		why: "the internal-url agent-protocol live fixture temp dir is zeta-agent-live-",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /Every real omp process|left behind by omp processes/,
		why: "browser/orphan-registry comments name zeta processes (tools/browser/registry.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /as far as omp reads it/,
		why: "the xAI response doc comment reads `zetacode` (web/search/providers/xai.ts)",
		exempt: ["CHANGELOG.md"],
	},
	{
		needle: /<title>zetacode stats<\/>/,
		why: "stats dashboard tab/window title is 'zeta stats' (v18.4.4: shipped as 'zetacode stats' since the fork)",
	},
	{
		needle: /You are omp'?s/,
		why: "model-visible identity lines name Zeta (system-prompt.md and the commit agent's prompt were both on the omp spelling until 2026-10-11)",
	},
	{
		needle: /\bOMP-native\b|\bOMP only harness\b/,
		why: "the security-scan prompt family speaks as the product, not as upstream",
	},
	{
		needle:
			/\bomp (acp|agents|attach|auth-broker|auth-gateway|bench|browser-relay|cleanse|clip|collab|commit|complete|completions|compress|config|dry-balance|find|gallery|gc|git|grep|grievances|if-bench|images|install|join|launch|launch-help|login|models|play|plugin|predict|ps|read|render|say|serve|settings|setup|share|shell|skill|ssh|stats|stream|tiny|tiny-models|token|toks|ttsr|update|usage|web-search|web-ui-launcher|web|worktree|text-predict|lsp|mcp|debug|sessions|resume|help|version)\b/,
		why: "user/model-visible command mentions must name the zetacode bin (registry: 用户可见文案与 CLI_BIN_NAME 一律用 zetacode) — help text, banner builders, log lines, prompt examples, comments and docs. The alternation is the CLI's own subcommand list; product-context phrases are written Zeta (e.g. 'Zeta settings', 'Zeta web themes') and do not match",
	},
	{
		needle: /\bomp-owned\b/,
		why: "browser-profile prose is model-visible (prompt + settings copy): write Zeta-owned",
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
