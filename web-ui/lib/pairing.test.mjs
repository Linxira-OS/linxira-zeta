import assert from "node:assert/strict";
import test from "node:test";

const { consumePairingFragment, parsePairingHash } = await import("./pairing.ts");

test("reads the token from a pairing fragment and ignores unrelated hashes", () => {
  assert.equal(parsePairingHash("#zeta-token=abc%2B%2F%3D"), "abc+/=");
  assert.equal(parsePairingHash("#other=1"), null);
  assert.equal(parsePairingHash("#zeta-token="), null);
  assert.equal(parsePairingHash(""), null);
});

test("scanning a QR stores the token and strips it from the address bar", () => {
  const stored = [];
  const replaced = [];
  const token = consumePairingFragment(
    { hash: "#zeta-token=scanned-secret", pathname: "/", search: "?mode=panel" },
    {
      setToken: (value) => stored.push(value),
      replaceUrl: (url) => replaced.push(url),
    },
  );
  assert.equal(token, "scanned-secret");
  assert.deepEqual(stored, ["scanned-secret"]);
  assert.deepEqual(replaced, ["/?mode=panel"]);
});

test("a normal boot does nothing", () => {
  let touched = false;
  const token = consumePairingFragment(
    { hash: "", pathname: "/", search: "" },
    {
      setToken: () => {
        touched = true;
      },
      replaceUrl: () => {
        touched = true;
      },
    },
  );
  assert.equal(token, null);
  assert.equal(touched, false);
});

test("the stored token wins even when rewriting history fails", () => {
  const stored = [];
  const token = consumePairingFragment(
    { hash: "#zeta-token=keep-me", pathname: "/chat", search: "" },
    {
      setToken: (value) => stored.push(value),
      replaceUrl: () => {
        throw new Error("history is frozen");
      },
    },
  );
  // The helper itself propagates the error (AppShell catches around
  // replaceState); what matters is that the token was stored first.
  assert.equal(token, "keep-me");
  assert.deepEqual(stored, ["keep-me"]);
});
