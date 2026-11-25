import { createSurface, startHost } from "@linxiraos/pi-tui";
import { jsx } from "@linxiraos/pi-tui/jsx-runtime";
import { loadThemeSync } from "@linxiraos/pi-tui/theme/loader";
import { fatal, installProcessHandlers } from "@linxiraos/pi-utils/postmortem";

const native = process.argv.includes("--native");
if (native) installProcessHandlers();

const theme = loadThemeSync("dark");
const surface = createSurface(() => ({
	main: jsx("text", { text: "safe transcript" }),
	dock: jsx("text", { text: "╰─ " }),
}));

await startHost({
	surface,
	theme: () => theme,
	native,
	// The PTY sends Enter only after a painted composer row or a native surface frame.
	onKey: key => {
		if (key.id !== "enter") return false;
		if (native) void Promise.reject(new Error("unhandled native PTY fixture"));
		else void fatal(new Error("fatal PTY fixture"));
		return true;
	},
});
