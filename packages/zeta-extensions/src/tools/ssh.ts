// SSH tools (port of omp ssh toolset, simplified to direct ssh execution)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function installSshTools(api: ExtensionAPI): void {
	api.registerTool({
		name: "ssh_exec",
		label: "SSH Exec",
		description:
			"Run a command on a remote host over SSH. Uses ~/.ssh/config aliases, key-based auth, or a provided password via sshpass. The remote working directory defaults to the login home.",
		parameters: Type.Object({
			host: Type.String({ description: "Host alias from ~/.ssh/config or user@host" }),
			command: Type.String({ description: "Command to run on the remote host" }),
			cwd: Type.Optional(Type.String({ description: "Remote working directory (default: login home)" })),
			password: Type.Optional(Type.String({ description: "Password for non-key auth (uses sshpass)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const remoteCmd = params.cwd ? `cd ${JSON.stringify(params.cwd)} && ${params.command}` : params.command;
			const args = [params.host, remoteCmd];
			if (params.password) {
				const result = await api.exec("sshpass", ["-p", params.password, "ssh", ...args], { signal });
				return {
					content: [
						{
							type: "text",
							text: `exit ${result.code}\n${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`,
						},
					],
					details: { code: result.code },
				};
			}
			const result = await api.exec("ssh", ["-o", "BatchMode=yes", ...args], { signal });
			return {
				content: [
					{
						type: "text",
						text: `exit ${result.code}\n${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`,
					},
				],
				details: { code: result.code },
			};
		},
	});

	api.registerTool({
		name: "ssh_list_hosts",
		label: "SSH List Hosts",
		description: "List hosts from ~/.ssh/config.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const result = await api.exec("sh", ["-c", "grep -E '^Host ' ~/.ssh/config 2>/dev/null || true"]);
			const hosts = result.stdout
				.split("\n")
				.map((l) => l.replace(/^Host\s+/, "").trim())
				.filter((h) => h && !h.startsWith("*"));
			return {
				content: [{ type: "text", text: hosts.length ? hosts.join("\n") : "(no hosts in ~/.ssh/config)" }],
				details: undefined,
			};
		},
	});
}

export function installSshCommand(api: ExtensionAPI): void {
	api.registerCommand("ssh", {
		description: "List SSH config hosts. Usage: /ssh [host]",
		handler: async (args, ctx) => {
			const host = args.trim();
			if (!host) {
				const result = await api.exec("sh", ["-c", "grep -E '^Host ' ~/.ssh/config 2>/dev/null || true"], { cwd: ctx.cwd });
				ctx.ui.notify(result.stdout.trim() || "(no hosts in ~/.ssh/config)", "info");
				return;
			}
			const result = await api.exec("ssh", ["-o", "BatchMode=yes", host, "echo connected"], { cwd: ctx.cwd });
			ctx.ui.notify(result.code === 0 ? `SSH OK: ${host}` : `SSH failed: ${result.stderr || result.stdout}`, result.code === 0 ? "info" : "error");
		},
	});
}
