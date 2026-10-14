/**
 * Minimal ambient declaration for the `figlet` renderer.
 *
 * The package ships no types; `scripts/brand/logo-art.ts` only needs the two
 * calls below (standard-font parse + synchronous render).
 */
declare module "figlet" {
	export interface FigletOptions {
		font?: string;
		horizontalLayout?: "default" | "full" | "fitted" | "controlled smushing" | "universal smushing";
		verticalLayout?: "default" | "full" | "fitted" | "controlled smushing" | "universal smushing";
	}
	export interface FigletFont {
		/** Parse a `.flf` font file into the renderer's registry under `name`. */
		parseFont(name: string, data: string): void;
		/** Render `text` synchronously; unknown glyphs render as the font's blank. */
		textSync(text: string, options?: FigletOptions): string;
	}
	const figlet: FigletFont;
	export default figlet;
}
