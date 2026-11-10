import { describe, expect, test } from "bun:test";
import type { CapabilityManifest } from "@linxiraos/studio-protocol";
import { runtimeActionSupport, sessionActionSupport, supportedCapabilityIds, supportsCapability } from "./capabilitySupport";

function manifest(entries: ReadonlyArray<[string, "stable" | "unavailable"]>): CapabilityManifest {
	return {
		profile: "limited",
		generatedAt: "2026-01-01T00:00:00.000Z",
		hash: "test",
		capabilities: entries.map(([id, grade]) => ({ id, grade, version: 1, evidence: "test" })),
	};
}

describe("capability support", () => {
	test("a missing manifest advertises nothing", () => {
		expect(supportsCapability(undefined, "session.fork")).toBe(false);
		expect([...supportedCapabilityIds(undefined)]).toEqual([]);
	});

	test("unavailable entries are not support", () => {
		const caps = manifest([["session.fork", "unavailable"], ["operator.invoke", "stable"]]);
		expect(supportsCapability(caps, "session.fork")).toBe(false);
		expect(supportsCapability(caps, "operator.invoke")).toBe(true);
		expect(supportsCapability(caps, "session.handoff")).toBe(false);
	});

	test("session actions follow the advertised Host operations", () => {
		// Zeta advertises fork/prompt family but not operator.invoke or handoff.
		const zeta = sessionActionSupport(manifest([["session.fork", "stable"], ["core.prompt", "stable"]]));
		expect(zeta).toEqual({ rename: false, fork: true, handoff: false, compact: false, export: false });

		// A full-parity Host that does advertise them keeps the whole menu.
		const full = sessionActionSupport(manifest([
			["session.fork", "stable"],
			["session.handoff", "stable"],
			["operator.invoke", "stable"],
		]));
		expect(full).toEqual({ rename: true, fork: true, handoff: true, compact: true, export: true });
	});

	test("runtime.ensure does not imply a managed install", () => {
		// A host that is its own runtime probes through ensure but cannot install.
		expect(runtimeActionSupport(manifest([["runtime.ensure", "stable"]]))).toEqual({ install: false, ensure: true });
		expect(runtimeActionSupport(manifest([
			["runtime.ensure", "stable"],
			["runtime.install", "stable"],
		]))).toEqual({ install: true, ensure: true });
		expect(runtimeActionSupport(manifest([["runtime.install", "unavailable"]]))).toEqual({ install: false, ensure: false });
		expect(runtimeActionSupport(undefined)).toEqual({ install: false, ensure: false });
	});
});
