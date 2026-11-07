/** The hosted viewer resolves its canonical Marked import to the preloaded dependency. */
import type { Marked as MarkedConstructor } from "@linxiraos/pi-utils/marked";

declare global {
	var zetaMarkdown: { Marked: typeof MarkedConstructor };
}

export const Marked = globalThis.zetaMarkdown.Marked;
