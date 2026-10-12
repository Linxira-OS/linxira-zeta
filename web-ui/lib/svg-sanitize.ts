import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";

/**
 * Sanitizer for model-authored ```svg fences.
 *
 * The markdown pipeline (react-markdown + rehype-raw + rehype-sanitize) runs
 * the GitHub HTML schema, which strips every inline `<svg>`; those fences are
 * therefore rendered by `SvgBlock` as their own component and cleaned here
 * against the surface the system prompt promises: static, self-contained
 * figures — no scripts, no `<foreignObject>`, no references outside the figure
 * itself, and no event handlers (DOMPurify's SVG attribute allowlist already
 * drops every `on*`).
 *
 * DOMPurify needs a DOM, so this runs only in the browser. Server-side, or
 * before it has run, callers show a placeholder and never the raw source.
 *
 * One inherited behaviour worth knowing: DOMPurify's DOM-clobbering guard (on
 * by default) also drops an `id`/`name` whose value is a property of its
 * parsing document — `blur`, `focus`, `title`, `style`, `body`… A figure that
 * names a paint server `id="blur"` therefore keeps its `url(#blur)` reference
 * but loses the target, so that one fill/filter falls back to no paint. Kept
 * as-is: the guard is a default worth not disabling, and a name collision only
 * costs the single reference it names.
 */

/** Attributes whose value the browser resolves as a reference to another document. */
const REFERENCE_ATTRIBUTES: Record<string, true> = { href: true, src: true, "xlink:href": true };

/** A CSS `url(...)` reference — how SVG paint servers, filters, masks and clip paths name their target. */
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

/**
 * The subset a ```svg fence may use: the SVG profile alone (no HTML or MathML
 * tag can survive), filters included for shadows and blurs.
 *
 * `script` and `foreignObject` are absent from that profile already — naming
 * them keeps the contract the prompt states explicit and pinned by a test.
 * `<style>` elements are removed as well: CSS inside a figure can pull in
 * other documents (`@import`, `url(...)`), which is invisible to the attribute
 * rule below and to every other rule here.
 */
export const SVG_SANITIZE_CONFIG: Config = {
	USE_PROFILES: { svg: true, svgFilters: true },
	FORBID_TAGS: ["script", "foreignObject", "style"],
};

/**
 * Whether an attribute value keeps a figure self-contained: a reference must
 * stay inside the document (`#id`), whether the browser resolves it as an
 * `href`/`src` attribute or as a CSS `url()` — a theme token like
 * `var(--accent)` or `currentColor` is not a reference and passes.
 */
export function isSelfContainedReference(name: string, value: string): boolean {
	if (REFERENCE_ATTRIBUTES[name.toLowerCase()]) return value.trim().startsWith("#");
	for (const match of value.matchAll(CSS_URL)) {
		if (!(match[2] ?? "").trim().startsWith("#")) return false;
	}
	return true;
}

/**
 * One instance for the app, carrying the reference rule as a hook. A dedicated
 * instance (rather than the shared default) keeps the hook off the instance
 * Mermaid sanitizes its own output with.
 */
let purifier: Purifier | null = null;

function getPurifier(): Purifier {
	if (purifier) return purifier;
	const instance = DOMPurify();
	// Without a DOM this is DOMPurify's bare factory (no `sanitize`, no `addHook`):
	// leave it untouched and let `sanitizeSvg` fail closed on `isSupported`.
	if (instance.isSupported) {
		instance.addHook("afterSanitizeAttributes", (element: Element) => {
			for (const attribute of Array.from(element.attributes)) {
				if (!isSelfContainedReference(attribute.name, attribute.value)) {
					element.removeAttribute(attribute.name);
				}
			}
		});
	}
	purifier = instance;
	return instance;
}

/** Sanitized SVG markup, or `null` when no drawable `<svg>` survived the policy. */
export function sanitizeSvg(source: string): string | null {
	const purify = getPurifier();
	// Without a DOM DOMPurify hands back its input untouched — fail closed instead,
	// so a call from a non-browser context can never reach the DOM as markup.
	if (!purify.isSupported) return null;
	const clean = purify.sanitize(source, SVG_SANITIZE_CONFIG);
	return /<svg[\s>]/i.test(clean) ? clean : null;
}
