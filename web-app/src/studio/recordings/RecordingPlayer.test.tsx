import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parsePlaybackRecording, type PlaybackRecording } from "./format";
import { RecordingPlayer } from "./RecordingPlayer";

const mocks = vi.hoisted(() => ({ writes: vi.fn(), dispose: vi.fn(), created: 0 }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options = {};
  constructor() { mocks.created++; }
  open() {}
  reset() {}
  resize() {}
  write(text: string, done: () => void) { mocks.writes(text); done(); }
  dispose() { mocks.dispose(); }
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); mocks.writes.mockClear(); mocks.dispose.mockClear(); mocks.created = 0; });

it("pauses a hidden panel without reparsing or recreating its recording terminal", async () => {
  vi.useFakeTimers();
  const text = JSON.stringify({ studiocast: 1, cols: 80, rows: 24, title: "Playback", createdAt: "2026-10-29T00:00:00Z" }) + '\n[0,{"t":"output","data":"start"}]\n[100,{"t":"output","data":"next"}]\n[10000,{"t":"output","data":"end"}]\n';
  const recording = parsePlaybackRecording(text);
  let parses = 0;
  vi.stubGlobal("Worker", class {
    onmessage?: (event: { data: { recording: typeof recording } }) => void;
    postMessage() { parses++; queueMicrotask(() => this.onmessage?.({ data: { recording } })); }
    terminate() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const view = render(<RecordingPlayer demoText={text} visible />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^(Play|播放)$/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  const seek = screen.getByRole("slider") as HTMLInputElement;
  expect(Number(seek.value)).toBeGreaterThan(0);
  view.rerender(<RecordingPlayer demoText={text} visible={false} />);
  const stoppedAt = seek.value;
  const writes = mocks.writes.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(seek.value).toBe(stoppedAt);
  expect(mocks.writes).toHaveBeenCalledTimes(writes);
  view.rerender(<RecordingPlayer demoText={text} visible />);
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  expect(seek.value).toBe(stoppedAt);
  expect(parses).toBe(1);
  expect(mocks.created).toBe(1);
  expect(mocks.dispose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^(Play|播放)$/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(160); });
  expect(Number(seek.value)).toBeGreaterThan(Number(stoppedAt));
});

it("plays a native terminal recording through the recorder authority without a Host client", async () => {
  const text = '{"studiocast":1,"cols":80,"rows":24,"title":"Native recorder","createdAt":"2026-11-16T00:00:00Z"}\n[0,{"t":"output","data":"NATIVE_RECORDER_OUTPUT"}]\n';
  vi.stubGlobal("Worker", class {
    onmessage?: (event: { data: { recording: PlaybackRecording } }) => void;
    postMessage(input: { text: string }) { queueMicrotask(() => this.onmessage?.({ data: { recording: parsePlaybackRecording(input.text) } })); }
    terminate() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "zeta-artifact://recorder/recording-native.studiocast" ? new Response(text) : new Response(null, { status: 400 })));
  render(<RecordingPlayer artifactId="recording-native.studiocast" />);
  await act(async () => {});
  await waitFor(() => expect(mocks.writes.mock.calls.some(([output]) => output.includes("NATIVE_RECORDER_OUTPUT"))).toBe(true));
});
