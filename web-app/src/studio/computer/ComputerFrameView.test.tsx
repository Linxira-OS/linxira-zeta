import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComputerFrameView } from "./ComputerFrameView";
import { previewComputerFrame } from "../preview/computerPreview";
import type { StudioClient, CommandState } from "@linxiraos/studio-contract";
import { ComputerWorkspaceSource } from "./workspaceSource";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("releases temporary observation pixels at expiry without capturing a replacement", async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => ({ ok: true, data: new ArrayBuffer(8), width: 1280, height: 800, mimeType: "image/png" }));
  const adopt = vi.fn(async () => ({ ok: true as const })), release = vi.fn(async () => ({ ok: true as const }));
  vi.stubGlobal("zetaStudioChrome", { readComputerFrame: read, adoptComputerView: adopt, releaseComputerView: release });
  const commands: Record<string, CommandState> = {};
  const client = { query: async () => undefined, subscribe: () => () => {}, getState: () => ({ commands }), command: async (kind: string) => {
    const requestId = crypto.randomUUID();
    commands[requestId] = { requestId, commandName: kind, status: "completed", result: { result: kind === "computer.observe.open" ? { sessionId: "root", leaseId: "observed-lease", expiresAt: Date.now() + 120000 } : { released: true } } } as unknown as CommandState;
    return { requestId };
  } } as unknown as StudioClient;
  const source = new ComputerWorkspaceSource(client, "root", "epoch", { adoptComputerView: adopt, releaseComputerView: release });
  const off = source.subscribe(() => {});
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:temporary-frame") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  await act(async () => {
    render(<ComputerFrameView client={client} source={source} frame={{ ...previewComputerFrame("child"), source: "observation", expiresAt: Date.now() + 5000 }} scopeSessionId="root" scopeKey="epoch" executionTarget={{ kind: "local" }} visible viewportHeight={400} preview={false} zh empty={["", ""]} />);
  });
  expect(screen.getByAltText("电脑目标截图")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
  expect(screen.queryByAltText("电脑目标截图")).toBeNull();
  expect(screen.getByText("观察画面已过期，请显式刷新获取新画面。")).toBeTruthy();
  expect(revoke).toHaveBeenCalledWith("blob:temporary-frame");
  expect(read).toHaveBeenCalledTimes(1);
  off();
  expect(adopt).toHaveBeenCalledWith({ scopeSessionId: "root", leaseId: "observed-lease", origin: "local" });
  expect(release).toHaveBeenCalledWith({ scopeSessionId: "root", leaseId: "observed-lease", origin: "local" });
});
