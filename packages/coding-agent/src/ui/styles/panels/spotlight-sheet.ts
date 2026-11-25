/** The Spotlight sheet in the terminal: its head line and how to close it (the sheet itself is native). */
import { type Block, defineRolePainter } from "@linxiraos/pi-tui/term/paint";
import { truncate } from "@linxiraos/pi-tui/text/width";
import { termOf } from "./common";

defineRolePainter("col", "zeta.spotlight", (node, cx): Block => {
	const head = termOf<{ head: string }>(node).head ?? "";
	const ellipsis = cx.theme.symbols.ellipsis;
	return { rows: [truncate(head, cx.width, ellipsis), truncate("Esc closes", cx.width, ellipsis)] };
});
