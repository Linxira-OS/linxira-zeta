import { describe, expect, test } from "bun:test";

import type {
  AuthorityEpoch,
  AuthorityId,
  ClientBootstrap,
  ClientEvent,
  EventCursor,
  RuntimeEpoch,
  RuntimeId,
  SessionId,
  StateVersion,
  SubscriptionScope,
} from "@linxiraos/studio-contract";
import type { OperatorStateSnapshot } from "@linxiraos/studio-protocol";

import { MemoryClientTransport } from "./memory-transport.js";
import { createInitialClientState, reduceClientState } from "./reducer.js";

/**
 * Regression cover for the streaming zero-copy seam (port of upstream PR #20
 * `packages/host-client-api/test/snapshot-clone.test.ts`).
 *
 * Before the port, `MemoryClientTransport.emit` deep-cloned every delivered
 * event, so each streamed snapshot frame round-tripped the whole operator pack
 * (`agents`, `jobs`, telemetry) through JSON before any subscriber saw it. The
 * seam now hands the published object through and copies only at the read
 * boundaries (`bootstrap`, `query`), where the value genuinely leaves the
 * transport.
 */
const AT = "2026-10-29T00:00:00.000Z";
const SESSION = "session-clone" as SessionId;
const ALL: SubscriptionScope = { scope: "all" };

/** 120 agents + 200 jobs — the shape the upstream review quoted at ~254 KB. */
function operatorSnapshot(): OperatorStateSnapshot {
  return {
    runtimeId: "runtime-1" as RuntimeId,
    runtimeEpoch: 1 as RuntimeEpoch,
    stateVersion: 7 as StateVersion,
    sessionId: SESSION,
    isStreaming: true,
    isCompacting: false,
    activeMode: "normal",
    approvalMode: "always-ask",
    pendingMessages: 0,
    activeCommandIds: [],
    agentsRevision: 12,
    jobsRevision: 34,
    agents: Array.from({ length: 120 }, (_, index) => ({
      agentId: `agent-${index}` as OperatorStateSnapshot["agents"][number]["agentId"],
      generation: 1 as OperatorStateSnapshot["agents"][number]["generation"],
      kind: "worker",
      displayName: `worker ${index}`,
      status: "running" as const,
      updatedAt: AT,
      hasLiveSession: true,
      hasTranscript: true,
      unreadCount: 0,
      activeJobIds: [],
    })),
    jobs: Array.from({ length: 200 }, (_, index) => ({
      jobId: `job-${index}` as OperatorStateSnapshot["jobs"][number]["jobId"],
      generation: 1 as OperatorStateSnapshot["jobs"][number]["generation"],
      ownerAgentId: "agent-0" as OperatorStateSnapshot["jobs"][number]["ownerAgentId"],
      type: "bash",
      label: `job ${index}`,
      status: "running" as const,
    })),
  };
}

function snapshotEvent(index: number, snapshot: OperatorStateSnapshot): Extract<ClientEvent, { kind: "snapshot" }> {
  return {
    kind: "snapshot",
    authorityEpoch: 1 as AuthorityEpoch,
    runtimeEpoch: 1 as RuntimeEpoch,
    stateVersion: 7 as StateVersion,
    cursor: String(index + 1) as EventCursor,
    occurredAt: AT,
    snapshot,
  };
}

function conversationEvent(
  index: number,
  snapshot: OperatorStateSnapshot,
): Extract<ClientEvent, { kind: "conversation.changed" }> {
  return {
    kind: "conversation.changed",
    authorityEpoch: 1 as AuthorityEpoch,
    runtimeEpoch: 1 as RuntimeEpoch,
    stateVersion: 7 as StateVersion,
    cursor: String(index + 1) as EventCursor,
    occurredAt: AT,
    sessionId: snapshot.sessionId,
    streamSeq: index,
    eventSeq: index,
    update: {
      kind: "conversation.message.delta",
      sessionId: snapshot.sessionId,
      turnId: "turn-1" as never,
      messageId: "message-1" as never,
      blockId: "block-1" as never,
      blockType: "text",
      delta: `token-${index}`,
    },
  };
}

describe("streaming snapshot delivery", () => {
  test("emitted events reach subscribers without a copy", () => {
    const transport = new MemoryClientTransport();
    const snapshot = operatorSnapshot();
    const seen: ClientEvent[] = [];
    transport.subscribe(ALL, (event) => seen.push(event));

    const events: ClientEvent[] = [
      snapshotEvent(0, snapshot),
      ...Array.from({ length: 499 }, (_, index) => conversationEvent(index + 1, snapshot)),
    ];
    for (const event of events) transport.emit(event);

    expect(seen.length).toBe(events.length);
    for (const [index, received] of seen.entries()) {
      expect(received).toBe(events[index] as ClientEvent);
    }
    // The first frame is a snapshot: the committed pack is the emitted object.
    const first = seen[0];
    expect(first?.kind).toBe("snapshot");
    if (first?.kind === "snapshot") expect(first.snapshot).toBe(snapshot);
  });

  test("the reducer retains the published snapshot by reference", () => {
    const snapshot = operatorSnapshot();
    const state = reduceClientState(createInitialClientState(), {
      type: "event",
      event: snapshotEvent(0, snapshot),
    });
    expect(state.entities.snapshot).toBe(snapshot);
    expect(state.connection.stateVersion).toBe(7);
  });

  test("bootstrap is still copied exactly once at the boundary", async () => {
    const snapshot = operatorSnapshot();
    const bootstrap: ClientBootstrap = {
      contractVersion: 2,
      authority: { authorityId: "authority-1" as AuthorityId, authorityEpoch: 1 as AuthorityEpoch },
      runtime: {
        status: "connected",
        classification: "managed",
        runtimeId: "runtime-1" as RuntimeId,
        runtimeEpoch: 1 as RuntimeEpoch,
      },
      surface: { terminalAttach: true, fileReveal: true, previewInput: false, openExternal: true },
      capabilityManifest: { profile: "limited", generatedAt: AT, hash: "capability-hash", capabilities: [] },
      commandManifestHash: "command-hash",
      selected: { sessionId: SESSION },
      snapshot,
      stateVersion: 7 as StateVersion,
      cursor: "1" as EventCursor,
    };
    const transport = new MemoryClientTransport({ bootstrap: () => bootstrap });

    const delivered = await transport.bootstrap();
    expect(delivered).not.toBe(bootstrap);
    expect(delivered.stateVersion).toBe(7);
    expect(delivered.snapshot).not.toBe(snapshot);
    expect(delivered.snapshot?.sessionId).toBe(SESSION);

    // The copy is the caller's to mutate; the handler's object stays pristine.
    const copy = delivered.snapshot;
    if (copy !== undefined) copy.sessionId = "mutated" as SessionId;
    expect(snapshot.sessionId).toBe(SESSION);
  });

  test("a closed transport drops events instead of delivering them", () => {
    const transport = new MemoryClientTransport();
    const seen: ClientEvent[] = [];
    transport.subscribe(ALL, (event) => seen.push(event));
    void transport.close();
    transport.emit(conversationEvent(0, operatorSnapshot()));
    expect(seen.length).toBe(0);
  });
});
