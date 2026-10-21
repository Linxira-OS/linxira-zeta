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
export {
	CLOSED_MESH_GEARS,
	MESH_GEAR_VALUES,
	MESH_INBOUND_GEAR_SETTING,
	MESH_OUTBOUND_GEAR_SETTING,
	OPEN_MESH_GEARS,
	type GearCall,
	type GearDecision,
	type GearParty,
	type GearSettingsSource,
	type MeshGear,
	type MeshGears,
	defaultGearsForRoot,
	evaluateGearCall,
	gearAllows,
	gearsFromProjectLayer,
	gearsFromSettings,
	isMeshGear,
	normalizeGear,
	readWorkspaceGears,
} from "./gears";
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
