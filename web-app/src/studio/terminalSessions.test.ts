import { afterEach, expect, it, vi } from "vitest";
import { TerminalSessions, terminalOwnerKey } from "./terminalSessions";
import type { StudioTerminalApi } from "./terminals/api";

afterEach(() => sessionStorage.clear());

it("restores terminals to their original target, workspace and conversation", async () => {
  let sequence = 0;
  const api: StudioTerminalApi = {
    create: vi.fn(async input => ({ id: `pty-${++sequence}`, name: "shell", cwd: input?.cwd ?? "/workspace", profile: null, instance: input?.instanceId ?? "default" })),
    write: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    onData: () => () => {}, onExit: () => () => {},
  };
  const original = new TerminalSessions(api);
  await original.create("remote-a", "workspace-a", "session-a", "conversation-a");
  await original.create(null, "workspace-b", "session-b", "conversation-b");
  const restored = new TerminalSessions(api);
  await restored.restore();
  const [remote, local] = restored.snapshot().sessions;
  expect(remote).toMatchObject({ targetId: "remote-a", workspaceId: "workspace-a", sessionId: "session-a", conversationId: "conversation-a" });
  expect(local).toMatchObject({ targetId: null, workspaceId: "workspace-b", sessionId: "session-b", conversationId: "conversation-b" });
  expect(restored.activeIds.get(terminalOwnerKey("remote-a", "workspace-a", "conversation-a"))).toBe(remote!.id);
  expect(restored.activeIds.get(terminalOwnerKey(null, "workspace-b", "conversation-b"))).toBe(local!.id);
  const restarted = await restored.restart(remote!.id, "bash");
  expect(restored.activeIds.get(terminalOwnerKey("remote-a", "workspace-a", "conversation-a"))).toBe(restarted);
});
