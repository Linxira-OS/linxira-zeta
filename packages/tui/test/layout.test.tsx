/** @jsxImportSource @linxiraos/pi-tui */
import { expect, test } from "bun:test";
import { signal } from "@linxiraos/pi-tui";
import { staticEnvironment } from "@linxiraos/pi-tui/term/paint";
import { renderBlock } from "@linxiraos/pi-tui/term/render";
import { PLAIN_THEME } from "@linxiraos/pi-tui/theme/plain";

test("smoke", () => {
	const name = signal("world");
	const tree = (
		<col gap="sm">
			<text>Hello {name}</text>
			<row gap="sm">
				<text>left</text>
				<text grow={1}>right</text>
			</row>
			<rule label="section" />
		</col>
	);
	const env = staticEnvironment(PLAIN_THEME);
	const first = renderBlock(tree as never, 20, { env });
	console.log(first.rows);
	expect(renderBlock(tree as never, 20, { env })).toBe(first);
	name.set("there");
	console.log(renderBlock(tree as never, 20, { env }).rows);
});
