/**
 * Pure consumer-state helpers for the Studio Team workspace.
 *
 * These decide what the UI may offer from real Team rows (task status/lease,
 * room event ordering, bootstrap progress) and parse the onboarding text into
 * the service's typed input. No transport, no fixture, no wording.
 */
import type {
  TeamBootstrapEngineerInput,
  TeamBootstrapInput,
  TeamBootstrapPmInput,
  TeamBootstrapRepoInput,
  TeamBootstrapRoomInput,
  TeamBootstrapRunSummary,
  TeamRoomEvent,
  TeamWorkspaceTask,
} from "@linxiraos/studio-contract";

export type TeamTaskAction =
  | "assign"
  | "claim"
  | "renew"
  | "release"
  | "submit"
  | "complete"
  | "reject"
  | "cancel";

export type TeamLeaseState = "none" | "live" | "expired";

export interface TeamLeaseInfo {
  readonly state: TeamLeaseState;
  readonly remainingSeconds: number;
}

/** Actions the queue itself would accept for this task's current status. */
export function teamTaskActions(task: TeamWorkspaceTask): TeamTaskAction[] {
  switch (task.status) {
    case "pending":
      return ["assign", "claim", "cancel"];
    case "claimed":
      return ["renew", "release", "submit", "cancel"];
    case "review":
      return ["complete", "reject", "cancel"];
    case "done":
    case "cancelled":
      return [];
  }
}

/** A lease is live only while `leaseExpiresAt > now`; review/done have none. */
export function teamLeaseInfo(task: TeamWorkspaceTask, nowSeconds: number): TeamLeaseInfo {
  if (task.leaseExpiresAt === null) return { state: "none", remainingSeconds: 0 };
  const remaining = task.leaseExpiresAt - nowSeconds;
  return remaining > 0
    ? { state: "live", remainingSeconds: remaining }
    : { state: "expired", remainingSeconds: 0 };
}

/** Merge incremental room pages by host `seq`; a duplicate seq keeps the first. */
export function mergeRoomEvents(
  existing: readonly TeamRoomEvent[],
  incoming: readonly TeamRoomEvent[],
): TeamRoomEvent[] {
  const bySeq = new Map<number, TeamRoomEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

/** Highest host sequence in a page, or 0 for an empty room. */
export function lastRoomSeq(events: readonly TeamRoomEvent[]): number {
  let last = 0;
  for (const event of events) if (event.seq > last) last = event.seq;
  return last;
}

/** Bootstrap progress from the journal rows the read model carries. */
export function bootstrapProgress(run: TeamBootstrapRunSummary): { done: number; total: number } {
  let done = 0;
  for (const step of run.steps) if (step.status === "done" || step.status === "compensated") done += 1;
  return { done, total: run.steps.length };
}

/** A PM row id, not a display name, is what room membership and tasks accept. */
export function memberOptions(
  pms: ReadonlyArray<{ id: string; name: string }>,
  engineers: ReadonlyArray<{ id: string; name: string; pmId: string }>,
): Array<{ id: string; label: string; role: "pm" | "engineer" }> {
  return [
    ...pms.map(pm => ({ id: pm.id, label: pm.name, role: "pm" as const })),
    ...engineers.map(engineer => ({
      id: engineer.id,
      label: `${pms.find(pm => pm.id === engineer.pmId)?.name ?? engineer.pmId}/${engineer.name}`,
      role: "engineer" as const,
    })),
  ];
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));
}

/** `core, ops` or one per line. */
export function parsePmInput(value: string): TeamBootstrapPmInput[] {
  return value
    .split(/[\n,]/)
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => ({ name }));
}

/** `api=clone:<url>`, `api=link:<path>`, or `api=<path>`. */
export function parseRepoInput(value: string): TeamBootstrapRepoInput[] {
  return lines(value).map(line => {
    const separator = line.indexOf("=");
    if (separator < 0) return { name: line, link: line };
    const name = line.slice(0, separator).trim();
    const source = line.slice(separator + 1).trim();
    if (!name || !source) throw new Error(`Invalid repo line: ${line}`);
    if (source.startsWith("clone:")) return { name, clone: source.slice("clone:".length) };
    if (source.startsWith("link:")) return { name, link: source.slice("link:".length) };
    return { name, link: source };
  });
}

/** `alice:core:api` or `alice:core:api:vibe`. */
export function parseEngineerInput(value: string): TeamBootstrapEngineerInput[] {
  return lines(value).map(line => {
    const parts = line.split(":").map(part => part.trim());
    if (parts.length < 3 || parts.length > 4) throw new Error(`Invalid engineer line: ${line}`);
    const [name, pm, repo, execution] = parts;
    if (!name || !pm || !repo) throw new Error(`Invalid engineer line: ${line}`);
    if (execution !== undefined && execution !== "normal" && execution !== "vibe") {
      throw new Error(`Invalid engineer execution: ${execution}`);
    }
    return { name, pm, repo, ...(execution ? { execution } : {}) };
  });
}

/** `standup=shared`, `core=pm:core`, or `random`. */
export function parseRoomInput(value: string): TeamBootstrapRoomInput[] {
  return lines(value).map(line => {
    const separator = line.indexOf("=");
    if (separator < 0) return { name: line };
    const name = line.slice(0, separator).trim();
    const spec = line.slice(separator + 1).trim();
    if (!name) throw new Error(`Invalid room line: ${line}`);
    if (spec === "shared" || spec === "coordination") return { name, shared: true, kind: "coordination" };
    if (spec.startsWith("pm:") && spec.length > "pm:".length) return { name, kind: "pm", pm: spec.slice(3) };
    throw new Error(`Invalid room line: ${line}`);
  });
}

export interface OnboardingDraft {
  readonly name: string;
  readonly root: string;
  readonly displayName: string;
  readonly pms: string;
  readonly repos: string;
  readonly engineers: string;
  readonly rooms: string;
}

/** Convert the visible form into the exact `team.bootstrap.plan` input. */
export function onboardingInput(draft: OnboardingDraft): TeamBootstrapInput {
  const name = draft.name.trim();
  const root = draft.root.trim();
  if (!name) throw new Error("Team name is required");
  if (!root) throw new Error("Team root is required");
  return {
    name,
    root,
    ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
    pms: parsePmInput(draft.pms),
    repos: parseRepoInput(draft.repos),
    engineers: parseEngineerInput(draft.engineers),
    rooms: parseRoomInput(draft.rooms),
  };
}
