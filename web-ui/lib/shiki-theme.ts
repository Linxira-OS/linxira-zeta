import type { BundledLanguage, ThemeRegistrationRaw } from "shiki";
import { bundledLanguages } from "shiki";

/**
 * Shiki theme definition driven entirely by the CSS variables that
 * lib/theme/cssGenerator.ts emits into `:root`. Because every color is a
 * `var(--md-syntax-*)` / `var(--syntax-*)` reference, switching app themes
 * restyles highlighted code instantly — Shiki never has to re-tokenize or
 * rebuild its highlighter.
 *
 * The active theme id only influences the registration `name`, which is
 * unobservable in the token-based rendering path used by FileViewer and
 * MermaidBlock.
 */
export const ACTIVE_SHIKI_THEME_ID = "active";

/**
 * TextMate scope rules → CSS variable references. Order runs general →
 * specific; TextMate resolves longer scope paths first, so `keyword.operator`
 * wins over `keyword` regardless of position.
 */
const MARKDOWN_TOKEN_COLORS: Array<{
	scope: string[];
	settings: {
		foreground?: string;
		fontStyle?: "bold" | "italic" | "underline";
	};
}> = [
	// Comments
	{
		scope: ["comment", "punctuation.definition.comment", "string.comment"],
		settings: {
			foreground: "var(--md-syntax-comment)",
			fontStyle: "italic",
		},
	},
	// Plain strings (quotes inherit via scope stack)
	{
		scope: ["string"],
		settings: { foreground: "var(--md-syntax-string)" },
	},
	// Numbers and numeric constants
	{
		scope: ["constant.numeric", "constant.character.escape"],
		settings: { foreground: "var(--md-syntax-number)" },
	},
	// Keywords and storage (const/let/class/int, public/private…)
	{
		scope: ["keyword", "storage"],
		settings: { foreground: "var(--md-syntax-keyword)" },
	},
	// Language constants (true/false/null/this/self)
	{
		scope: ["constant.language", "keyword.constant", "variable.language"],
		settings: { foreground: "var(--md-syntax-keyword)" },
	},
	// Tags (HTML/JSX) lean keyword, attributes lean property
	{
		scope: ["entity.name.tag"],
		settings: { foreground: "var(--md-syntax-keyword)" },
	},
	{
		scope: ["entity.other.attribute-name"],
		settings: { foreground: "var(--md-syntax-property)" },
	},
	// Types, classes, namespaces
	{
		scope: [
			"entity.name.type",
			"entity.name.class",
			"entity.name.struct",
			"entity.name.enum",
			"entity.name.interface",
			"entity.name.namespace",
			"entity.other.inherited-class",
			"support.type",
			"support.class",
		],
		settings: { foreground: "var(--md-syntax-type)" },
	},
	// Functions and call expressions
	{
		scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"],
		settings: { foreground: "var(--md-syntax-function)" },
	},
	// Properties, object keys, struct members
	{
		scope: [
			"meta.property-name",
			"support.property",
			"variable.other.property",
			"variable.other.object.property",
			"meta.object-literal.key",
		],
		settings: { foreground: "var(--md-syntax-property)" },
	},
	// Operators (longer scope path beats `keyword` above)
	{
		scope: ["keyword.operator"],
		settings: { foreground: "var(--md-syntax-operator)" },
	},
	// Markup (markdown source, diff fences)
	{
		scope: ["markup.heading", "entity.name.section"],
		settings: {
			foreground: "var(--syntax-header)",
			fontStyle: "bold",
		},
	},
	{
		scope: ["markup.inserted"],
		settings: { foreground: "var(--md-syntax-inserted)" },
	},
	{
		scope: ["markup.deleted"],
		settings: { foreground: "var(--md-syntax-deleted)" },
	},
];

/**
 * Build a Shiki theme registration for the given app theme id. All colors
 * resolve at paint time from CSS variables — the returned definition is
 * theme-invariant apart from its name.
 */
export function createMarkdownShikiTheme(themeId: string = ACTIVE_SHIKI_THEME_ID): ThemeRegistrationRaw {
	return {
		name: `zeta-markdown-${themeId}`,
		colors: {
			"editor.background": "var(--syntax-background)",
			"editor.foreground": "var(--md-syntax-foreground)",
			"editorLineNumber.foreground": "var(--syntax-line-number)",
		},
		settings: MARKDOWN_TOKEN_COLORS,
	};
}

/**
 * Languages loaded opportunistically once the shared highlighter is idle.
 * Everything else loads on demand the first time a file/fence needs it.
 */
export const SHIKI_PRELOAD_LANGS = [
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"css",
	"html",
	"markdown",
	"bash",
	"python",
	"yaml",
	"sql",
	"diff",
	"rust",
	"go",
	"cpp",
	"c",
	"java",
	"xml",
] as const satisfies readonly BundledLanguage[];

/** Common language labels that Shiki's bundled alias table does not cover. */
const LANG_ALIASES: Record<string, BundledLanguage> = {
	"c++": "cpp",
	cxx: "cpp",
	golang: "go",
	docker: "dockerfile",
	objc: "objective-c",
	posh: "powershell",
};

/**
 * Map a raw language label (fence tag, server-detected language) to a
 * bundled Shiki grammar id. Returns null for anything without a grammar —
 * callers should render those as plain text.
 */
export function resolveShikiLang(language: string | null | undefined): BundledLanguage | null {
	const raw = (language ?? "").trim().toLowerCase();
	if (!raw || raw === "text" || raw === "plaintext" || raw === "plain") {
		return null;
	}
	const candidate = LANG_ALIASES[raw] ?? raw;
	return candidate in bundledLanguages ? (candidate as BundledLanguage) : null;
}

/** Inline style primitives for one highlighted token. */
export interface CodeTokenStyle {
	color?: string;
	fontWeight?: "bold";
	fontStyle?: "italic";
	textDecoration?: "underline";
}

/** One renderable code token: text plus optional style overrides. */
export interface CodeToken {
	text: string;
	style?: CodeTokenStyle;
}

/** Shiki FontStyle bit flags (VS Code TextMate: 1 = italic, 2 = bold, 4 = underline). */
export function shikiFontStyleToCss(fontStyle: number | undefined): CodeTokenStyle {
	if (!fontStyle) return {};
	const style: CodeTokenStyle = {};
	if (fontStyle & 1) style.fontStyle = "italic";
	if (fontStyle & 2) style.fontWeight = "bold";
	if (fontStyle & 4) style.textDecoration = "underline";
	return style;
}

/** Split code into unstyled per-line token rows (used pre-load / fallback). */
export function plainCodeLines(code: string): CodeToken[][] {
	return code.split("\n").map(line => (line ? [{ text: line }] : []));
}
