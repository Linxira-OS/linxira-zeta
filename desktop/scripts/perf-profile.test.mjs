import assert from "node:assert/strict";
import test from "node:test";
import { PerfProfileService, createPerfProfileSnapshot, gradePerfProfile, detectSoftwareCompositing, needsGpuInfoFallback } from "../dist/perf-profile.js";
import { parsePerfProfileSnapshot } from "../dist/perf-profile-cache.js";
import { registerPerfProfileIpc } from "../dist/perf-profile-ipc.js";
import { PERF_PROFILE_CHANNELS as channels } from "../dist/perf-profile-shared.js";

// Matrix, cache, concurrency and IPC behavior adapted from official
// apps/desktop/test/perf-profile.test.ts, with no Electron/GPU process.
const hardware = { gpu_compositing: "enabled", "2d_canvas": "enabled", rasterization: "enabled", webgl: "enabled" };
const software = { gpu_compositing: "unavailable_software", "2d_canvas": "unavailable_software", rasterization: "unavailable_software", webgl: "unavailable_software" };
const facts = { gpuFeatureStatus: hardware, cores: 8, totalMemoryBytes: 16 * 1024 ** 3, onBattery: false };
const cached = createPerfProfileSnapshot({ ...facts, gpuFeatureStatus: software }, { probedAt: new Date("2026-10-30T00:00:00.000Z"), source: "cache" });
function deps(overrides = {}) {
  const written = [], changed = [], calls = [];
  return { written, changed, calls, value: {
    getGPUFeatureStatus() { calls.push("gpu"); return hardware; },
    async getGLRenderer() { calls.push("renderer"); return undefined; },
    cores: () => 8, totalMemoryBytes: () => facts.totalMemoryBytes, onBattery: () => false,
    now: () => new Date("2026-11-15T00:00:00.000Z"), readCache: async () => cached,
    async writeCache(snapshot) { written.push(snapshot); }, onChanged: snapshot => changed.push(snapshot), ...overrides,
  } };
}

test("performance grades preserve hardware/battery/software/low-spec precedence and fallback evidence", () => {
  for (const [input, tier, motion] of [[facts, "L0", "full"], [{ ...facts, onBattery: true }, "L1", "reduced"], [{ ...facts, gpuFeatureStatus: software }, "L2", "reduced"], [{ ...facts, cores: 2 }, "L3", "off"], [{ ...facts, totalMemoryBytes: 4 * 1024 ** 3 }, "L3", "off"], [{ ...facts, gpuFeatureStatus: software, cores: 2, onBattery: true }, "L3", "off"]]) {
    const result = gradePerfProfile(input); assert.equal(result.tier, tier); assert.equal(result.motion, motion);
  }
  for (const feature of Object.keys(hardware)) assert.equal(detectSoftwareCompositing({ ...hardware, [feature]: "unavailable_software" }).software, true);
  for (const renderer of ["Google SwiftShader", "llvmpipe (LLVM 15.0.6)", "Microsoft Basic Render Driver", "NVIDIA WARP"]) assert.equal(detectSoftwareCompositing({}, renderer).software, true);
  assert.equal(needsGpuInfoFallback(hardware), false); assert.equal(needsGpuInfoFallback(software), false); assert.equal(needsGpuInfoFallback({}), true);
  assert.deepEqual(parsePerfProfileSnapshot(cached), cached);
  for (const invalid of [{ ...cached, tier: "L9" }, { ...cached, reasons: ["x".repeat(500)] }, { ...cached, cores: -1 }, { ...cached, probedAt: "yesterday" }, { ...cached, extra: true }, { ...cached, glRenderer: 42 }]) assert.equal(parsePerfProfileSnapshot(invalid), undefined);
});

test("cached first paint loads before probe and unsettled software never persists or broadcasts", async () => {
  let settled = false;
  const f = deps({ getGPUFeatureStatus: () => software, gpuStatusSettled: () => settled }), service = new PerfProfileService(f.value);
  assert.equal((await service.load()).source, "cache"); assert.equal(service.current().tier, "L2");
  assert.equal((await service.refresh()).tier, "L0");
  assert.deepEqual(f.written, []); assert.deepEqual(f.changed, []);
  settled = true;
  assert.equal((await service.refresh()).tier, "L2");
  assert.deepEqual(f.written.map(value => value.tier), ["L2"]); assert.deepEqual(f.changed.map(value => value.tier), ["L2"]);
});

test("concurrent probes share work and a GPU change during a pending probe refreshes before resolving", async () => {
  let settled = false, release;
  const f = deps({ getGPUFeatureStatus() { f.calls.push("gpu"); return software; }, gpuStatusSettled: () => settled, getGLRenderer: () => new Promise(resolve => { release = resolve; }) });
  const service = new PerfProfileService(f.value), first = service.refresh();
  settled = true; const changed = service.refresh(true); release(undefined);
  assert.equal((await first).tier, "L2"); assert.equal((await changed).tier, "L2");
  assert.deepEqual(f.changed.map(value => value.tier), ["L2"]); assert.deepEqual(f.calls, ["gpu"]);
  const clean = deps(), other = new PerfProfileService(clean.value);
  const [a, b] = await Promise.all([other.probe(), other.probe()]);
  assert.equal(a, b); assert.deepEqual(clean.calls, ["gpu"]); assert.equal(await other.probe(), a);
});

test("malformed cache and cache write failure do not replace measured facts", async () => {
  const f = deps({ readCache: async () => ({ tier: "L9" }), async writeCache() { throw new Error("EACCES"); } }), service = new PerfProfileService(f.value);
  assert.equal(await service.load(), undefined); assert.equal((await service.probe()).tier, "L0");
});

test("profile IPC exposes only read channels, answers cached synchronously, and rejects foreign senders", async () => {
  const handlers = new Map(), listeners = new Map(); let probes = 0;
  const ipcMain = { handle: (name, listener) => handlers.set(name, listener), removeHandler: name => handlers.delete(name), on: (name, listener) => listeners.set(name, listener), removeListener: name => listeners.delete(name) };
  const sender = { isDestroyed: () => false, getURL: () => "http://127.0.0.1:43141/" };
  const handle = registerPerfProfileIpc({ ipcMain, isTrustedSender: candidate => candidate === sender, service: { async probe() { probes++; return cached; }, current: () => cached } });
  assert.deepEqual([...handlers.keys()], [channels.probe]);
  const event = { sender }; listeners.get(channels.cached)(event); assert.equal(event.returnValue, cached);
  assert.equal(await handlers.get(channels.probe)({ sender }), cached); assert.equal(probes, 1);
  const foreign = { sender: { ...sender } }; listeners.get(channels.cached)(foreign); assert.equal(foreign.returnValue, null);
  assert.equal(await handlers.get(channels.probe)(foreign), null);
  assert.equal(await handlers.get(channels.probe)({ sender: { ...sender, isDestroyed: () => true } }), null);
  handle.dispose(); assert.equal(handlers.size, 0); assert.equal(listeners.size, 0);
});
