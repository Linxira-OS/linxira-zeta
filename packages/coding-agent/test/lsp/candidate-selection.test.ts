/**
 * Candidate-chain selection: the first candidate whose command resolves is the
 * server that runs, and a chain with nothing installed yields a reason instead
 * of a server. Fixtures put executables in `node_modules/.bin`, which
 * `resolveCommand` treats as a project-local bin directory.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WhichCachePolicy } from "@linxiraos/pi-utils";
import { selectServerCommand } from "../../src/lsp/config";
import { LSP_SERVERS } from "../../src/lsp/servers.generated";

const typescript = LSP_SERVERS.typescript;

/** A project root whose local bin directory contains the named commands. */
function projectWith(binaries: string[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-lsp-candidates-"));
	fs.writeFileSync(path.join(root, "package.json"), "{}");
	const binDir = path.join(root, "node_modules", ".bin");
	fs.mkdirSync(binDir, { recursive: true });
	for (const binary of binaries) fs.writeFileSync(path.join(binDir, binary), "");
	return root;
}

function selectIn(root: string) {
	return selectServerCommand(typescript, root, {
		localRoots: [root],
		cache: WhichCachePolicy.Bypass,
		PATH: path.join(root, "empty-path"),
	});
}

describe("lsp candidate selection", () => {
	it("prefers tsgo when it is installed", () => {
		const root = projectWith(["tsgo", "typescript-language-server", "tsc"]);
		const result = selectIn(root);
		if ("reason" in result) throw new Error(result.reason);
		expect(result.selection.command).toBe("tsgo");
		expect(result.selection.args).toEqual(["--lsp", "--stdio"]);
		expect(result.selection.resolvedCommand).toBe(path.join(root, "node_modules", ".bin", "tsgo"));
	});

	it("falls back to tsc when tsgo and typescript-language-server are absent", () => {
		const root = projectWith(["tsc"]);
		const result = selectIn(root);
		if ("reason" in result) throw new Error(result.reason);
		expect(result.selection.command).toBe("tsc");
		expect(result.selection.args).toEqual(["--lsp", "--stdio"]);
	});

	it("explains which candidates were tried when none is installed", () => {
		const root = projectWith([]);
		const result = selectIn(root);
		if (!("reason" in result)) throw new Error(`expected no server, got ${result.selection.command}`);
		for (const command of ["tsgo", "typescript-language-server", "tsc"]) {
			expect(result.reason).toContain(command);
		}
	});
});
