/**
 * Default workspace (`~/.zeta/workspace`): the landing point for chats with no
 * repository selected and for IM bot conversations.
 *
 * The default workspace is a real, self-explaining repository: `zeta serve`
 * initialises it on startup (directory → `git init` → layered settings →
 * official `AGENTS.md` → persona → first commit). Every step is additive: an
 * existing file is never overwritten, and a second startup with nothing missing
 * writes nothing and commits nothing.
 *
 * The persona is scoped to this directory only. It is appended to the system
 * prompt after the global `personality` block (see `system-prompt.ts`), so a
 * workspace persona may override the global communication style; no other
 * repository ever sees it. Memory stays a project-layer setting: the default
 * workspace opts itself into `mnemopi` while the user layer remains `off`, so
 * every other repository keeps the backend off unless it opts in.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { logger } from "@linxiraos/pi-utils";

/** Workspace directory name under the config root. */
export const DEFAULT_WORKSPACE_DIRNAME = "workspace";

/** Agent-facing document shipped with the default workspace. */
export const DEFAULT_WORKSPACE_AGENTS_FILENAME = "AGENTS.md";

/** Workspace-scoped persona document, injected only for this cwd. */
export const DEFAULT_WORKSPACE_PERSONA_FILENAME = "PERSONA.md";

/** Project-layer settings file, relative to the workspace root. */
export const DEFAULT_WORKSPACE_SETTINGS_RELPATH = path.join(".zeta", "settings.json");

/** Commit subject of the first (and only init-time) commit. */
export const DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT = "Initialize default workspace";

/**
 * Stable default workspace (`~/.zeta/workspace`) anchoring the coordinator
 * session. The serve process cwd is whatever directory launched it — on
 * desktop installs the app install dir, which is not a meaningful workspace
 * and left the default workspace invisible in the web UI project list.
 */
export function defaultCoordinatorWorkspace(): string {
	// Explicit override for non-standard installs, tests, and smoke runs against
	// a temp config root. Unset → the stable `~/.zeta/workspace` location.
	const override = process.env.ZETA_DEFAULT_WORKSPACE?.trim();
	return override ? path.resolve(override) : path.join(os.homedir(), ".zeta", DEFAULT_WORKSPACE_DIRNAME);
}

/** True when `cwd` is the default workspace (exact directory, not a descendant). */
export function isDefaultWorkspace(cwd: string | undefined): boolean {
	if (!cwd) return false;
	const resolve = (value: string) => {
		const absolute = path.resolve(value);
		return process.platform === "win32" ? absolute.toLowerCase() : absolute;
	};
	return resolve(cwd) === resolve(defaultCoordinatorWorkspace());
}

/** Absolute persona path for a workspace directory. */
export function workspacePersonaPath(workspaceDir: string): string {
	return path.join(workspaceDir, DEFAULT_WORKSPACE_PERSONA_FILENAME);
}

/** Absolute project-settings path for a workspace directory. */
export function workspaceSettingsPath(workspaceDir: string): string {
	return path.join(workspaceDir, DEFAULT_WORKSPACE_SETTINGS_RELPATH);
}

/**
 * Read the persona document for `workspaceDir`. Returns `null` unless the
 * directory is the default workspace, the file exists, and it has content; a
 * missing or empty file leaves the prompt untouched.
 */
export async function loadWorkspacePersona(cwd: string | undefined): Promise<string | null> {
	if (!isDefaultWorkspace(cwd)) return null;
	return readNonEmptyFile(workspacePersonaPath(cwd as string));
}

/** Whether a persona document exists and carries content for `cwd`. */
export async function hasWorkspacePersona(cwd: string | undefined): Promise<boolean> {
	return (await loadWorkspacePersona(cwd)) !== null;
}

