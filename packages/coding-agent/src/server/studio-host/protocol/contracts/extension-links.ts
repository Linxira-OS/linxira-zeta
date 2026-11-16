export type ExtensionLinkOperation = {
	kind: "extensions.links.activate";
	sessionId: string;
	sourceSessionId?: string;
	agentId?: string;
	url: string;
};
export interface ExtensionLinkResultMap {
	"extensions.links.activate": { handled: boolean };
}
export const EXTENSION_LINK_KINDS = ["extensions.links.activate"] as const;

/**
 * Read side of the link family. Official v0.2.1 declares this projection in
 * `runtime-views`; this host keeps the exact same input/result shape beside the
 * activation command so the link surface does not depend on the larger
 * transient-media contract.
 */
export type ExtensionLinkListInput = {
	sessionId: string;
	sourceSessionId?: string;
	agentId?: string;
};
export interface ExtensionLinkQueryResultMap {
	"extensions.links.list": { schemes: string[] };
}
export const EXTENSION_LINK_QUERY_KINDS = ["extensions.links.list"] as const;
export function isExtensionLinkQueryKind(kind: string): kind is keyof ExtensionLinkQueryResultMap {
	return (EXTENSION_LINK_QUERY_KINDS as readonly string[]).includes(kind);
}
