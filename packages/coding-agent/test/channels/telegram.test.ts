/**
 * Telegram channel contracts — signal-parked mock using `unknown` parameters
 * (no `any`, no `RequestInfo`/`RequestInit` dependency).
 */
import { afterEach, describe, expect, test, vi } from "bun:test";
import { TelegramChannel } from "../../src/channels/telegram";

function updatesResponse(updates: unknown[]): Response {
  return new Response(
    JSON.stringify({ ok: true, result: updates }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockFetch(...builders: (() => Response)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let idx = 0;

  const impl = async (input: unknown, init?: unknown): Promise<Response> => {
    const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
    const url = typeof input === "string"
      ? input
      : (input as Request).url;
    calls.push({ url, init: init as RequestInit | undefined });
    if (idx < builders.length) return builders[idx++]();
    if (signal) {
      await new Promise<void>((_, reject) => {
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      throw new Error("unreachable");
    }
    return builders[builders.length - 1]();
  };

  vi.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof globalThis.fetch);
  return calls;
}

async function stopChannel(ch: { stop(): Promise<void> }): Promise<void> {
  await ch.stop();
}

describe("TelegramChannel", () => {
  afterEach(() => vi.restoreAllMocks());

  test("forwards text updates with chat_id as peer and advances the offset cursor", async () => {
    const seen: Array<{ peer: string; body: string }> = [];
    const calls = mockFetch(
      () => updatesResponse([
        { update_id: 5, message: { message_id: 11, chat: { id: 1001 }, text: "hello" } },
        { update_id: 6, message: { message_id: 12, chat: { id: 1001 }, text: "second" } },
      ]),
      () => updatesResponse([{ update_id: 7, message: { message_id: 13, chat: { id: 2002 }, text: "after" } }]),
    );

    const ch = new TelegramChannel({ botToken: "tok", onMessage: (peer, body) => seen.push({ peer, body }) });
    await ch.start();
    await Bun.sleep(50);
    await stopChannel(ch);

    expect(seen).toEqual([
      { peer: "1001", body: "hello" },
      { peer: "1001", body: "second" },
      { peer: "2002", body: "after" },
    ]);
    const offsets = calls.map(c => new URL(c.url).searchParams.get("offset"));
    expect(offsets.slice(0, 3)).toEqual(["1", "7", "8"]);
  });

  test("ignores /command text and media-only updates", async () => {
    const seen: string[] = [];
    mockFetch(() => updatesResponse([
      { update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: "/start" } },
      { update_id: 2, message: { message_id: 2, chat: { id: 1 }, photo: [{ file_id: "x" }] } },
      { update_id: 3, message: { message_id: 3, chat: { id: 1 }, text: "real" } },
    ]));

    const ch = new TelegramChannel({ botToken: "tok", onMessage: (_peer, body) => seen.push(body) });
    await ch.start();
    await Bun.sleep(10);
    await stopChannel(ch);

    expect(seen).toEqual(["real"]);
  });

  test("stops polling after a 401 (bad token) instead of retrying", async () => {
    const calls = mockFetch(() => new Response("Unauthorized", { status: 401 }));
    const ch = new TelegramChannel({ botToken: "bad", onMessage: () => {} });
    await ch.start();
    await Bun.sleep(10);
    await stopChannel(ch);
    expect(calls).toHaveLength(1);
  });

  test("sendText and sendImage hit the expected API methods", async () => {
    const calls = mockFetch(() => new Response('{"ok":true}', { status: 200 }));
    const ch = new TelegramChannel({ botToken: "tok", onMessage: () => {} });

    await ch.sendText("42", "hi");
    const msg = calls[0];
    expect(msg.url).toContain("/sendMessage");
    expect(JSON.parse(String(msg.init?.body))).toEqual({ chat_id: "42", text: "hi" });

    await ch.sendImage("42", { data: new Uint8Array([1, 2, 3]), mime: "image/png" }, "plan");
    const photo = calls[1];
    expect(photo.url).toContain("/sendPhoto");
    expect(photo.init?.body).toBeInstanceOf(FormData);
  });
});