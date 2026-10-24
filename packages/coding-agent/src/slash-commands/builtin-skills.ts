import { SKILLS_REGISTRY_UNAVAILABLE } from "@linxiraos/pi-wire/skillshare";
import { M } from "../i18n";
import { Settings } from "../config/settings";
import { cfgSkillsRegistryUrl } from "../extensibility/settings";
import { getEmbeddedDoc } from "../internal-urls/docs-index";
import { SkillshareClient } from "../skillshare/client";
import { formatInstalledSkills, formatSkillSearch, listInstalledSkills } from "../skillshare/installer";
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

/**
 * Prompt-only install/update: the agent reads the built-in skills guide and
 * performs the operation with the tools of the conversation it is running in.
 * There is no second installer implementation and no registry assumption.
 */
async function buildSkillsDocPrompt(request: string): Promise<string> {
	const doc = await getEmbeddedDoc("skills.md");
	return [
		"The user invoked `/skills`. Handle the request in this conversation using its own file and shell tools.",
		"Do not assume a registry is configured. Read the built-in skills documentation below, then install to the project or user skill directory the user asked for; if the user gave a link, fetch and follow that link.",
		"Built-in documentation: `zeta://docs/skills.md`.",
		`Request: ${request}`,
		"",
		doc ?? "Built-in skills documentation is unavailable; read `zeta://docs/skills.md`.",
	].join("\n");
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
		handle: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			const cwd = runtime.sessionManager.getCwd();
			try {
				switch (verb) {
					case "search": {
						if (!rest) {
							await runtime.output("Usage: /skills search <query>");
							return;
						}
						const response = await withClient(cwd, client => client.search(rest));
						await runtime.output(formatSkillSearch(response));
						return;
					}
					case "installed": {
						await runtime.output(formatInstalledSkills(await listInstalledSkills(cwd)));
						return;
					}
					case "install":
					case "update":
						return { prompt: await buildSkillsDocPrompt(command.args) };
					case "":
					case "help":
						await runtime.output(USAGE);
						return;
					default:
						await runtime.output(`Unknown /skills subcommand: ${verb}\n\n${USAGE}`);
						return;
				}
			} catch (error) {
				await runtime.output(`Skills: ${errorMessage(error)}`);
			}
		},
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
					case "install":
					case "update":
						return { prompt: await buildSkillsDocPrompt(command.args) };
					case "installed": {
						ctx.showStatus(formatInstalledSkills(await listInstalledSkills(cwd)));
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
