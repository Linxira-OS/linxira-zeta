// Computer use tools via OS commands (port of omp computer use to system-level
// tool calls; pi has no native computer_use tool type).
// Platform backends: win32 (PowerShell), darwin (screencapture/cliclick/osascript), linux (xdotool/import).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Platform = "win32" | "darwin" | "linux";

function platform(): Platform {
	const p = process.platform;
	if (p === "win32" || p === "darwin" || p === "linux") return p;
	return "linux";
}

async function run(api: ExtensionAPI, command: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
	const result = await api.exec(command, args);
	return { ok: result.code === 0, out: result.stdout, err: result.stderr };
}

const WIN_SCREENSHOT_PS = [
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"$b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)",
	"$g = [System.Drawing.Graphics]::FromImage($b)",
	"$g.CopyFromScreen(0, 0, 0, 0, $b.Size)",
	'$b.Save($args[0])',
].join("; ");

const WIN_CLICK_PS = [
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int X,int Y);[DllImport(\"user32.dll\")]public static extern void mouse_event(uint dwFlags,uint dx,uint dy,uint dwData,int dwExtraInfo);}'",
	"$x=$args[0];$y=$args[1];$b=$args[2]",
	"[M]::SetCursorPos($x,$y)",
	"if($b -eq 'left'){[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0)}",
	"if($b -eq 'right'){[M]::mouse_event(8,0,0,0,0);[M]::mouse_event(16,0,0,0,0)}",
	"if($b -eq 'double'){[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0);[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0)}",
].join("; ");

const WIN_TYPE_PS = [
	"Add-Type -AssemblyName System.Windows.Forms",
	"foreach($ch in $args[0].ToCharArray()){ [System.Windows.Forms.SendKeys]::SendWait($ch) }",
].join("; ");

export function installComputerTools(api: ExtensionAPI): void {
	const p = platform();

	const doScreenshot = async (path: string): Promise<{ ok: boolean; out: string; err: string }> => {
		if (p === "darwin") return run(api, "screencapture", ["-x", path]);
		if (p === "linux") return run(api, "import", ["-window", "root", path]);
		return run(api, "powershell", ["-NoProfile", "-Command", `& { ${WIN_SCREENSHOT_PS} }`, path]);
	};

	const doMouse = async (x: number, y: number, button: "left" | "right" | "double"): Promise<{ ok: boolean; out: string; err: string }> => {
		if (p === "darwin") {
			const action = button === "right" ? "c" : "c";
			return run(api, "cliclick", [action, `${Math.round(x)},${Math.round(y)}`]);
		}
		if (p === "linux") {
			const args = ["mousemove", String(Math.round(x)), String(Math.round(y))];
			if (button !== "double") args.push("click", button === "right" ? "3" : "1");
			else args.push("click", "1", "1");
			return run(api, "xdotool", args);
		}
		return run(api, "powershell", ["-NoProfile", "-Command", `& { ${WIN_CLICK_PS} }`, String(Math.round(x)), String(Math.round(y)), button]);
	};

	const doType = async (text: string): Promise<{ ok: boolean; out: string; err: string }> => {
		if (p === "darwin") return run(api, "osascript", ["-e", `tell application "System Events" to keystroke ${JSON.stringify(text)}`]);
		if (p === "linux") return run(api, "xdotool", ["type", "--delay", "20", text]);
		return run(api, "powershell", ["-NoProfile", "-Command", `& { ${WIN_TYPE_PS} }`, text]);
	};

	const doOpen = async (target: string): Promise<{ ok: boolean; out: string; err: string }> => {
		if (p === "darwin") return run(api, "open", [target]);
		if (p === "linux") return run(api, "xdg-open", [target]);
		return run(api, "cmd", ["/c", "start", "", target]);
	};

	api.registerTool({
		name: "computer_screenshot",
		label: "Computer Screenshot",
		description: "Capture the screen to a PNG file and return its path. The model cannot see images, so prefer computer_screen_ocr or bash with tools that read the file.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Output path (default: /tmp/zeta-shot-<ts>.png)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const path = params.path ?? `/tmp/zeta-shot-${Date.now()}.png`;
			const r = await doScreenshot(path);
			return {
				content: [{ type: "text", text: r.ok ? `Screenshot saved: ${path}` : `Screenshot failed: ${r.err}` }],
				details: { path, ok: r.ok },
			};
		},
	});

	api.registerTool({
		name: "computer_mouse",
		label: "Computer Mouse",
		description: "Move the cursor and click at screen coordinates. Requires cliclick (macOS), xdotool (Linux), or runs via PowerShell (Windows).",
		parameters: Type.Object({
			x: Type.Number({ description: "Screen x coordinate" }),
			y: Type.Number({ description: "Screen y coordinate" }),
			button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("double")], { default: "left" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const r = await doMouse(params.x, params.y, params.button ?? "left");
			return {
				content: [{ type: "text", text: r.ok ? `Clicked (${params.x}, ${params.y}).` : `Mouse failed: ${r.err}` }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "computer_type",
		label: "Computer Type",
		description: "Type text at the focused input. Requires cliclick/osascript (macOS), xdotool (Linux), or runs via PowerShell SendKeys (Windows).",
		parameters: Type.Object({
			text: Type.String({ description: "Text to type" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const r = await doType(params.text);
			return {
				content: [{ type: "text", text: r.ok ? "Typed." : `Typing failed: ${r.err}` }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "computer_open",
		label: "Computer Open",
		description: "Open a file, folder, or URL with the default application.",
		parameters: Type.Object({
			target: Type.String({ description: "File path, folder, or URL" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const r = await doOpen(params.target);
			return {
				content: [{ type: "text", text: r.ok ? `Opened: ${params.target}` : `Open failed: ${r.err}` }],
				details: undefined,
			};
		},
	});

	api.registerTool({
		name: "computer_screen_ocr",
		label: "Computer Screen OCR",
		description: "Capture the screen and OCR it into text. Requires tesseract (any platform). Returns the recognized text.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Temporary image path (default: /tmp/zeta-ocr-<ts>.png)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const path = params.path ?? `/tmp/zeta-ocr-${Date.now()}.png`;
			const shot = await doScreenshot(path);
			if (!shot.ok) {
				return { content: [{ type: "text", text: `Screenshot failed: ${shot.err}` }], details: undefined };
			}
			const ocr = await run(api, "tesseract", [path, "stdout"]);
			return {
				content: [{ type: "text", text: ocr.ok ? (ocr.out.trim() || "(no text recognized)") : `OCR failed (is tesseract installed?): ${ocr.err}` }],
				details: undefined,
			};
		},
	});
}
