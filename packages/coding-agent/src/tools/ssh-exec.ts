/**
 * ssh_exec — run a shell command on a configured remote host over SSH.
 *
 * Wraps the retained connection-manager stack (`/ssh add` hosts,
 * control-master reuse, host probes). Long-running interactive commands are
 * out of scope; the tool is for inspection and one-shot remote actions.
 */

import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { getSSHConfigPath, ptree } from "@linxiraos/pi-utils";
import sshExecDescription from "../prompts/tools/ssh-exec.md" with { type: "text" };
import { readSSHConfigFile } from "../ssh/config-writer";
import type { SSHConnectionTarget } from "../ssh/connection-manager";
import { buildRemoteCommand, ensureConnection } from "../ssh/connection-manager";
import type { ToolSession } from "./index";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 20_000;

const sshExecSchema = type({
	host: type("string > 0").describe(
		'Connection name from `/ssh add` / `/ssh list` (e.g. "build-server"). Not an user@host string.',
	),
	command: type("string > 0").describe(
		'Shell command to run on the remote host, e.g. "systemctl status nginx" or "tail -n 50 /var/log/app.log".',
	),
	"timeoutMs?": type("number").describe(
		`Kill the remote command after this many milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
	),
});

export type SshExecParams = typeof sshExecSchema.infer;

export async function resolveTarget(name: string): Promise<SSHConnectionTarget | undefined> {
	const projectPath = getSSHConfigPath("project");
	const userPath = getSSHConfigPath("user");
	const [projectConfig, userConfig] = await Promise.all([readSSHConfigFile(projectPath), readSSHConfigFile(userPath)]);
	const merged = { ...(userConfig.hosts ?? {}), ...(projectConfig.hosts ?? {}) };
	const host = merged[name];
	if (!host) return undefined;
	return {
		name,
		host: host.host,
		username: host.username,
		port: host.port,
		keyPath: host.keyPath,
		compat: host.compat,
	};
}

function capOutput(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated (${text.length} chars total)`;
}

export class SshExecTool implements AgentTool<typeof sshExecSchema> {
	readonly name = "ssh_exec";
	readonly approval = "write" as const;
	readonly label = "SSH Exec";
	readonly summary = "Run a shell command on a configured remote host over SSH";
	readonly description = sshExecDescription;
	readonly parameters = sshExecSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: SshExecParams): Promise<AgentToolResult> {
		const target = await resolveTarget(params.host);
		if (!target) {
			return {
				content: [
					{
						type: "text",
						text: `No SSH host named "${params.host}" is configured. Available names come from /ssh add (project or user scope). Run /ssh list for the user-side view.`,
					},
				],
				isError: true,
			};
		}

		const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
		try {
			await ensureConnection(target);
			const args = await buildRemoteCommand(target, params.command);
			const result = await ptree.exec(["ssh", ...args], {
				timeout: timeoutMs,
				allowNonZero: true,
				allowAbort: true,
				stderr: "full",
			});
			const exitCode = result.exitCode ?? 0;
			const parts = [`exit code: ${exitCode}`];
			if (result.stdout.trim()) parts.push(`stdout:\n${capOutput(result.stdout.trim())}`);
			if (result.stderr.trim()) parts.push(`stderr:\n${capOutput(result.stderr.trim())}`);
			return {
				content: [{ type: "text", text: parts.join("\n\n") }],
				isError: exitCode !== 0,
			};
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `ssh_exec failed on "${params.host}": ${msg}` }],
				isError: true,
			};
		}
	}
}
