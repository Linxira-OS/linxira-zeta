// /commit + commit tool: git add + commit (port of omp commit tool, simplified)
import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

async function runGit(api: ExtensionAPI, args: string[], cwd: string): Promise<ExecResult> {
	return api.exec("git", args, { cwd });
}

export function installCommit(api: ExtensionAPI): void {
	const gitStatus = async (ctx: { cwd: string }): Promise<string> => {
		const status = await runGit(api, ["status", "--short"], ctx.cwd);
		return status.stdout.trim();
	};

	api.registerTool({
		name: "commit",
		label: "Commit",
		description:
			"Stage all changes and create a git commit. Use after verifying your changes. Returns the commit result. Message format: follow the repo's commit conventions when visible.",
		parameters: Type.Object({
			message: Type.String({ description: "Commit message" }),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Paths to stage (default: all changes)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paths = params.paths?.length ? params.paths : ["-A"];
			const add = await runGit(api, ["add", ...paths], ctx.cwd);
			if (add.code !== 0) {
				return {
					content: [{ type: "text", text: `git add failed:\n${add.stderr || add.stdout}` }],
					details: undefined,
				};
			}
			const commit = await runGit(api, ["commit", "-m", params.message], ctx.cwd);
			const details = await gitStatus(ctx);
			return {
				content: [{ type: "text", text: commit.stdout || commit.stderr || "committed" }],
				details: { remaining: details },
			};
		},
	});

	api.registerCommand("commit", {
		description: "Stage all changes and commit. Usage: /commit <message>",
		handler: async (args, ctx) => {
			const message = args.trim();
			if (!message) {
				const status = await gitStatus(ctx);
				ctx.ui.notify(`Usage: /commit <message>\n\nWorking tree:\n${status || "(clean)"}`, "warning");
				return;
			}
			const add = await runGit(api, ["add", "-A"], ctx.cwd);
			if (add.code !== 0) {
				ctx.ui.notify(`git add failed: ${add.stderr || add.stdout}`, "error");
				return;
			}
			const commit = await runGit(api, ["commit", "-m", message], ctx.cwd);
			ctx.ui.notify(commit.stdout.trim() || commit.stderr.trim(), commit.code === 0 ? "info" : "error");
		},
	});
}
