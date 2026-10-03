import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { parseTerminalFrame, terminalReconnectDelayMs, buildTerminalWsUrl } = await jiti.import(
  "@/lib/terminal-client",
);

const encoder = new TextEncoder();

function metaFrame(payload) {
  const json = encoder.encode(JSON.stringify(payload));
  const frame = new Uint8Array(json.length + 1);
  frame[0] = 0;
  frame.set(json, 1);
  return frame;
}

test("parseTerminalFrame decodes 0x00-prefixed control frames", () => {
  const parsed = parseTerminalFrame(metaFrame({ replayedBytes: 42 }));
  assert.deepEqual(parsed, { kind: "control", payload: { replayedBytes: 42 } });
});

test("parseTerminalFrame decodes an exit event", () => {
  const parsed = parseTerminalFrame(metaFrame({ event: "exit", exitCode: 137 }));
  assert.equal(parsed.kind, "control");
  assert.equal(parsed.payload.event, "exit");
  assert.equal(parsed.payload.exitCode, 137);
});

test("parseTerminalFrame passes raw bytes through as data", () => {
  const parsed = parseTerminalFrame(encoder.encode("ls\r\n"));
  assert.equal(parsed.kind, "data");
  assert.deepEqual(parsed.bytes, encoder.encode("ls\r\n"));
});

test("parseTerminalFrame accepts ArrayBuffer and degrades malformed JSON", () => {
  const good = metaFrame({ a: 1 });
  const buffer = good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength);
  assert.deepEqual(parseTerminalFrame(buffer), { kind: "control", payload: { a: 1 } });
  const malformed = encoder.encode("\x00{not json");
  assert.deepEqual(parseTerminalFrame(malformed), { kind: "control", payload: {} });
});

test("reconnect backoff doubles and caps at 8s", () => {
  // Deterministic jitter: 1.0 → upper bound of the ±20% spread is >1, but the
  // base sequence without spread must match exactly.
  const seq = [1, 2, 3, 4, 5, 6, 7].map(attempt => terminalReconnectDelayMs(attempt, 0.5));
  assert.deepEqual(seq, [500, 1000, 2000, 4000, 8000, 8000, 8000]);
});

test("reconnect jitter stays within ±20% of the exponential delay", () => {
  for (let attempt = 1; attempt <= 8; attempt++) {
    for (const jitter of [0, 0.5, 1]) {
      const delay = terminalReconnectDelayMs(attempt, jitter);
      const exponential = Math.min(500 * 2 ** (attempt - 1), 8000);
      assert.ok(delay >= exponential * 0.8 - 1, `delay ${delay} below spread at attempt ${attempt}`);
      assert.ok(delay <= exponential * 1.2 + 1, `delay ${delay} above spread at attempt ${attempt}`);
    }
  }
});

test("reconnect backoff accepts out-of-range jitter defensively", () => {
  const low = terminalReconnectDelayMs(1, -5);
  const high = terminalReconnectDelayMs(1, 42);
  assert.equal(low, 400); // clamped to spread lower bound
  assert.equal(high, 600); // clamped to spread upper bound
});

test("buildTerminalWsUrl encodes session id and ticket", () => {
  const url = buildTerminalWsUrl("http://127.0.0.1:30141", "abc-123", "t/+=?");
  assert.equal(url, "ws://127.0.0.1:30141/api/terminal/abc-123/ws?ticket=t%2F%2B%3D%3F");
  const https = buildTerminalWsUrl("https://zeta.example.com/", "abc", "tk");
  assert.equal(https, "wss://zeta.example.com/api/terminal/abc/ws?ticket=tk");
});
