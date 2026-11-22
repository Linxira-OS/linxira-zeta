/**
 * Team audit trail. JSONL under `<team>/.zeta/audit/team.jsonl`; it never
 * leaves the Team root and never records message bodies.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const TEAM_AUDIT_FILE = path.join(".zeta", "audit", "team.jsonl");

export interface TeamAuditEvent {
	readonly action: string;
	readonly teamId: string;
	readonly agentId?: string;
	readonly roomId?: string;
	readonly personaId?: string;
	readonly planId?: string;
	readonly outcome?: "ok" | "failed";
	readonly detail?: string;
}

export function teamAuditPath(teamRoot: string): string {
	return path.join(teamRoot, TEAM_AUDIT_FILE);
}

export async function auditTeam(teamRoot: string, event: TeamAuditEvent): Promise<void> {
	const file = teamAuditPath(teamRoot);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
	await fs.appendFile(file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Best-effort audit: a failed log write must not fail the user's action. */
export async function auditTeamQuietly(teamRoot: string, event: TeamAuditEvent): Promise<void> {
	try {
		await auditTeam(teamRoot, event);
	} catch {
		// The Team event itself already committed.
	}
}
