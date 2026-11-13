/**
 * Plain-text projection of the Team Hub snapshot.
 *
 * This is the headless/ACP/IM counterpart of the TUI overlay: it renders the
 * same `TeamHubSnapshot` built by `team/hub-data.ts`, never a second Team
 * backend and never synthetic rows. Empty or missing database state keeps the
 * warning and prints only real CLI next steps.
 */
import {
	formatTeamHubTime,
	type TeamHubEvent,
	type TeamHubSnapshot,
	type TeamHubRoomView,
} from "@linxiraos/pi-tui/overlays/team-hub";

function roomLine(room: TeamHubSnapshot["rooms"][number]): string {
	const pm = room.pmName ?? room.pmId;
	const scope = room.kind === "pm" && pm ? `pm=${pm}` : room.kind;
	const last = room.lastSeq === null ? "no events" : `last=#${room.lastSeq}`;
	return `  ${room.name}  [${scope}]  members=${room.memberCount}  ${last}`;
}

function eventLine(event: TeamHubEvent): string {
	const reply = event.replyTo === null ? "" : ` ↳#${event.replyTo}`;
	const body = event.body.replace(/[\r\n\t]+/g, " ").trim();
	return `  #${event.seq}  ${formatTeamHubTime(event.sentAt)}  ${event.senderLabel}${reply}: ${body || "(empty)"}`;
}

function selectedRoomLines(selected: TeamHubRoomView): string[] {
	const lines = [`ROOM ${selected.room.name} [${selected.room.kind}]`];
	if (selected.members.length > 0) {
		lines.push("  members:");
		for (const member of selected.members) lines.push(`    - ${member.agentId} (${member.role})`);
	}
	if (selected.events.length > 0) {
		lines.push("  events:");
		for (const event of selected.events) lines.push(eventLine(event));
	} else {
		lines.push("  events: none");
	}
	return lines;
}

function emptyNextSteps(snapshot: TeamHubSnapshot): string[] {
	const lines = ["No rooms in this team yet. Next:"];
	if (snapshot.pms.length === 0) lines.push("  zetacode team pm add <pm>");
	lines.push("  zetacode team room create <name> --shared");
	if (snapshot.pms.length > 0) lines.push("  zetacode team room create <name> --pm <pm>");
	lines.push("  zetacode team room member add <room> --agent <id>");
	lines.push("  zetacode team room list");
	return lines;
}

/** Render one snapshot as stable plain text for non-TUI dispatchers. */
export function formatTeamHubSnapshot(snapshot: TeamHubSnapshot): string {
	const lines = [`Team Hub: ${snapshot.teamName} (${snapshot.teamId})`];
	if (!snapshot.dbAvailable) lines.push("database: unavailable");
	if (snapshot.warning) lines.push(`warning: ${snapshot.warning}`);

	if (snapshot.pms.length > 0) {
		lines.push("PMS:");
		for (const pm of snapshot.pms) lines.push(`  ${pm.name} (${pm.id})  engineers=${pm.engineerCount}`);
	}
	if (snapshot.engineers.length > 0) {
		lines.push("ENGINEERS:");
		for (const engineer of snapshot.engineers) {
			lines.push(
				`  ${engineer.name} (${engineer.id})  pm=${engineer.pmName}  execution=${engineer.execution}  worktrees=${engineer.worktrees.length}`,
			);
		}
	}

	lines.push("ROOMS:");
	if (snapshot.rooms.length === 0) {
		if (snapshot.dbAvailable) {
			lines.push(...emptyNextSteps(snapshot).map(line => `  ${line}`));
		} else {
			lines.push("  (no rooms; Team database row unavailable — run `zetacode team doctor` to inspect)");
		}
	} else {
		for (const room of snapshot.rooms) lines.push(roomLine(room));
	}
	if (snapshot.selectedRoom) lines.push(...selectedRoomLines(snapshot.selectedRoom));

	const tasks = snapshot.tasks ?? [];
	if (tasks.length > 0) {
		lines.push("TASKS:");
		for (const task of tasks) {
			lines.push(
				`  ${task.taskKey}  ${task.status}  pm=${task.assignedPmId}  assignee=${task.assigneeAgentId ?? "-"}  owner=${task.ownerAgentId ?? "-"}  ${task.title}`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}
