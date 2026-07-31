// Cleanup commands (omp cleansing tools surfaced as zeta commands):
// /cleanse: git clean -fd preview + apply; /gc: git gc + commit-graph maintenance.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function installCleanupCommands(api: ExtensionAPI): void {
	api.registerCommand("cleanse", {
		description: "Remove untracked files. Usage: /cleanse [--apply] (dry-run by default; --apply deletes untracked files/dirs)",
		handler: async (args, ctx) => {
			const apply = args.includes("--apply");
			const dryRun = apply ? [] : ["--dry-run"];
			const result = await api.exec("git", ["clean", "-fd", ...dryRun], { cwd: ctx.cwd });
			if (result.code !== 0) {
				ctx.ui.notify(`cleanse failed: ${result.stderr || result.stdout}`, "error");
				return;
			}
			ctx.ui.notify(
				apply
					? `Cleanse complete.${result.stdout ? `\n${result.stdout}` : ""}`
					: `Dry run. Untracked files would be removed:\n${result.stdout || "(none)"}\nRun /cleanse --apply to delete.`,
				"info",
			);
		},
	});

	api.registerCommand("gc", {
		description: "Run git garbage collection and maintenance. Usage: /gc [--aggressive]",
		handler: async (args, ctx) => {
			const aggressive = args.includes("--aggressive");
			const gc = await api.exec("git", ["gc", ...(aggressive ? ["--aggressive"] : [])], { cwd: ctx.cwd });
			if (gc.code !== 0) {
				ctx.ui.notify(`git gc failed: ${gc.stderr || gc.stdout}`, "error");
				return;
			}
			const maint = await api.exec("git", ["maintenance", "run"], { cwd: ctx.cwd });
			ctx.ui.notify(
				`git gc done.${gc.stdout ? `\n${gc.stdout}` : ""}${maint.code === 0 ? "\nmaintenance run complete" : `\nmaintenance failed: ${maint.stderr || maint.stdout}`}`,
				"info",
			);
		},
	});
}
