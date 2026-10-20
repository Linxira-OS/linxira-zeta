/**
 * Process-global handle to the running mesh node.
 *
 * The bus consults it lazily: with no node installed (CLI, every existing
 * single-process test) delivery is exactly the in-memory behavior it always
 * was. `zeta serve` installs one node at startup and clears it on shutdown.
 */

import type { MeshNode } from "./mesh-node";

let currentNode: MeshNode | undefined;

/** Install (or clear) the process's mesh node. */
export function setMeshNode(node: MeshNode | undefined): void {
	currentNode = node;
}

/** The installed mesh node, if this process participates in the mesh. */
export function getMeshNode(): MeshNode | undefined {
	return currentNode;
}
