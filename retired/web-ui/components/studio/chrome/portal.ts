/**
 * Portal target for chrome overlays.
 *
 * Every ported Studio sheet is scoped under `.studio-root`, so an overlay must
 * mount *inside* the Studio subtree — porting to `document.body` would drop
 * every `.studio-root .menu` / `.studio-root .cmdk-*` rule. The root is also the
 * theme's containing block, so fixed positioning behaves exactly as it did when
 * the rules were global.
 */
export function studioPortalTarget(): Element {
	if (typeof document === "undefined") throw new Error("studioPortalTarget: no document");
	return document.querySelector(".studio-root") ?? document.body;
}
