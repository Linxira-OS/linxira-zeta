/**
 * Install, publish, and manage skills. Zeta ships no registry: extra skills
 * come from the npm package `@linxiraos/linxira-skills`, and the registry
 * commands require a user-configured `skills.registryUrl`.
 */
import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { SKILLS_REGISTRY_UNAVAILABLE, type SkillSearchSort } from "@linxiraos/pi-wire/skillshare";
import { skillHelp as commandHelp } from "../cli/command-help";
import { runSkillCommand, SKILL_ACTIONS, SKILL_USAGE, type SkillAction } from "../cli/skill-cli";
import { Settings } from "../config/settings";
import { cfgSkillsRegistryUrl } from "../extensibility/settings";

/** Actions that talk to a registry; the rest work on local files only. */
const REGISTRY_ACTIONS: Readonly<Partial<Record<SkillAction, true>>> = {
	publish: true,
	tag: true,
	yank: true,
	deprecate: true,
	owner: true,
	token: true,
	import: true,
	install: true,
	update: true,
	search: true,
	info: true,
};

export default class Skill extends Command {
	static description = commandHelp.description;
	static aliases = ["skills"];

	static args = {
		action: Args.string({ description: "Skill action", required: false, options: SKILL_ACTIONS }),
		targets: Args.string({
			description: "Specs, names, directories, or action arguments",
			required: false,
			multiple: true,
		}),
	};

	static flags = {
		global: Flags.boolean({ char: "g", description: "Use the user-global skills.json (install/update/uninstall)" }),
		yes: Flags.boolean({ char: "y", description: "Install or update skills that ship scripts without asking" }),
		json: Flags.boolean({ description: "Output JSON (search, info, token, list)" }),
		sort: Flags.string({ description: "Search order", options: ["relevance", "downloads", "recent"] }),
		scope: Flags.string({ description: "Publishing scope (default: your Stencil username)" }),
		tag: Flags.string({ description: "Dist-tag for the published version" }),
		"dry-run": Flags.boolean({ description: "Pack and validate without publishing" }),
		"allow-secrets": Flags.boolean({ description: "Publish even when credential-shaped strings are found" }),
		registry: Flags.string({ description: "Registry base URL (overrides skills.registryUrl)" }),
		undo: Flags.boolean({ description: "Reverse a yank or deprecation" }),
		uninstall: Flags.boolean({
			description: "With install-official: remove the installed pack and fall back to the built-in provider",
		}),
		package: Flags.string({ description: "Restrict a new token to a package (repeatable)", multiple: true }),
		expires: Flags.integer({ description: "Token lifetime in days" }),
	};

	static examples = [
		"zetacode skill install @alice/pdf-tools",
		"zetacode skill install -g @alice/pdf-tools@^1.2",
		"zetacode skill install-official",
		'zetacode skill search "pdf" --sort downloads',
		"zetacode skill version minor && zetacode skill publish",
		"zetacode skill publish ./skills/pdf-tools --dry-run",
		"zetacode skill tag @alice/pdf-tools@2.0.0-beta.1 next",
		'zetacode skill deprecate @alice/pdf-tools@"<1.0.0" "use 1.x"',
		"zetacode skill token create ci --package @alice/pdf-tools --expires 90",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Skill);
		if (!args.action) {
			process.stdout.write(`${SKILL_USAGE}\n${SKILLS_REGISTRY_UNAVAILABLE}\n`);
			return;
		}
		const action = args.action as SkillAction;
		if (REGISTRY_ACTIONS[action] === true) {
			const settings = await Settings.loadReadOnly({ cwd: process.cwd() });
			const registry = (flags.registry ?? "").trim() || cfgSkillsRegistryUrl.get(settings).trim();
			if (!registry) {
				process.stderr.write(`skill ${action}: ${SKILLS_REGISTRY_UNAVAILABLE}\n`);
				process.exitCode = 1;
				return;
			}
		}
		const exitCode = await runSkillCommand({
			action,
			args: args.targets ?? [],
			cwd: process.cwd(),
			flags: {
				tag: flags.tag,
				dryRun: flags["dry-run"],
				allowSecrets: flags["allow-secrets"],
				registry: flags.registry,
				scope: flags.scope,
				undo: flags.undo,
				global: flags.global,
				yes: flags.yes,
				json: flags.json,
				sort: flags.sort as SkillSearchSort | undefined,
				uninstall: flags.uninstall,
				package: flags.package,
				expires: flags.expires,
			},
		});
		if (exitCode !== 0) process.exitCode = exitCode;
	}
}
