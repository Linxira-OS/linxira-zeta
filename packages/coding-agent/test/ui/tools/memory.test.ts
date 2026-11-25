import { expect, test } from "bun:test";
import { staticEnvironment } from "@linxiraos/pi-tui/term/paint";
import { loadThemeSync } from "@linxiraos/pi-tui/theme/loader";
import "../../../src/ui/styles/tools/memory";
import { recallPresenter, reflectPresenter, retainPresenter } from "../../../src/ui/tools/memory";
import { ToolCall } from "../../../src/ui/transcript/tool-block";
import { toolScreenSuite } from "./presenter-corpus";
import { plainToolRows } from "./screens";

toolScreenSuite("retain", "retain", retainPresenter);
toolScreenSuite("recall", "recall", recallPresenter);
toolScreenSuite("reflect", "reflect", reflectPresenter);

test("retained memories paint with the ASCII preset's bullet", () => {
	const env = staticEnvironment(loadThemeSync("dark", { symbolPreset: "ascii" }));
	const call = new ToolCall({
		id: "retain-1",
		name: "retain",
		presenter: retainPresenter,
		args: { items: [{ content: "Pin the test clock." }] },
	});
	expect(plainToolRows(call, env)).toContain("  * Pin the test clock.");
});
