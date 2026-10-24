/**
 * Decentralized `/share`: prepare a redacted transcript for the user's own
 * GitHub repository and hand the publication decision to the agent.
 *
 * Nothing here uploads. The prepared file is local; the agent runs the user's
 * `gh` CLI (or gives them exact manual commands) after checking authentication
 * and choosing a repository with them. This replaces the share-server relay
 * for slash-command sharing: a repository the user owns can be deleted,
 * audited, or kept private without any Zeta infrastructure in the path.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigRootDir } from "@linxiraos/pi-utils";
import type { AgentSession } from "../session/agent-session";
import type { SessionManager } from "../session/session-manager";

export interface PreparedShare {
	/** Redacted Markdown transcript ready to commit. */
	markdownPath: string;
	/** Original session JSONL; only for a machine-readable copy when asked. */
	sessionFile: string | undefined;
	/** True when secret obfuscation changed the text. */
	redacted: boolean;
	bytes: number;
}

/**
 * Write the transcript under the config root (0600) so the agent can copy it
 * into a checkout. The file is deliberately outside the project tree: `/share`
 * must not leave untracked product files in the user's repository.
 */
export async function prepareShareForGithub(
	session: AgentSession,
	sessionManager: SessionManager,
	options: { redact: boolean; dir?: string } = { redact: true },
): Promise<PreparedShare> {
	let markdown = session.formatSessionAsText();
	let redacted = false;
	const obfuscator = options.redact ? session.obfuscator : undefined;
	if (obfuscator?.hasSecrets()) {
		const before = markdown;
		markdown = obfuscator.obfuscate(markdown);
		redacted = markdown !== before;
	}
	const dir = options.dir ?? path.join(getConfigRootDir(), "share");
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const markdownPath = path.join(dir, `${sessionManager.getSessionId()}.md`);
	await fs.writeFile(markdownPath, `${markdown}\n`, { mode: 0o600 });
	return {
		markdownPath,
		sessionFile: sessionManager.getSessionFile(),
		redacted,
		bytes: Buffer.byteLength(markdown),
	};
}

/** Prompt that turns publication into an agent task instead of an upload. */
export function buildGithubSharePrompt(prepared: PreparedShare): string {
	const lines = [
		"The user invoked `/share`. Publish this session to a GitHub repository that the user owns. Do not upload it to `my.omp.sh`, a Zeta share server, or any other third party.",
		"",
		`Prepared redacted transcript: ${prepared.markdownPath}`,
		prepared.sessionFile
			? `Original session JSONL (do not commit unless the user asks for a machine-readable copy): ${prepared.sessionFile}`
			: "No persisted session file exists yet.",
		prepared.redacted
			? "Secret obfuscation changed the transcript before it was written."
			: "No known secret matched the obfuscator; inspect the file before publishing.",
		"",
		"Steps:",
		"1. Run `gh auth status`. If it fails, do not create or upload anything: tell the user to run `gh auth login`, and give them the exact manual commands (target repo/path plus `git add`, `git commit`, `git push`). Never ask the user to paste a token into chat.",
		"2. If authenticated, ask the user which repository (`owner/name`), branch, and path to use, and whether it should be private, unless they already named them. Do not create a public repository without an explicit choice.",
		"3. Copy the prepared Markdown transcript to the chosen path with a short header (session id, date, model, workspace). Keep the source JSONL out of the repository unless asked.",
		"4. Commit and push with `gh`/`git`; report the resulting file or commit URL. Do not paste the transcript into chat.",
		"5. If the transcript or destination path contains a credential, stop and report it instead of publishing.",
		"",
		"Return only after the file is public/private as chosen and the URL is known, or after giving the user actionable manual steps.",
	];
	return lines.join("\n");
}
