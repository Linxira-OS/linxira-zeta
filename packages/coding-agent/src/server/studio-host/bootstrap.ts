/**
 * `ClientBootstrap` for the Zeta host.
 *
 * The Renderer starts with this: who the authority is, whether a runtime is
 * connected, which host surfaces exist, and the capability manifest that gates
 * navigation. Every fact here comes from Zeta's own process identity, so a
 * surface this host does not implement cannot be navigated to — the manifest
 * advertises exactly the operations {@link StudioOperations} answers.
 *
 * No secret, path or PID leaves this module: the authority id is an opaque hash
 * of the serve instance, and the runtime block is deliberately
 * `compatible-system` (Zeta's own runtime, not the upstream managed one).
 */
import { createHash } from "node:crypto";
import type { AuthorityEpoch, AuthorityId, ClientBootstrap, RuntimeConnection } from "./contract/index.js";
import type { CapabilityManifest } from "./protocol/index.js";
import { canonicalJson } from "./protocol/canonical-json.js";
import { serveIdentity } from "../web-gateway/identity";
import type { StudioOperations } from "./registry.js";

const AUTHORITY_EPOCH = 1 as AuthorityEpoch;

/** Stable, opaque authority identity for this serve instance. */
function authorityId(version: string, startedAt: string): AuthorityId {
	const digest = createHash("sha256").update(`zeta-serve\u0000${version}\u0000${startedAt}`).digest("hex");
	return `authority-${digest.slice(0, 16)}` as AuthorityId;
}

/** The Zeta runtime as the Renderer sees it: connected, compatible, versioned. */
function runtimeConnection(version: string): RuntimeConnection {
	return {
		status: "connected",
		classification: "compatible-system",
		backend: "studio-host",
		runtimeVersion: version,
	};
}

/**
 * The operation manifest with a fresh `generatedAt`. The hash covers only the
 * advertised ids, so a second bootstrap in the same process keeps its identity
 * while the timestamp stays honest.
 */
function manifest(operations: StudioOperations): CapabilityManifest {
	const { manifest } = operations.capabilities();
	return { ...manifest, generatedAt: new Date().toISOString() };
}

/**
 * Hash of the operator command manifest advertised alongside the capabilities.
 * Zeta has no separate operator command manifest, so the hash covers exactly
 * the commands `commands.getManifest` can answer.
 */
export function commandManifestHash(operations: StudioOperations): string {
	return createHash("sha256").update(canonicalJson(operations.commands)).digest("hex");
}

/** Build the bootstrap the Renderer mounts with. */
export function buildBootstrap(operations: StudioOperations): ClientBootstrap {
	const identity = serveIdentity();
	const runtime = runtimeConnection(identity.version);
	const capabilityManifest: CapabilityManifest = manifest(operations);
	return {
		contractVersion: 2,
		authority: { authorityId: authorityId(identity.version, identity.startedAt), authorityEpoch: AUTHORITY_EPOCH },
		runtime,
		surface: { terminalAttach: true, fileReveal: true, previewInput: false, openExternal: true },
		capabilityManifest,
		commandManifestHash: commandManifestHash(operations),
		selected: {},
		stateVersion: 1 as ClientBootstrap["stateVersion"],
	};
}
