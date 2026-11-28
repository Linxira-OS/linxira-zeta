/**
 * Agent pages — capability checks.
 *
 * Every permission is an explicit grant. An omitted grant is empty, never a
 * default allow. File grants are literal page-relative paths (or directory
 * prefixes ending in `/`); network grants are hosts (or `*.` subdomain
 * patterns); spawn grants are workflow ids. Wildcards are deliberately not
 * supported for paths.
 */

import {
	AgentPageError,
	type AgentPagePermissionDecision,
	type AgentPagePermissionRequest,
	type AgentPagePermissions,
} from "./types";
import { isAgentPageId, normalizePageRelativePath, parseAgentPageHttpUrl } from "./manifest";

function deny(
	permission: AgentPagePermissionRequest["permission"],
	resource: string,
	reason: string,
): AgentPagePermissionDecision {
	return { allowed: false, permission, resource, reason };
}

function allow(
	permission: AgentPagePermissionRequest["permission"],
	resource: string,
	reason: string,
): AgentPagePermissionDecision {
	return { allowed: true, permission, resource, reason };
}

function foldPath(value: string): string {
	return process.platform === "win32" ? value.toLowerCase() : value;
}

function pathGrantCovers(grant: string, relativePath: string): boolean {
	const foldedGrant = foldPath(grant);
	const foldedPath = foldPath(relativePath);
	// A trailing slash is the only directory wildcard: `data/` covers
	// `data/file`, while `data` is the exact file named `data`.
	return foldedGrant.endsWith("/") ? foldedPath.startsWith(foldedGrant) : foldedPath === foldedGrant;
}

function hostGrantCovers(grant: string, hostname: string): boolean {
	const lowerHost = hostname.toLowerCase();
	if (grant.startsWith("*.")) {
		const suffix = grant.slice(1); // `.example.com`
		return lowerHost.endsWith(suffix) && lowerHost.length > suffix.length;
	}
	return lowerHost === grant;
}

/**
 * Check one request against the page's declared permissions. Invalid
 * resources are denied, not thrown: a checker is a decision boundary, and the
 * executor turns a denial into a typed `permission_denied` error.
 */
export function checkAgentPagePermission(
	permissions: AgentPagePermissions,
	request: AgentPagePermissionRequest,
): AgentPagePermissionDecision {
	switch (request.permission) {
		case "read":
		case "write": {
			const grants = permissions[request.permission];
			let relativePath: string;
			try {
				relativePath = normalizePageRelativePath(request.path, request.permission);
			} catch {
				return deny(request.permission, String(request.path), "path is not a safe page-relative path");
			}
			if (grants.length === 0) {
				return deny(request.permission, relativePath, `${request.permission} permission is not declared`);
			}
			if (grants.some(grant => pathGrantCovers(grant, relativePath))) {
				return allow(request.permission, relativePath, "covered by a declared grant");
			}
			return deny(request.permission, relativePath, `${request.permission} path is outside the declared grants`);
		}
		case "network": {
			let url: URL;
			try {
				url = parseAgentPageHttpUrl(request.url instanceof URL ? request.url.href : request.url, "network.url");
			} catch {
				return deny("network", String(request.url), "URL must be an absolute HTTP(S) URL");
			}
			const host = url.hostname.toLowerCase();
			const grants = permissions.network;
			if (grants.length === 0) return deny("network", host, "network permission is not declared");
			if (grants.some(grant => hostGrantCovers(grant, host))) {
				return allow("network", host, "covered by a declared grant");
			}
			return deny("network", host, `host "${host}" is outside the declared network grants`);
		}
		case "spawn": {
			const workflow = request.workflow;
			if (!isAgentPageId(workflow)) return deny("spawn", String(workflow), "workflow id is invalid");
			const grants = permissions.spawn;
			if (grants.length === 0) return deny("spawn", workflow, "spawn permission is not declared");
			if (grants.includes(workflow)) return allow("spawn", workflow, "covered by a declared grant");
			return deny("spawn", workflow, `workflow "${workflow}" is outside the declared spawn grants`);
		}
		default:
			return deny("read", "", "unknown permission");
	}
}

/** Throw the gateway's typed denial when the permission check fails. */
export function assertAgentPagePermission(
	permissions: AgentPagePermissions,
	request: AgentPagePermissionRequest,
): AgentPagePermissionDecision {
	const decision = checkAgentPagePermission(permissions, request);
	if (!decision.allowed) {
		throw new AgentPageError("permission_denied", `${request.permission} denied: ${decision.reason}`, 403, {
			permission: request.permission,
			resource: decision.resource,
		});
	}
	return decision;
}
