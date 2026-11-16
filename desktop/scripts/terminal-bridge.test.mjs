import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TerminalBridge } from "../dist/terminal/bridge.js";
import { TerminalOutput, TERMINAL_BUFFER_BYTES } from "../dist/terminal/output.js";
import { parseTerminalCreate } from "../dist/terminal/validation.js";

const scratch = tmpdir();
function terminalHarness() {
  const root = fs.mkdtempSync(join(scratch, "case-"));
  const requests = [], sockets = [], events = [];
  const host = {
    base: "http://127.0.0.1:43141",
    async gateway(route, init) {
      requests.push({ route, init });
      if (route === "/api/terminal/ensure") return { id: "terminal-script-a", shell: "bash", cwd: "/project", ticket: "one-time", instance: "script-a" };
      return { ok: true };
    },
    async socket(route) {
      const socket = { route, opened: Promise.resolve(), written: [], sendText(data) { this.written.push(data); }, close() {} };
      sockets.push(socket); return socket;
    },
  };
  const bridge = new TerminalBridge({ userData: root, connection: target => { assert.equal(target, "ssh-a"); return host; }, data: (id, data, bytes) => events.push({ kind: "data", id, data, bytes }), exit: id => events.push({ kind: "exit", id }) });
  return { bridge, root, requests, sockets, events };
}

test("terminal create preserves command/workspace and uses the authenticated Host socket", async () => {
  const h = terminalHarness();
  try {
    const script = { shell: "bash", text: "printf 'first\\n'\nprintf 'second\\n'" };
    const info = await h.bridge.create({ targetId: "ssh-a", workspaceId: "ws-remote", instanceId: "script-a", command: script, cols: 120, rows: 30 });
    assert.equal(info.cwd, "/project");
    assert.deepEqual(JSON.parse(h.requests[0].init.body), { cols: 120, rows: 30, instanceId: "script-a", workspaceId: "ws-remote", command: script });
    assert.equal(h.sockets[0].route, "/api/terminal/terminal-script-a/ws?ticket=one-time");
    h.bridge.write(info.id, "printf user\r");
    assert.deepEqual(h.sockets[0].written, ["printf user\r"]);
    await h.bridge.resize(info.id, 100, 40);
    assert.deepEqual(JSON.parse(h.requests[1].init.body), { cols: 100, rows: 40 });
    assert.equal(h.bridge.recordingStart({ id: info.id, workspaceId: "ws-remote" }).state, "recording");
    const utf8 = Buffer.from("😀你好");
    h.sockets[0].onBinary(utf8.subarray(0, 2));
    h.sockets[0].onBinary(utf8.subarray(2));
    h.sockets[0].onBinary(Buffer.concat([Buffer.from([0]), Buffer.from('{"event":"exit"}') ]));
    assert.deepEqual(h.events, [{ kind: "data", id: info.id, data: "😀你好", bytes: utf8.length }, { kind: "exit", id: info.id }]);
    const status = h.bridge.recordingStatus(info.id);
    assert.equal(status.state, "saved");
    const recording = fs.readFileSync(h.bridge.artifactPath(status.artifactId), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(recording[0].cols, 100);
    assert.equal(recording[0].rows, 40);
    assert.equal(recording[1][1].data, "😀你好");
  } finally { h.bridge.shutdown(); fs.rmSync(h.root, { recursive: true, force: true }); }
});

test("terminal creation refuses unsupported flow control and invalid scripts before sending", async () => {
  const h = terminalHarness();
  try {
    await assert.rejects(h.bridge.create({ flowControl: true }), /flow control is unavailable/);
    await assert.rejects(h.bridge.create({ command: { shell: "bash", text: "echo ok" }, profileId: "custom" }), /shell profile/);
    for (const command of [{ shell: "cmd", text: "echo" }, { shell: "sh", text: " " }, { shell: "sh", text: "echo\0bad" }, { shell: "bash", text: "😀".repeat(262145) }]) assert.throws(() => parseTerminalCreate({ command }));
    assert.throws(() => parseTerminalCreate({ rows: 1 }), /integer/);
    assert.equal(h.requests.length, 0);
    assert.equal("ack" in h.bridge, false);
  } finally { h.bridge.shutdown(); fs.rmSync(h.root, { recursive: true, force: true }); }
});

test("terminal output coalesces bursts, flushes at the byte cap, and emits decoder tail on close", () => {
  const chunks = [], output = new TerminalOutput((data, bytes) => chunks.push({ data, bytes }));
  output.append("one"); output.append("two");
  assert.deepEqual(chunks, []);
  output.flush();
  assert.deepEqual(chunks, [{ data: "onetwo", bytes: 6 }]);
  output.append(Buffer.alloc(TERMINAL_BUFFER_BYTES, 65));
  assert.equal(chunks[1].bytes, TERMINAL_BUFFER_BYTES);
  output.append(Buffer.from([0xf0, 0x9f]));
  output.close();
  assert.deepEqual(chunks[2], { data: "�", bytes: 3 });
  output.append("late");
  assert.equal(chunks.length, 3);
});
