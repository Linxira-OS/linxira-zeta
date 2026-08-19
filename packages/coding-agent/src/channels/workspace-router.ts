/**
 * workspace command router — parses channel messages beginning with `@workspace`.
 *
 * | sub-command | action |
 * |---|---|
 * | `@workspace list`  | reply with registered workspaces |
 * | `@workspace open <path>` | register an existing directory as a workspace |
 * | `@workspace create <path>` | mkdir -p the directory and register it |
 * | `@workspace close <name>` | stop the workspace session and unregister it |
 *
 * Messages that don't match any workspace command are returned as-is via
 * the `fallback` callback so the caller can inject them into the coordinator
 * session.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@linxiraos/pi-utils";

export interface WorkspaceRouterDeps {
	listWorkspaces(): string[];
	registerWorkspace(dir: string): void;
	unregisterWorkspace(name: string): void;
	openWorkspaceSession(dir: string): Promise<void>;
	closeWorkspaceSession(name: string): Promise<void>;
	sendText(text: string): Promise<void>;
	/** Called when the message is NOT a workspace command. */
	fallback(body: string, peer: string): Promise<void>;
	/** Start a remote plan-mode request (`@plan <title>`) on the coordinator. */
	planRequest(title: string): Promise<void>;
}

const PREFIX = "@workspace";
const PLAN_PREFIX = "@plan";

export async function routeWorkspaceCommand(body: string, peer: string, deps: WorkspaceRouterDeps): Promise<void> {
	const trimmed = body.trim();
	if (trimmed.toLowerCase().startsWith(PLAN_PREFIX)) {
		const title = trimmed.slice(PLAN_PREFIX.length).trim();
		if (!title) {
			await deps.sendText("Usage: @plan <task title>");
			return;
		}
		await deps.sendText("已开始制定计划…");
		// Fire-and-forget: the coordinator's planning turn runs in the
		// background and delivers the finished plan when it lands.
		void deps.planRequest(title).catch(error => {
			deps.sendText(`计划启动失败: ${error instanceof Error ? error.message : String(error)}`).catch(() => {});
		});
		return;
	}
	if (!trimmed.toLowerCase().startsWith(PREFIX)) {
		return deps.fallback(body, peer);
	}

	const rest = trimmed.slice(PREFIX.length).trim();
	const parts = rest.split(/\s+/);
	const cmd = parts[0]?.toLowerCase();

	switch (cmd) {
		case "list": {
			const dirs = deps.listWorkspaces();
			if (dirs.length === 0) {
				await deps.sendText("No workspaces registered.");
				return;
			}
			const list = dirs.map(d => `  ${d}`).join("\n");
			await deps.sendText(`Registered workspaces:\n${list}`);
			return;
		}

		case "open": {
			const dir = resolvePath(parts.slice(1).join(" "));
			if (!dir) {
				await deps.sendText("Usage: @workspace open <absolute-path>");
				return;
			}
			try {
				const stat = await fs.stat(dir);
				if (!stat.isDirectory()) {
					await deps.sendText(`Not a directory: ${dir}`);
					return;
				}
			} catch (error) {
				if (isEnoent(error)) {
					await deps.sendText(`Directory does not exist: ${dir}`);
					return;
				}
				logger.error("Failed to stat workspace directory", { dir, error: String(error) });
				await deps.sendText(`Failed to access ${dir}: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			deps.registerWorkspace(dir);
			await deps.openWorkspaceSession(dir);
			await deps.sendText(`Workspace opened: ${dir}`);
			return;
		}

		case "create": {
			const dir = resolvePath(parts.slice(1).join(" "));
			if (!dir) {
				await deps.sendText("Usage: @workspace create <absolute-path>");
				return;
			}
			try {
				await fs.mkdir(dir, { recursive: true });
			} catch (error) {
				logger.error("Failed to create workspace directory", { dir, error: String(error) });
				await deps.sendText(`Failed to create ${dir}: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			deps.registerWorkspace(dir);
			await deps.openWorkspaceSession(dir);
			await deps.sendText(`Workspace created and opened: ${dir}`);
			return;
		}

		case "close": {
			if (parts.length < 2) {
				await deps.sendText("Usage: @workspace close <name>");
				return;
			}
			const name = parts.slice(1).join(" ");
			await deps.closeWorkspaceSession(name);
			deps.unregisterWorkspace(name);
			await deps.sendText(`Workspace closed: ${name}`);
			return;
		}

		default:
			await deps.sendText(
				`Unknown @workspace command "${cmd}". Available: list, open <path>, create <path>, close <name>.`,
			);
	}
}

function resolvePath(p: string): string | null {
	const candidate = p.trim();
	if (!candidate) return null;
	if (path.isAbsolute(candidate)) return candidate;
	// Non-absolute: treat as relative to the current directory.
	// In practice only absolute paths are expected for workspace dirs.
	return null;
}
