import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  FIRST_TERMINAL_INSTANCE,
  TERMINAL_SLOTS_STORAGE_KEY,
  nextTerminalInstance,
  parseTerminalSlots,
  slotsFor,
  terminalWorkspaceKey,
  withActiveInstance,
  withNewInstance,
  withSessionId,
  withoutSessionId,
} = await jiti.import("@/lib/terminal-workspaces");

test("workspace keys normalise separators, trailing slashes and drive case", () => {
  assert.equal(terminalWorkspaceKey("/repo/app/"), "/repo/app");
  assert.equal(terminalWorkspaceKey("C:\\Users\\me\\repo\\"), "c:/users/me/repo");
  assert.equal(terminalWorkspaceKey(null), "");
  assert.equal(terminalWorkspaceKey("   "), "");
});

test("instance ids start at t1 and never reuse a number", () => {
  assert.equal(nextTerminalInstance([]), FIRST_TERMINAL_INSTANCE);
  assert.equal(nextTerminalInstance(["t1"]), "t2");
  assert.equal(nextTerminalInstance(["t1", "t3"]), "t4");
  assert.equal(nextTerminalInstance(["weird"]), "t1");
});

test("a workspace materialises one default slot", () => {
  const slots = slotsFor({}, "/repo");
  assert.deepEqual(slots, { instances: ["t1"], active: "t1", sessionIds: {} });
});

test("allocating a second slot appends and activates it", () => {
  const first = slotsFor({}, "/repo");
  const { state, instanceId } = withNewInstance({ "/repo": first }, "/repo");
  assert.equal(instanceId, "t2");
  assert.deepEqual(state["/repo"].instances, ["t1", "t2"]);
  assert.equal(state["/repo"].active, "t2");
  // Allocating again keeps counting up (an id is never handed out twice).
  const third = withNewInstance(state, "/repo");
  assert.equal(third.instanceId, "t3");
});

test("slots are per workspace: two workspaces never share one", () => {
  const { state, instanceId } = withNewInstance({}, "/repo/a");
  const other = slotsFor(state, "/repo/b");
  assert.deepEqual(other.instances, ["t1"]);
  assert.notEqual(instanceId, "");
  assert.deepEqual(state["/repo/a"].instances, ["t1", "t2"]);
});

test("selecting an unknown slot is a no-op", () => {
  const state = {};
  assert.equal(withActiveInstance(state, "/repo", "t9"), state);
});

test("session ids are recorded per slot and can be forgotten", () => {
  const withId = withSessionId({}, "/repo", "t1", "sess-a");
  assert.equal(withId["/repo"].sessionIds.t1, "sess-a");
  const switched = withActiveInstance(withId, "/repo", "t1");
  assert.equal(switched["/repo"].active, "t1");
  const stopped = withoutSessionId(withId, "/repo", "t1");
  assert.equal(stopped["/repo"].sessionIds.t1, undefined);
  // Forgetting an unknown slot leaves the state untouched (no needless write).
  assert.equal(withoutSessionId(stopped, "/repo", "t1"), stopped);
});

test("persisted blobs parse defensively", () => {
  assert.deepEqual(parseTerminalSlots(null), {});
  assert.deepEqual(parseTerminalSlots("{not json"), {});
  assert.deepEqual(parseTerminalSlots('{"\/repo":{"instances":[]}}'), {});
  const state = parseTerminalSlots(
    JSON.stringify({ "/repo": { instances: ["t1", "t2"], active: "t2", sessionIds: { t2: "s" } } }),
  );
  assert.deepEqual(state["/repo"].instances, ["t1", "t2"]);
});

test("the storage key is versioned", () => {
  assert.equal(TERMINAL_SLOTS_STORAGE_KEY, "zeta.terminal.slots.v1");
});
