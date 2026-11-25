/** The stats notice's terminal look: a blank row, then the dimmed message (the button is native-only). */
import { type Block, defineRolePainter, EMPTY_BLOCK } from "@linxiraos/pi-tui/term/paint";
import { wrap } from "@linxiraos/pi-tui/text/width";
import type { TspTextProps } from "@linxiraos/pi-wire";
import { terminalPaddingX } from "../terminal-padding";
import { plainText, propsOf } from "./common";

defineRolePainter("row", "zeta.statsNotice", (node, cx): Block => {
	const message = node.children().find(child => child.kind === "text");
	const text = message ? plainText(propsOf<TspTextProps>(message).spans) : "";
	if (text === "") return { rows: [""] };
	const paddingX = terminalPaddingX();
	const inner = cx.width - 2 * paddingX;
	if (inner <= 0) return EMPTY_BLOCK;
	const pad = " ".repeat(paddingX);
	return { rows: ["", ...wrap(cx.theme.fg("dim", text), inner).map(row => pad + row)] };
});
