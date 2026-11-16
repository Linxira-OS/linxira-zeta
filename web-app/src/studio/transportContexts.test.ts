import { expect, it, vi } from "vitest";
import type { ClientTransport, WorkspaceId } from "@linxiraos/studio-contract";
import { StudioClientImpl } from "@linxiraos/studio-client";
import { BrowserWebClientTransport } from "../vendor/transport-web/src/browser-client";

it("closes a context opened after its parent client was closed", async () => {
  const opening = Promise.withResolvers<ClientTransport>();
  const close = vi.fn(async () => {});
  const transport = { openContext: () => opening.promise, close: async () => {} } as unknown as ClientTransport;
  const parent = new StudioClientImpl(transport);
  const pending = parent.openContext({ workspaceId: "ws-a" as WorkspaceId });
  await parent.close();
  opening.resolve({ close } as unknown as ClientTransport);
  await expect(pending).rejects.toEqual({ code: "TRANSPORT_ERROR", message: "transport is closed" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps scoped browser requests and close on their own context", async () => {
  const requests: Array<{ path: string; context: string | null }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, context: new Headers(init?.headers).get("X-Studio-Context") });
    return Response.json(path.endsWith("/open") ? { contextId: "context-a" } : {}, { headers: { "x-studio-csrf": "csrf" } });
  });
  const parent = new BrowserWebClientTransport({ baseUrl: "http://localhost", fetcher });
  await parent.bootstrap();
  const scoped = await parent.openContext({ workspaceId: "ws-a" as WorkspaceId });
  await scoped.bootstrap();
  await scoped.close();
  await expect(scoped.bootstrap()).rejects.toThrow("transport_closed");
  expect(requests).toEqual([
    { path: "/api/v1/bootstrap", context: null },
    { path: "/api/v1/context/open", context: null },
    { path: "/api/v1/bootstrap", context: "context-a" },
    { path: "/api/v1/context/close", context: "context-a" },
  ]);
});

it("buffers subscriptions before bootstrap without opening an unauthenticated socket", async () => {
  const opening = Promise.withResolvers<Response>();
  const socket: import("../vendor/transport-web/src/browser-client").WebSocketLike = { send: vi.fn(), close: vi.fn() };
  const webSocketFactory = vi.fn(() => socket);
  const transport = new BrowserWebClientTransport({ baseUrl: "http://localhost", fetcher: () => opening.promise, webSocketFactory });
  const unsubscribe = transport.subscribe({ scope: "all" }, vi.fn());
  expect(webSocketFactory).not.toHaveBeenCalled();
  const bootstrap = transport.bootstrap();
  opening.resolve(Response.json({}, { headers: { "x-studio-csrf": "csrf" } }));
  await vi.waitFor(() => expect(webSocketFactory).toHaveBeenCalledTimes(1));
  socket.onopen?.();
  await bootstrap;
  expect(webSocketFactory).toHaveBeenCalledWith("ws://localhost/api/v1/events");
  unsubscribe();
  expect(socket.close).toHaveBeenCalledTimes(1);
  await transport.close();
});

it("does not attach a subscription cancelled while cookie bootstrap is pending", async () => {
  const opening = Promise.withResolvers<Response>();
  const webSocketFactory = vi.fn(() => ({ send: vi.fn(), close: vi.fn() }));
  const transport = new BrowserWebClientTransport({ baseUrl: "http://localhost", fetcher: () => opening.promise, webSocketFactory });
  const unsubscribe = transport.subscribe({ scope: "all" }, vi.fn());
  const bootstrap = transport.bootstrap();
  unsubscribe();
  opening.resolve(Response.json({}));
  await bootstrap;
  expect(webSocketFactory).not.toHaveBeenCalled();
  await transport.close();
});

it("waits for an event subscription added after a context already bootstrapped the transport", async () => {
  const socket: import("../vendor/transport-web/src/browser-client").WebSocketLike = { send: vi.fn(), close: vi.fn() };
  const factory = vi.fn(() => socket);
  const transport = new BrowserWebClientTransport({ baseUrl: "http://localhost", fetcher: async () => Response.json({}), webSocketFactory: factory });
  await transport.bootstrap();
  const unsubscribe = transport.subscribe({ scope: "all" }, vi.fn());
  let ready = false;
  const bootstrap = transport.bootstrap().then(() => { ready = true; });
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  expect(ready).toBe(false);
  socket.onopen?.();
  await bootstrap;
  expect(ready).toBe(true);
  unsubscribe(); await transport.close();
});
