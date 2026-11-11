/**
 * Consumer state for the Studio Team workspace. Real row shapes only: task
 * status/lease decides actions, room pages merge by host seq, onboarding text
 * becomes the service input. No transport or fixture server.
 */
import { describe, expect, test } from "bun:test";
import type { TeamRoomEvent, TeamWorkspaceTask } from "@linxiraos/studio-contract";
import {
  bootstrapProgress,
  lastRoomSeq,
  memberOptions,
  mergeRoomEvents,
  onboardingInput,
  parseEngineerInput,
  parsePmInput,
  parseRepoInput,
  parseRoomInput,
  teamLeaseInfo,
  teamTaskActions,
} from "./teamWorkspaceModel";

function task(overrides: Partial<TeamWorkspaceTask> = {}): TeamWorkspaceTask {
  return {
    id: "acme:T-1",
    taskKey: "T-1",
    title: "Task",
    body: "",
    status: "pending",
    assignedPmId: "acme:core",
    assigneeAgentId: null,
    ownerAgentId: null,
    ownerRole: null,
    leaseExpiresAt: null,
    reqIds: [],
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function event(seq: number, body = String(seq)): TeamRoomEvent {
  return {
    seq,
    sentAt: seq,
    senderAgentId: "acme:core",
    kind: "message",
    body,
    replyTo: null,
    mentions: [],
  };
}

describe("task consumer state", () => {
  test("queue statuses expose only the actions the service accepts", () => {
    expect(teamTaskActions(task({ status: "pending" }))).toEqual(["assign", "claim", "cancel"]);
    expect(teamTaskActions(task({ status: "claimed" }))).toEqual(["renew", "release", "submit", "cancel"]);
    expect(teamTaskActions(task({ status: "review" }))).toEqual(["complete", "reject", "cancel"]);
    expect(teamTaskActions(task({ status: "done" }))).toEqual([]);
    expect(teamTaskActions(task({ status: "cancelled" }))).toEqual([]);
  });

  test("lease is live only before expiry, expired after, absent for review/done", () => {
    expect(teamLeaseInfo(task(), 100)).toEqual({ state: "none", remainingSeconds: 0 });
    expect(teamLeaseInfo(task({ leaseExpiresAt: 160 }), 100)).toEqual({
      state: "live",
      remainingSeconds: 60,
    });
    expect(teamLeaseInfo(task({ leaseExpiresAt: 100 }), 100)).toEqual({
      state: "expired",
      remainingSeconds: 0,
    });
  });

  test("offline is not inferred from a task row; no owner means no fabricated agent", () => {
    const row = task({ status: "claimed", ownerAgentId: null, leaseExpiresAt: 200 });
    expect(row.ownerAgentId).toBeNull();
    expect(teamLeaseInfo(row, 100).state).toBe("live");
  });
});

describe("room consumer state", () => {
  test("incremental pages merge by host seq and keep order", () => {
    const merged = mergeRoomEvents([event(3), event(1)], [event(2), event(3, "duplicate"), event(4)]);
    expect(merged.map(row => row.seq)).toEqual([1, 2, 3, 4]);
    expect(merged.find(row => row.seq === 3)?.body).toBe("3");
    expect(lastRoomSeq(merged)).toBe(4);
  });

  test("an empty room has no cursor", () => {
    expect(lastRoomSeq([])).toBe(0);
  });

  test("member options use real PM/engineer row ids", () => {
    const options = memberOptions(
      [{ id: "acme:core", name: "core" }],
      [{ id: "acme:core:alice", name: "alice", pmId: "acme:core" }],
    );
    expect(options).toEqual([
      { id: "acme:core", label: "core", role: "pm" },
      { id: "acme:core:alice", label: "core/alice", role: "engineer" },
    ]);
  });
});

describe("onboarding input", () => {
  test("parses PMs, repos, engineers, rooms, and keeps the explicit root", () => {
    expect(parsePmInput("core, ops\nui")).toEqual([{ name: "core" }, { name: "ops" }, { name: "ui" }]);
    expect(parseRepoInput("api=clone:https://example.invalid/api.git\nweb=link:/work/web")).toEqual([
      { name: "api", clone: "https://example.invalid/api.git" },
      { name: "web", link: "/work/web" },
    ]);
    expect(parseEngineerInput("alice:core:api\nbob:ops:web:vibe")).toEqual([
      { name: "alice", pm: "core", repo: "api" },
      { name: "bob", pm: "ops", repo: "web", execution: "vibe" },
    ]);
    expect(parseRoomInput("standup=shared\ncore=pm:core\nlounge")).toEqual([
      { name: "standup", shared: true, kind: "coordination" },
      { name: "core", kind: "pm", pm: "core" },
      { name: "lounge" },
    ]);
    expect(
      onboardingInput({
        name: "acme",
        root: "/work/acme",
        displayName: "Acme",
        pms: "core",
        repos: "api=link:/work/api",
        engineers: "alice:core:api",
        rooms: "standup=shared",
      }),
    ).toEqual({
      name: "acme",
      root: "/work/acme",
      displayName: "Acme",
      pms: [{ name: "core" }],
      repos: [{ name: "api", link: "/work/api" }],
      engineers: [{ name: "alice", pm: "core", repo: "api" }],
      rooms: [{ name: "standup", shared: true, kind: "coordination" }],
    });
  });

  test("a missing name or root is rejected before any plan call", () => {
    expect(() =>
      onboardingInput({
        name: "",
        root: "",
        displayName: "",
        pms: "",
        repos: "",
        engineers: "",
        rooms: "",
      }),
    ).toThrow();
  });
});

describe("bootstrap consumer state", () => {
  test("progress counts done/compensated steps without inventing rows", () => {
    expect(
      bootstrapProgress({
        runId: "run",
        teamId: "acme",
        mode: "team",
        status: "running",
        createdAt: 1,
        updatedAt: 2,
        error: null,
        steps: [
          { stepId: "1", seq: 0, kind: "init-team", description: "init", createdByRun: true, status: "done" },
          { stepId: "2", seq: 1, kind: "add-pm", description: "pm", createdByRun: true, status: "failed" },
          { stepId: "3", seq: 2, kind: "bind-repo", description: "bind", createdByRun: true, status: "planned" },
        ],
      }),
    ).toEqual({ done: 1, total: 3 });
  });
});
