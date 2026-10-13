/**
 * `zetacode skill install-official`: install the bundled official skills pack
 * (docx/xlsx/pptx/pdf) into the user skills directory as ordinary files the
 * user can edit and version, and `--uninstall` to hand those names back to the
 * built-in `zeta-official` provider.
 *
 * This is the explicit counterpart of the automatic session-startup install
 * (`createAgentSession`): the automatic path never overwrites an edited file
 * and leaves a user deletion alone, while this command repairs a partial
 * install by restoring deleted files. Neither path overwrites an edit — a
 * modified file is reported instead, so a user's change is never lost.
 */
import { CliUsageError } from "@linxiraos/pi-utils/cli";
import { installOfficialSkills, uninstallOfficialSkills } from "../discovery/official-skills";

const USAGE = "usage: zetacode skill install-official [--uninstall] [--dry-run] [--json]";

export async function handleSkillInstallOfficial(
	args: string[],
	options: { uninstall: boolean; dryRun: boolean; json: boolean },
): Promise<number> {
	if (args.length > 0) throw new CliUsageError(USAGE);

	if (options.uninstall) {
		const result = uninstallOfficialSkills({ dryRun: options.dryRun });
		if (options.json) {
			process.stdout.write(`${JSON.stringify({ ...result, dryRun: options.dryRun })}\n`);
			return 0;
		}
		process.stdout.write(`${options.dryRun ? "would remove" : "removed"} ${result.removed.length} file(s)\n`);
		for (const relative of result.removed) process.stdout.write(`  - ${relative}\n`);
		if (result.kept.length > 0) {
			process.stdout.write("kept (edited by you, left in place):\n");
			for (const relative of result.kept) process.stdout.write(`  ! ${relative}\n`);
		}
		process.stdout.write(
			"The official skills are served by the built-in provider again until you run `zetacode skill install-official`.\n",
		);
		return 0;
	}

	const result = installOfficialSkills({ mode: "explicit", dryRun: options.dryRun });
	if (!result) {
		process.stderr.write("install-official: no bundled official skills pack is available in this build\n");
		return 1;
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...result, dryRun: options.dryRun })}\n`);
		return 0;
	}

	process.stdout.write(`official skills ${options.dryRun ? "to install into" : "->"} ${result.dir}\n`);
	const buckets: Array<[string, string[]]> = [
		[options.dryRun ? "install" : "installed", result.installed],
		["upgrade", result.upgraded],
		["restore", result.restored],
		["kept (edited by you, left untouched)", result.kept],
	];
	for (const [label, files] of buckets) {
		if (files.length === 0) continue;
		process.stdout.write(`  ${label}: ${files.join(", ")}\n`);
	}
	if (result.unchanged && result.kept.length === 0) process.stdout.write("  already up to date\n");
	if (!options.dryRun) process.stdout.write("rollback: zetacode skill install-official --uninstall\n");
	return 0;
}
