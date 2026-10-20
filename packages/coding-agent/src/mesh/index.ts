/**
 * Cross-process agent mesh.
 *
 * `MeshNode` is the transport-owning entry point; `raceMutualWait` is the S6
 * deadlock helper; `getMeshNode` is how the in-process bus discovers the node
 * without taking a dependency on `serve`.
 */

export { getMeshNode, setMeshNode } from "./global";
export { MeshDirectory, isPidAlive } from "./directory";
export {
	type ParsedAddress,
	formatMeshAddress,
	isWorkspaceAddress,
	parseMeshAddress,
	tryParseMeshAddress,
	validateEnvelope,
} from "./envelope";
export { MeshMailbox } from "./mailbox";
export { type MeshNodeOptions, type MeshLocalAgent, type MeshDeliverResult, MeshNode } from "./mesh-node";
export { type MutualWaitSource, type MutualWaitStatus, raceMutualWait } from "./mutual-wait";
export {
	meshPaths,
	meshPathsAt,
	resolveMeshRoot,
	workspaceIdFor,
	ensureMeshDirs,
	isSafeAddressSegment,
	isSafeWorkspaceId,
	type MeshPaths,
} from "./paths";
export {
	listenMeshEndpoint,
	readMeshToken,
	sendMeshEnvelope,
	writeMeshToken,
	type MeshAckPayload,
	type MeshTransportServer,
} from "./transport";
export * from "./types";
