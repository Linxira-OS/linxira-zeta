/**
 * POST /api/open — opens a terminal, file-manager, or editor at a given path.
 *
 * Body: { target: "terminal"|"explorer"|"editor", path?: string }
 *   path defaults to the current project root when omitted.
 * Returns: { spawned: true } or { error: "no_app_found" }.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectDir } from "@linxiraos/pi-utils";
import { $ } from "bun";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const TERMINAL_CMDS: Record<string, string[]> = {
	win32: ["wt", "-d", "{dir}"],
	darwin: ["open", "-a", "Terminal", "{dir}"],
	linux: ["x-terminal-emulator", "--working-directory={dir}"],
};

const EXPLORER_CMDS: Record<string, string[]> = {
	win32: ["explorer", "{dir}"],
	darwin: ["open", "{dir}"],
	linux: ["xdg-open", "{dir}"],
};

const EDITOR_CLIS: Record<string, string> = {
	vscode: "code",
	cursor: "cursor",
	codium: "codium",
	windsurf: "windsurf",
	zed: "zed",
};

async function resolveEditor(): Promise<string[]> {
	const available: string[] = [];
	for (const [name, cli] of Object.entries(EDITOR_CLIS)) {
		try {
			const result = await $`${cli} --version`.quiet().nothrow();
			if (result.exitCode === 0) available.push(name);
		} catch {
			// not found
		}
	}
	return available;
}

export async function handleOpenGet(_req: Request): Promise<Response> {
	const editors = await resolveEditor();
	const platform = os.platform() as keyof typeof TERMINAL_CMDS;
	return json({
		terminal: platform in TERMINAL_CMDS,
		explorer: platform in EXPLORER_CMDS,
		editors,
	});
}

export async function handleOpenPost(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { target?: string; path?: string };
		const target = body.target ?? "terminal";
		const dir = body.path ? path.resolve(body.path) : getProjectDir();

		if (!fs.existsSync(dir)) {
			return json({ error: `Directory does not exist: ${dir}` }, 400);
		}

		const platform = os.platform() as keyof typeof TERMINAL_CMDS;

		let args: string[] | null = null;

		if (target === "terminal" && platform in TERMINAL_CMDS) {
			args = TERMINAL_CMDS[platform].map(a => a.replace("{dir}", dir));
		} else if (target === "explorer" && platform in EXPLORER_CMDS) {
			args = EXPLORER_CMDS[platform].map(a => a.replace("{dir}", dir));
		} else if (target === "editor") {
			const editors = await resolveEditor();
			const editorName = (body as { editor?: string }).editor;
			if (editors.length === 0) return json({ error: "no_app_found" }, 404);
			const chosen = editorName ?? editors[0];
			const cli = EDITOR_CLIS[chosen];
			if (!cli) return json({ error: `unknown editor: ${chosen}` }, 400);
			args = [cli, dir];
		}

		if (!args) return json({ error: "no_app_found" }, 404);

		Bun.spawn(args, { cwd: dir, detached: true, stdio: ["ignore", "ignore", "ignore"] });
		return json({ spawned: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
