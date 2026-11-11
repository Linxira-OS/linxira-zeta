/**
 * Composer dictation mount gate.
 *
 * The control must not exist (and the status poll must not run) unless the
 * desktop shell exposes the complete microphone bridge AND the Host capability
 * manifest advertises every `dictation.*` command. These tests pin the gate;
 * they do not touch a microphone or an ASR model.
 */
import { describe, expect, test } from "bun:test";
import {
  desktopDictationBridge,
  dictationControlMounts,
  type DictationGateInput,
} from "./dictationSurface";

const COMPLETE_BRIDGE = {
  attachLiveAudio: async () => ({ ok: true }),
  appendLiveAudio: async () => ({ ok: true }),
  detachLiveAudio: async () => ({ ok: true }),
};
const MEDIA_DEVICES = { getUserMedia: async () => undefined };

function input(overrides: Partial<DictationGateInput> = {}): DictationGateInput {
  return {
    preview: false,
    capabilityAvailable: true,
    bridgeComplete: true,
    available: true,
    sessionId: "session-1",
    remoteTarget: false,
    supported: true,
    ...overrides,
  };
}

describe("draft dictation mount gate", () => {
  test("a complete desktop bridge with all dictation capabilities mounts", () => {
    expect(desktopDictationBridge(COMPLETE_BRIDGE, MEDIA_DEVICES)).toBe(true);
    expect(dictationControlMounts(input())).toBe(true);
  });

  test("a browser tab without the bridge renders nothing", () => {
    expect(desktopDictationBridge(undefined, MEDIA_DEVICES)).toBe(false);
    expect(dictationControlMounts(input({ bridgeComplete: false }))).toBe(false);
  });

  test("a partial preload bridge is not trusted as a microphone path", () => {
    const missingAppend = { attachLiveAudio: COMPLETE_BRIDGE.attachLiveAudio, detachLiveAudio: COMPLETE_BRIDGE.detachLiveAudio };
    const missingDetach = { attachLiveAudio: COMPLETE_BRIDGE.attachLiveAudio, appendLiveAudio: COMPLETE_BRIDGE.appendLiveAudio };
    expect(desktopDictationBridge(missingAppend, MEDIA_DEVICES)).toBe(false);
    expect(desktopDictationBridge(missingDetach, MEDIA_DEVICES)).toBe(false);
    expect(desktopDictationBridge(COMPLETE_BRIDGE, undefined)).toBe(false);
    expect(desktopDictationBridge(COMPLETE_BRIDGE, {})).toBe(false);
  });

  test("a Host without every dictation capability is never polled", () => {
    // `capabilityAvailable` is computed from the manifest before mount; a false
    // value means no `dictation.status` request exists at all.
    expect(dictationControlMounts(input({ capabilityAvailable: false }))).toBe(false);
  });

  test("the W4 availability gate stays independent of the bridge", () => {
    expect(dictationControlMounts(input({ available: false }))).toBe(false);
  });

  test("a remote target or a missing session hides the control", () => {
    expect(dictationControlMounts(input({ remoteTarget: true }))).toBe(false);
    expect(dictationControlMounts(input({ sessionId: undefined }))).toBe(false);
    expect(dictationControlMounts(input({ sessionId: "   " }))).toBe(false);
  });

  test("a stale Host answer hides the control; preview fixtures stay demo-only", () => {
    expect(dictationControlMounts(input({ supported: false }))).toBe(false);
    expect(dictationControlMounts(input({ preview: true, capabilityAvailable: false, bridgeComplete: false, available: false, sessionId: undefined }))).toBe(true);
  });
});
