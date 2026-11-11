/**
 * `zetacode team` — ownerless team root, PM workspaces, canonical base repos,
 * PM bindings, engineers, linked worktrees, and database-only rooms.
 */

import { Args, Command, Flags } from "@linxiraos/pi-utils/cli";
import { teamHelp as commandHelp } from "../cli/command-help";
import { runTeamCommand } from "../cli/team-cli";

const ACTIONS = ["init", "bootstrap", "pm", "repo", "engineer", "worktree", "room", "task", "doctor"] as const;

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
		cwd: Flags.string({
			description: "Session cwd for room delivery (room deliver)",
		}),
		name: Flags.string({
			description: "Display name (init/pm)",
		}),
		clone: Flags.string({
			description: "Clone URL (repo add)",
		}),
		repo: Flags.string({
			description: "Base repository; repeatable bootstrap <name>=clone:<url>|link:<path>",
			multiple: true,
		}),
		engineer: Flags.string({
			description: "Engineer name (worktree add) or repeatable bootstrap <name>:<pm>:<repo>[:mode]",
			multiple: true,
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
		bind: Flags.string({
			description: "Bootstrap binding <repo>:<pm>; repeatable",
			multiple: true,
		}),
		room: Flags.string({
			description: "Bootstrap room <name>[=shared|pm:<pm>]; repeatable",
			multiple: true,
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
		title: Flags.string({
			description: "Task title (task create)",
		}),
		assignee: Flags.string({
			description: "Engineer assigned to a task (task create/assign)",
		}),
		agent: Flags.string({
			description: "Engineer claiming/renewing/releasing/submitting a task, or any team actor commenting",
		}),
		lease: Flags.string({
			description: "Claim lease in seconds (task claim/renew; default 900)",
		}),
		req: Flags.string({
			description: "Comma-separated REQ-* ledger ids (task create/submit/complete; body ids are also extracted)",
		}),
		status: Flags.string({
			description: "Task status filter: pending, claimed, review, done, or cancelled (task list)",
			options: ["pending", "claimed", "review", "done", "cancelled"],
		}),
		"from-seq": Flags.string({
			description: "First unread room sequence (room subscribe)",
		}),
		seq: Flags.string({
			description: "Sequence to acknowledge (room ack)",
		}),
		"display-name": Flags.string({
			description: "Display name (bootstrap)",
		}),
		"engineer-only": Flags.boolean({
			description: "Add one/more engineers to an existing Team (bootstrap)",
			default: false,
		}),
		"no-rollback": Flags.boolean({
			description: "Leave a failed bootstrap run resumable instead of compensating it",
			default: false,
		}),
		resume: Flags.string({
			description: "Resume a bootstrap run id (bootstrap)",
		}),
		rollback: Flags.string({
			description: "Roll back a bootstrap run id (bootstrap)",
		}),
		pm: Flags.string({
			description: "PM id; repeatable for bootstrap, single for other commands",
			multiple: true,
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
		'zetacode team task create T-101 --pm core --title "Fix login" --req REQ-42',
		"zetacode team task claim T-101 --agent alice --lease 900",
		"zetacode team task submit T-101 --agent alice",
		"zetacode team task complete T-101 --pm core",
		"zetacode team task list --status claimed",
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
			cwd: flags.cwd,
			name: flags.name,
			clone: flags.clone,
			pm: Array.isArray(flags.pm) ? flags.pm[0] : flags.pm,
			pms: flags.pm,
			repo: Array.isArray(flags.repo) ? flags.repo[0] : flags.repo,
			repos: flags.repo,
			engineer: Array.isArray(flags.engineer) ? flags.engineer[0] : flags.engineer,
			engineers: flags.engineer,
			execution: flags.execution,
			shared: flags.shared ?? false,
			kind: flags.kind,
			members: flags.members,
			body: flags.body,
			sender: flags.sender,
			replyTo: flags["reply-to"],
			limit: flags.limit,
			title: flags.title,
			assignee: flags.assignee,
			agent: flags.agent,
			lease: flags.lease,
			req: flags.req,
			status: flags.status,
			fromSeq: flags["from-seq"],
			seq: flags.seq,
			displayName: flags["display-name"],
			engineerOnly: flags["engineer-only"] ?? false,
			noRollback: flags["no-rollback"] ?? false,
			resume: flags.resume,
			rollback: flags.rollback,
			binds: flags.bind,
			rooms: flags.room,
			json: flags.json ?? false,
		});
	}
}
