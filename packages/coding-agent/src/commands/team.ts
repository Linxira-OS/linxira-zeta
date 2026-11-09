/**
 * `zetacode team` — ownerless team root, PM workspaces, canonical base repos,
 * PM bindings, engineers, linked worktrees, and database-only rooms.
 */

import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { teamHelp as commandHelp } from "../cli/command-help";
import { runTeamCommand } from "../cli/team-cli";

const ACTIONS = ["init", "pm", "repo", "engineer", "worktree", "room", "doctor"] as const;

export default class Team extends Command {
	static description = commandHelp.description;

	static args = {
		action: Args.string({
			description: "Team command (init, pm, repo, engineer, worktree, room, doctor)",
			required: false,
			options: [...ACTIONS],
		}),
		rest: Args.string({
			description: "Command arguments (e.g. `add core`, `T-101`)",
			required: false,
			multiple: true,
		}),
	};

	static flags = {
		root: Flags.string({
			description: "Team root (default: walk up from the current directory)",
		}),
		name: Flags.string({
			description: "Display name (init/pm)",
		}),
		clone: Flags.string({
			description: "Clone URL (repo add)",
		}),
		pm: Flags.string({
			description: "PM id (repo bind, engineer add, worktree add)",
		}),
		repo: Flags.string({
			description: "Base repository name (engineer add, worktree add)",
		}),
		engineer: Flags.string({
			description: "Engineer name (worktree add)",
		}),
		execution: Flags.string({
			description: "Engineer execution mode: normal or vibe (default normal; never auto-starts Vibe)",
			options: ["normal", "vibe"],
		}),
		shared: Flags.boolean({
			description: "Create a team-wide coordination room (room create)",
			default: false,
		}),
		kind: Flags.string({
			description: "Room kind: pm, coordination, or room (room create)",
			options: ["pm", "coordination", "room"],
		}),
		members: Flags.string({
			description: "Comma-separated room members: PM, engineer, <pm>/<engineer>, or agent id (room create)",
		}),
		body: Flags.string({
			description: "Event body (room post)",
		}),
		sender: Flags.string({
			description: "Sender agent id (room post; default the room's PM)",
		}),
		"reply-to": Flags.string({
			description: "Sequence number of an earlier event to reply to (room post)",
		}),
		limit: Flags.string({
			description: "Maximum events to show, newest last (room show; default 50)",
		}),
		json: Flags.boolean({ char: "j", description: "Emit machine-readable JSON", default: false }),
	};

	static examples = [
		"zetacode team init acme --root ./acme-team",
		"zetacode team pm add core",
		"zetacode team repo add api --clone git@github.com:acme/api.git",
		"zetacode team repo link api ../api",
		"zetacode team repo bind api --pm core",
		"zetacode team engineer add alice --pm core --repo api",
		"zetacode team engineer add alice --pm core --repo api --execution vibe",
		"zetacode team worktree add T-101 --repo api --pm core --engineer alice",
		"zetacode team room create core --pm core",
		"zetacode team room create shared --shared --members core,platform",
		"zetacode team room list",
		'zetacode team room post core --body "standup in 5"',
		"zetacode team room show core --limit 20",
		"zetacode team doctor",
		"zetacode team doctor --root ./acme-team --json",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Team);
		const rest = Array.isArray(args.rest) ? args.rest : args.rest ? [args.rest] : [];
		await runTeamCommand({
			action: args.action,
			rest,
			root: flags.root,
			name: flags.name,
			clone: flags.clone,
			pm: flags.pm,
			repo: flags.repo,
			engineer: flags.engineer,
			execution: flags.execution,
			shared: flags.shared ?? false,
			kind: flags.kind,
			members: flags.members,
			body: flags.body,
			sender: flags.sender,
			replyTo: flags["reply-to"],
			limit: flags.limit,
			json: flags.json ?? false,
		});
	}
}
