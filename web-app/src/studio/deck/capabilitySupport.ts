/**
 * Host capability lookups for gating Studio surfaces.
 *
 * The Host's capability manifest is the only honest source of "can this build
 * do X": `crates`-side families register the operations they implement, and an
 * id that is absent (or graded `unavailable`) must not be offered as a button
 * that would only fail. Absence means "not implemented by this Runtime", which
 * is different from a transient error: the UI says so, it does not guess.
 */
import type { CapabilityManifest } from "@linxiraos/studio-protocol";

export type CapabilityLookup = (id: string) => boolean;

/** Ids the Host advertises as usable (present and not graded `unavailable`). */
export function supportedCapabilityIds(manifest: CapabilityManifest | undefined): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const entry of manifest?.capabilities ?? []) {
		if (entry.grade !== "unavailable") ids.add(entry.id);
	}
	return ids;
}

/**
 * Lookup over a manifest. A missing manifest advertises nothing: the renderer
 * cannot claim a capability the Host has not confirmed.
 */
export function supportsCapability(manifest: CapabilityManifest | undefined, id: string): boolean {
	return supportedCapabilityIds(manifest).has(id);
}

/**
 * The capability each session-menu action needs before it can succeed.
 *
 * `fork` is a real Host operation (`session.fork`). The other four are builtin
 * commands reached through `operator.invoke`; `handoff` additionally needs the
 * Host's `session.handoff` command, which Zeta deliberately does not implement.
 */
export const SESSION_ACTION_CAPABILITY = {
	rename: "operator.invoke",
	fork: "session.fork",
	handoff: "session.handoff",
	compact: "operator.invoke",
	export: "operator.invoke",
} as const;

export type SessionActionName = keyof typeof SESSION_ACTION_CAPABILITY;

export type SessionActionSupport = Readonly<Record<SessionActionName, boolean>>;

/** Resolve which session-menu actions the Host can actually perform. */
export function sessionActionSupport(manifest: CapabilityManifest | undefined): SessionActionSupport {
	const ids = supportedCapabilityIds(manifest);
	return {
		rename: ids.has(SESSION_ACTION_CAPABILITY.rename),
		fork: ids.has(SESSION_ACTION_CAPABILITY.fork),
		handoff: ids.has(SESSION_ACTION_CAPABILITY.handoff),
		compact: ids.has(SESSION_ACTION_CAPABILITY.compact),
		export: ids.has(SESSION_ACTION_CAPABILITY.export),
	};
}

/**
 * The two runtime actions the Diagnostics page offers have different Host
 * requirements: `runtime.install` writes a managed artifact, while
 * `runtime.ensure` only probes (and may relaunch) the current runtime. A host
 * that is its own runtime advertises `ensure` but not `install`; treating
 * `ensure` as "can manage" put an Install button on a page that has no managed
 * artifact and no channel to fetch one.
 */
export function runtimeActionSupport(manifest: CapabilityManifest | undefined): {
	readonly install: boolean;
	readonly ensure: boolean;
} {
	const ids = supportedCapabilityIds(manifest);
	return { install: ids.has("runtime.install"), ensure: ids.has("runtime.ensure") };
}
