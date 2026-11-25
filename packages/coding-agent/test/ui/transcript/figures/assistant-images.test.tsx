/** @jsxImportSource @linxiraos/pi-tui */
import { expect, test } from "bun:test";
import { createRoot, signal, type UiNode } from "@linxiraos/pi-tui";
import { TerminalImages } from "@linxiraos/pi-tui/driver/images/store";
import { registerBlob } from "@linxiraos/pi-tui/native/blobs";
import { driverImages } from "@linxiraos/pi-tui/term/backend";
import { paintNode, staticEnvironment } from "@linxiraos/pi-tui/term/paint";
import { stripEscapes } from "@linxiraos/pi-tui/text/ansi";
import { loadThemeSync } from "@linxiraos/pi-tui/theme/loader";
import "../../../../src/ui/styles/messages";
import { KITTY } from "./harness";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";
const theme = loadThemeSync("dark");

test("assistant images draw through the terminal's images, else as `[Image: mime]`", () => {
	createRoot(dispose => {
		const blob = registerBlob(Buffer.from(PNG_1PX, "base64"), "image/png");
		const node = (
			<col role="omp.assistant">
				<image key="i0" blob={blob} w={16} h={32} alt="image/png" />
			</col>
		) as UiNode;
		const caps = signal(KITTY);
		const kitty = staticEnvironment(theme, {
			images: driverImages(new TerminalImages({ capabilities: caps }), caps),
		});
		const rows = paintNode(kitty, node, 40).rows;
		// 16×32 px on 8×16 cells: 2×2 cells, one cell in.
		expect(rows).toHaveLength(2);
		expect(rows.every(row => row.startsWith(" \x1b_Ga=p"))).toBe(true);
		expect(paintNode(staticEnvironment(theme), node, 40).rows.map(stripEscapes)).toEqual([" [Image: image/png]"]);
		dispose();
	});
});