async function readNonEmptyFile(filePath: string): Promise<string | null> {
	try {
		const content = (await fs.promises.readFile(filePath, "utf8")).trim();
		return content.length > 0 ? content : null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			logger.warn("Failed to read default-workspace file", {
				path: filePath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return null;
	}
}

/**
 * Project-layer memory backend for a workspace directory, or `"off"` when the
 * workspace does not opt in. This reports the project layer only; the user
 * layer stays `off` by contract, and other repositories inherit that default.
 * Both project files are checked: `.zeta/settings.json` first, then
 * `.zeta/config.yml`.
 */
export function workspaceMemoryBackend(workspaceDir: string): string {
	const candidates = [workspaceSettingsPath(workspaceDir), path.join(workspaceDir, ".zeta", "config.yml")];
	for (const filePath of candidates) {
		try {
			const raw = fs.readFileSync(filePath, "utf8");
			const parsed = (filePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw)) as {
				memory?: { backend?: unknown };
			};
			const backend = parsed?.memory?.backend;
			if (typeof backend === "string" && backend.trim()) return backend;
		} catch {
			// Missing or malformed lower-priority file; fall through.
		}
	}
	return "off";
}

/** Official agent-facing document written into a fresh default workspace. */
export const DEFAULT_WORKSPACE_AGENTS_MD = `# Default workspace

This directory is the **landing point** for:

- chats with no repository selected, and
- IM bot conversations (WeChat / Feishu / Telegram).

It is the coordinator's home. It is not a code checkout — route real work to a
repository.

## What lives here

- \`PERSONA.md\` — the coordinator persona. It applies **only** to sessions whose
  cwd is this directory; it is layered after the global \`personality\` block and
  may override its style.
- Long-term memory — \`memory.backend\` is \`mnemopi\` in
  \`.zeta/settings.json\` (project layer only; the user layer stays \`off\`).
  Memories are stored per project cwd and never leak into other repositories.
- Cross-repo dispatch — use \`workspace_run\` to send a task to a registered
  workspace's main agent; only the coordinator replies to the user.

## Switching a chat to a real repository

- IM: \`@workspace list\`, then \`@workspace use <alias>\` for this chat (or
  \`@workspace bind <alias>\` to persist it). \`@workspace relay\` / \`*main\`
  switches back here.
- GUI: select the repository as the chat's project.
- CLI: start in, or \`cd\` to, the repository.

\`@status\` reports the current workspace, route (direct/relay), persona,
memory backend, and report policy.
`;

/** Persona shipped with a fresh default workspace. */
export const DEFAULT_WORKSPACE_PERSONA_MD = `# Persona — default workspace

You are the coordinator of this machine's default workspace. Chats arrive here
when no repository was selected and from IM bots.

- Answer directly when the request does not depend on a repository.
- When the work belongs to a repository, delegate with \`workspace_run\`
  instead of pretending this directory is that repository.
- Report delegated results as one concise summary; ask before interrupting the
  user again unless the task failed.
- Keep this workspace's persona and long-term memory out of other repositories.
`;

export interface DefaultWorkspaceInitResult {
	/** Absolute workspace directory. */
	workspace: string;
	/** True when this run created `.git`. */
	gitInitialized: boolean;
	/** Workspace-relative paths written by this run (empty ⇒ no change). */
	created: string[];
	/** True when this run created the initial commit. */
	committed: boolean;
	/** Subject of the commit created by this run, when any. */
	commitSubject?: string;
}

export interface DefaultWorkspaceInitOptions {
	/** Override the workspace directory (tests, temp config roots). */
	workspace?: string;
	/** Override `git` binary (tests). Defaults to `git` on PATH. */
	gitBinary?: string;
}

interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

function runGit(cwd: string, args: string[], gitBinary = "git"): GitResult {
	try {
		const result = Bun.spawnSync({
			cmd: [gitBinary, ...args],
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
		return {
			ok: result.exitCode === 0,
			stdout: result.stdout.toString().trim(),
			stderr: result.stderr.toString().trim(),
		};
	} catch (error) {
		return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
}

/** Write `content` only when the file is absent; never overwrite user edits. */
function writeIfMissing(filePath: string, content: string): boolean {
	try {
		fs.writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
		throw error;
	}
}

/**
 * Initialise the default workspace in place.
 *
 * Order: create the directory → `git init` (when `.git` is missing) → project
 * settings (`memory.backend: mnemopi`) → `AGENTS.md` → `PERSONA.md` → first
 * commit. Existing files are never replaced, so a second call is a no-op and a
 * user-edited `AGENTS.md` survives untouched.
 */
export async function initializeDefaultWorkspace(
	options: DefaultWorkspaceInitOptions = {},
): Promise<DefaultWorkspaceInitResult> {
	const workspace = path.resolve(options.workspace ?? defaultCoordinatorWorkspace());
	const created: string[] = [];
	let gitInitialized = false;
	let committed = false;
	let commitSubject: string | undefined;

	fs.mkdirSync(workspace, { recursive: true });

	const gitDir = path.join(workspace, ".git");
	if (!fs.existsSync(gitDir)) {
		const init = runGit(workspace, ["init", "--quiet"], options.gitBinary);
		if (init.ok) {
			gitInitialized = true;
			created.push(".git/");
		} else {
			logger.warn("Default workspace: git init failed; continuing without version control", {
				workspace,
				error: init.stderr || "git init exited non-zero",
			});
		}
	}

	const settingsPath = workspaceSettingsPath(workspace);
	const settingsWritten = (() => {
		try {
			fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
			return writeIfMissing(settingsPath, `${JSON.stringify({ memory: { backend: "mnemopi" } }, null, 2)}\n`);
		} catch (error) {
			logger.warn("Default workspace: failed to write project settings", {
				workspace,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	})();
	if (settingsWritten) created.push(DEFAULT_WORKSPACE_SETTINGS_RELPATH.replaceAll("\\", "/"));

	const agentsWritten = (() => {
		try {
			return writeIfMissing(path.join(workspace, DEFAULT_WORKSPACE_AGENTS_FILENAME), DEFAULT_WORKSPACE_AGENTS_MD);
		} catch (error) {
			logger.warn("Default workspace: failed to write AGENTS.md", {
				workspace,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	})();
	if (agentsWritten) created.push(DEFAULT_WORKSPACE_AGENTS_FILENAME);

	const personaWritten = (() => {
		try {
			return writeIfMissing(workspacePersonaPath(workspace), DEFAULT_WORKSPACE_PERSONA_MD);
		} catch (error) {
			logger.warn("Default workspace: failed to write PERSONA.md", {
				workspace,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	})();
	if (personaWritten) created.push(DEFAULT_WORKSPACE_PERSONA_FILENAME);

	// Commit only what this run added: a second startup writes nothing and must
	// not sweep up user edits (or unrelated files) into a new commit.
	if (gitInitialized || created.length > 0) {
		const managed = [
			DEFAULT_WORKSPACE_AGENTS_FILENAME,
			DEFAULT_WORKSPACE_PERSONA_FILENAME,
			DEFAULT_WORKSPACE_SETTINGS_RELPATH,
		].map(relative => relative.replaceAll("\\", "/"));
		const staged = runGit(workspace, ["add", "--", ...managed], options.gitBinary);
		if (!staged.ok) {
			logger.warn("Default workspace: git add failed", { workspace, error: staged.stderr });
		} else {
			const commitArgs = ["commit", "--quiet", "-m", DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT];
			let commit = runGit(workspace, commitArgs, options.gitBinary);
			// A fresh machine may have no global identity; retry the commit with a
			// repository-local identity instead of writing config proactively.
			if (!commit.ok && /user\.(name|email)|who you are|auto-detect/i.test(commit.stderr)) {
				commit = runGit(
					workspace,
					["-c", "user.name=Zeta", "-c", "user.email=zeta@localhost", ...commitArgs],
					options.gitBinary,
				);
			}
			if (commit.ok) {
				committed = true;
				commitSubject = DEFAULT_WORKSPACE_INIT_COMMIT_SUBJECT;
			} else {
				logger.warn("Default workspace: initial commit failed", { workspace, error: commit.stderr });
			}
		}
	}

	return { workspace, gitInitialized, created, committed, commitSubject };
}
