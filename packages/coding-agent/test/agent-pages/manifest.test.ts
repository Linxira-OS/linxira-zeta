/**
 * Agent page manifests and permissions.
 *
 * The tests pin the boundary the gateway relies on: paths are literal and
 * page-relative, permissions are empty by default, and a grant only covers the
 * exact file, directory prefix, host, or workflow it names.
 */
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
	AGENT_PAGE_SCHEMA,
	AgentPageError,
	checkAgentPagePermission,
	isAgentPagePathWithin,
	normalizePageRelativePath,
	parseAgentPageManifest,
} from "../../src/agent-pages";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: AGENT_PAGE_SCHEMA,
		id: "demo",
		name: "Demo",
		entry: "index.html",
		permissions: {},
		workflows: [],
		...overrides,
	};
}

function errorCode(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof AgentPageError) return error.code;
		throw error;
	}
	throw new Error("expected an AgentPageError");
}

describe("manifest path containment", () => {
	test("rejects entry and permission paths that escape the page root", () => {
		for (const entry of ["../escape.html", "/etc/passwd.html", "C:\\secret.html", "a/../../escape.html"]) {
			expect(errorCode(() => parseAgentPageManifest(manifest({ entry })))).toBe("invalid_manifest");
		}
		expect(errorCode(() => parseAgentPageManifest(manifest({ permissions: { read: ["../secret"] } })))).toBe(
			"invalid_manifest",
		);
		expect(errorCode(() => parseAgentPageManifest(manifest({ permissions: { write: ["C:\\secret"] } })))).toBe(
			"invalid_manifest",
		);
	});

	test("normalizes literal relative paths and refuses wildcards and URL syntax", () => {
		expect(normalizePageRelativePath("data/input.txt", "path")).toBe("data/input.txt");
		expect(normalizePageRelativePath("data/", "path", { allowTrailingSlash: true })).toBe("data/");
		for (const value of ["data/*.txt", "a//b", "./a", "a/./b", "a?b", "a#b", "a\\b", ""]) {
			expect(errorCode(() => normalizePageRelativePath(value, "path"))).toBe("invalid_manifest");
		}
		if (process.platform === "win32") {
			for (const value of ["CON", "aux.txt", "com1", "data/nul"]) {
				expect(errorCode(() => normalizePageRelativePath(value, "path"))).toBe("invalid_manifest");
			}
		}
	});

	test("contains targets by real path segment, not by string prefix", () => {
		const root = path.resolve("/tmp/agent-pages/demo");
		expect(isAgentPagePathWithin(root, path.join(root, "data", "input.txt"))).toBe(true);
		expect(isAgentPagePathWithin(root, path.join(root, "..", "other"))).toBe(false);
		expect(isAgentPagePathWithin(root, path.join(root, "..", "demo-other"))).toBe(false);
		expect(isAgentPagePathWithin(root, root)).toBe(false);
	});
});

describe("permission checking", () => {
	test("denies read, write, network, and spawn when no grant is declared", () => {
		const parsed = parseAgentPageManifest(manifest());
		for (const request of [
			{ permission: "read" as const, path: "data/input.txt" },
			{ permission: "write" as const, path: "out/result.json" },
			{ permission: "network" as const, url: "https://api.example.test/data" },
			{ permission: "spawn" as const, workflow: "child" },
		]) {
			const decision = checkAgentPagePermission(parsed.permissions, request);
			expect(decision.allowed).toBe(false);
		}
	});

	test("allows only the exact file, directory prefix, host, and workflow granted", () => {
		const parsed = parseAgentPageManifest(
			manifest({
				permissions: {
					read: ["data/"],
					write: ["out/result.json"],
					network: ["api.example.test", "*.assets.example.test"],
					spawn: ["child"],
				},
				workflows: [
					{ id: "child", steps: [{ id: "seed", kind: "constant", value: true }] },
					{ id: "other", steps: [{ id: "seed", kind: "constant", value: true }] },
				],
			}),
		);
		expect(checkAgentPagePermission(parsed.permissions, { permission: "read", path: "data/input.txt" }).allowed).toBe(
			true,
		);
		expect(checkAgentPagePermission(parsed.permissions, { permission: "read", path: "data" }).allowed).toBe(false);
		expect(checkAgentPagePermission(parsed.permissions, { permission: "read", path: "data-other/x" }).allowed).toBe(
			false,
		);
		expect(
			checkAgentPagePermission(parsed.permissions, { permission: "write", path: "out/result.json" }).allowed,
		).toBe(true);
		expect(
			checkAgentPagePermission(parsed.permissions, { permission: "write", path: "out/other.json" }).allowed,
		).toBe(false);
		expect(
			checkAgentPagePermission(parsed.permissions, { permission: "network", url: "https://api.example.test/x" })
				.allowed,
		).toBe(true);
		expect(
			checkAgentPagePermission(parsed.permissions, {
				permission: "network",
				url: new URL("https://mirror.assets.example.test/file"),
			}).allowed,
		).toBe(true);
		expect(
			checkAgentPagePermission(parsed.permissions, { permission: "network", url: "https://evil.test/" }).allowed,
		).toBe(false);
		expect(checkAgentPagePermission(parsed.permissions, { permission: "spawn", workflow: "child" }).allowed).toBe(
			true,
		);
		expect(checkAgentPagePermission(parsed.permissions, { permission: "spawn", workflow: "other" }).allowed).toBe(
			false,
		);
	});

	test("denies traversal even when a broad-looking grant exists", () => {
		const parsed = parseAgentPageManifest(manifest({ permissions: { read: ["data/"] } }));
		const decision = checkAgentPagePermission(parsed.permissions, { permission: "read", path: "../secret" });
		expect(decision.allowed).toBe(false);
	});
});
