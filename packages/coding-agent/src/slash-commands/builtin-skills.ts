import { SKILLS_REGISTRY_UNAVAILABLE } from "@linxiraos/pi-wire/skillshare";
import { M } from "../i18n";
import { Settings } from "../config/settings";
import { cfgSkillsRegistryUrl } from "../extensibility/settings";
import type { InteractiveModeContext } from "../modes/types";
import { SkillshareClient } from "../skillshare/client";
import {
	formatInstalledSkills,
	formatScriptApproval,
	formatSkillChanges,
	formatSkillSearch,
	installSkillPackages,
	listInstalledSkills,
	type SkillChange,
	type SkillInstallHooks,
	updateSkillPackages,
} from "../skillshare/installer";
import { clearSubmittedText } from "./helpers/draft";
import { errorMessage, parseSubcommand } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

const USAGE = [
	"No skill registry ships with Zeta. Extra skills come from the npm package",
	"@linxiraos/linxira-skills (`npm i -g @linxiraos/linxira-skills`), or set",
	"your own registry URL in skills.registryUrl.",
	"",
	"Skill registry commands:",
	"  /skills search <query>                        Search the configured registry",
	"  /skills install <@scope/name[@range]>… [-g]   Install into this project (-g: user-global)",
	"  /skills installed                             List installed registry skills",
	"  /skills update [@scope/name…] [-g]            Update within the ranges in skills.json",
].join("\n");

/** Split `<name…> [--global|-g]`; unknown flags are errors. */
function parseTargets(rest: string): { names: string[]; global: boolean } | { error: string } {
	const names: string[] = [];
	let global = false;
	for (const token of rest.split(/\s+/)) {
		if (!token) continue;
		if (token === "--global" || token === "-g") global = true;
		else if (token.startsWith("-")) return { error: `Unknown option: ${token}\n\n${USAGE}` };
		else names.push(token);
	}
	return { names, global };
}

async function withClient<T>(cwd: string, run: (client: SkillshareClient) => Promise<T>): Promise<T> {
	const settings = await Settings.loadReadOnly({ cwd });
	if (!cfgSkillsRegistryUrl.get(settings).trim()) throw new Error(SKILLS_REGISTRY_UNAVAILABLE);
	const client = await SkillshareClient.create();
	try {
		return await run(client);
	} finally {
		client.close();
	}
}

function tuiHooks(ctx: InteractiveModeContext): SkillInstallHooks {
	return {
		warn: message => ctx.showWarning(message),
		confirmScripts: request => ctx.showHookConfirm("Install skill with scripts?", formatScriptApproval(request)),
	};
}

async function reportChanges(ctx: InteractiveModeContext, changes: SkillChange[]): Promise<void> {
	if (changes.length === 0) {
		ctx.showStatus("Registry skills are already up to date.");
		return;
	}
	await ctx.refreshSkillState();
	ctx.showStatus(formatSkillChanges(changes));
}

export const BUILTIN_SKILLS_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "skills",
		icon: "skill",
		description: () => M.cmdSkills,
		subcommands: [
			{ name: "search", description: () => M.cmdSkillsSearch, usage: "<query>" },
			{ name: "install", description: () => M.cmdSkillsInstall, usage: "<@scope/name[@range]>… [--global]" },
			{ name: "installed", description: () => M.cmdSkillsInstalled },
			{
				name: "update",
				description: () => M.cmdSkillsUpdate,
				usage: "[@scope/name…] [--global]",
			},
		],
		allowArgs: true,
		handleTui: async (command, runtime) => {
			const { ctx } = runtime;
			clearSubmittedText(runtime);
			const { verb, rest } = parseSubcommand(command.args);
			const cwd = ctx.sessionManager.getCwd();
			try {
				switch (verb) {
					case "search": {
						if (!rest) {
							ctx.showError("Usage: /skills search <query>");
							return;
						}
						const response = await withClient(cwd, client => client.search(rest));
						ctx.showStatus(formatSkillSearch(response));
						return;
					}
					case "install": {
						const targets = parseTargets(rest);
						if ("error" in targets) {
							ctx.showError(targets.error);
							return;
						}
						if (targets.names.length === 0) {
							ctx.showError("Usage: /skills install <@scope/name[@range]>… [--global]");
							return;
						}
						ctx.showStatus(`Installing ${targets.names.join(", ")}…`, { dim: true });
						const changes = await withClient(cwd, client =>
							installSkillPackages(
								client,
								{ specs: targets.names, global: targets.global, yes: false, cwd },
								tuiHooks(ctx),
							),
						);
						await reportChanges(ctx, changes);
						return;
					}
					case "installed": {
						ctx.showStatus(formatInstalledSkills(await listInstalledSkills(cwd)));
						return;
					}
					case "update": {
						const targets = parseTargets(rest);
						if ("error" in targets) {
							ctx.showError(targets.error);
							return;
						}
						ctx.showStatus("Checking the registry for updates…", { dim: true });
						const changes = await withClient(cwd, client =>
							updateSkillPackages(client, { names: targets.names, global: targets.global, cwd }, tuiHooks(ctx)),
						);
						await reportChanges(ctx, changes);
						return;
					}
					case "":
					case "help":
						ctx.showStatus(USAGE);
						return;
					default:
						ctx.showError(`Unknown /skills subcommand: ${verb}\n\n${USAGE}`);
						return;
				}
			} catch (error) {
				ctx.showError(`Skills: ${errorMessage(error)}`);
			}
		},
	},
];
