import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioClientImpl } from "@linxiraos/studio-client";
import { contractFixtures } from "@linxiraos/studio-testkit";
import type { ClientEvent, ClientTransport } from "@linxiraos/studio-contract";
import type { ManagedBrowserApi, ManagedBrowserState } from "@linxiraos/studio-protocol";
import { useManagedBrowserOwner } from "./useManagedBrowserOwner";
import { browserHub } from "./browserSessions";

const clients: StudioClientImpl[] = [];
afterEach(async () => { cleanup(); for (const client of clients.splice(0)) await client.close(); vi.unstubAllGlobals(); });

it("a late attach is released before switching the live browser owner to another conversation", async () => {
  const bootstrap = structuredClone(contractFixtures.bootstrap);
  const capabilities = { ...bootstrap.capabilityManifest, capabilities: [{ id: "browser.managed.prepare", grade: "stable" as const, version: 1, evidence: "test" }] };
  const listeners = new Set<(event: ClientEvent) => void>();
  let cursor = 0;
  const transport: ClientTransport = {
    bootstrap: async () => ({ ...bootstrap, capabilityManifest: capabilities, cursor: String(cursor) as never }),
    subscribe: (_scope, listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    query: async () => { throw new Error("No query expected"); },
    command: async request => {
      const input = request.input as { sessionId: string };
      const event = { kind: "command.receipt", authorityEpoch: bootstrap.authority.authorityEpoch, cursor: String(++cursor), occurredAt: new Date().toISOString(), receipt: { requestId: request.requestId, commandName: request.commandName, status: "completed", observedAt: new Date().toISOString(), result: { snapshot: bootstrap.snapshot, result: { sessionId: input.sessionId, descriptorId: `${input.sessionId}.json` } } } } as ClientEvent;
      for (const listener of listeners) listener(event);
      return { commandName: request.commandName, requestId: request.requestId, status: "accepted", acceptedAt: new Date().toISOString() };
    },
    close: async () => { listeners.clear(); },
  };
  const client = new StudioClientImpl(transport);
  clients.push(client);
  const pending = new Map<string, () => void>();
  const owned = new Set<string>();
  const reads: string[] = [];
  const read = async (sessionId: string): Promise<ManagedBrowserState> => {
    reads.push(sessionId);
    if (!owned.has(sessionId)) throw new Error("No live browser owner");
    return { sessionId, pages: [], activePageId: null, spaces: [], control: "agent", connection: "connected", settings: { maxTabs: 16, downloadDirectory: "", askDownloadLocation: false }, downloads: [], permissions: [] };
  };
  const api: ManagedBrowserApi = {
    available: async () => true,
    attach: async ({ sessionId }) => { await new Promise<void>(resolve => { pending.set(sessionId, resolve); }); owned.add(sessionId); return { ok: true }; },
    release: async ({ sessionId }) => { owned.delete(sessionId); return { ok: true }; },
    read, execute: async command => read(command.sessionId), present: async () => {}, subscribe: () => () => {},
  };
  vi.stubGlobal("zetaStudioChrome", { managedBrowser: api });
  const first = browserHub(false, api)!.session("first");
  const unsubscribe = first.subscribe(() => {});
  const { rerender, unmount } = renderHook(({ sessionId }) => useManagedBrowserOwner({ client, sessionId, available: true, capabilities, remote: false }), { initialProps: { sessionId: "first" } });
  await waitFor(() => expect(pending.has("first")).toBe(true));
  expect(reads).toEqual([]);
  rerender({ sessionId: "second" });
  await act(async () => { pending.get("first")!(); });
  await waitFor(() => expect(pending.has("second")).toBe(true));
  expect(owned.has("first")).toBe(false);
  expect(first.getSnapshot().state).toBeNull();
  await act(async () => { pending.get("second")!(); });
  await waitFor(() => expect([...owned]).toEqual(["second"]));
  await waitFor(() => expect(reads).toEqual(["second"]));
  unmount();
  await waitFor(() => expect([...owned]).toEqual([]));
  unsubscribe();
});
