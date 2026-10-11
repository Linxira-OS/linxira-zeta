import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WasmGrammarInfo } from "@linxiraos/pi-natives";
import { ensureGrammar, ensureGrammars, installGrammar } from "@linxiraos/zeta/utils/grammars";
import { TempDir } from "@linxiraos/pi-utils";

const RELEASE = "grammars-test";
const WASM = new Uint8Array([
	0x00,
	0x61,
	0x73,
	0x6d,
	0x01,
	0x00,
	0x00,
	0x00,
	...crypto.getRandomValues(new Uint8Array(4096)),
]);
const WASM_SHA256 = new Bun.CryptoHasher("sha256").update(WASM).digest("hex");

function grammarInfo(file: string, sha256: string): WasmGrammarInfo {
	return { language: "testlang", release: RELEASE, file, sha256, size: WASM.byteLength, installed: false };
}

describe("wasm grammar install", () => {
	let server: Bun.Server<undefined>;
	let previousUrl: string | undefined;

	beforeAll(() => {
		const compressed = Bun.zstdCompressSync(WASM);
		server = Bun.serve({
			port: 0,
			fetch(request) {
				const { pathname } = new URL(request.url);
				if (pathname.startsWith(`/${RELEASE}/`) && pathname.endsWith(".wasm.zst")) return new Response(compressed);
				return new Response("not found", { status: 404 });
			},
		});
		previousUrl = process.env.PI_GRAMMARS_URL;
		// `server.url` ends in `/`: the installer must trim it.
		process.env.PI_GRAMMARS_URL = server.url.href;
	});

	afterAll(() => {
		if (previousUrl === undefined) delete process.env.PI_GRAMMARS_URL;
		else process.env.PI_GRAMMARS_URL = previousUrl;
		server.stop(true);
	});

	it("installs the verified grammar at <dir>/<file>", async () => {
		using tempDir = TempDir.createSync("@omp-grammar-install-");
		const info = grammarInfo("testlang-ok.wasm", WASM_SHA256);
		const dest = path.join(tempDir.path(), info.file);

		expect(await installGrammar(info, tempDir.path())).toBe(true);

		expect(await Bun.file(dest).bytes()).toEqual(WASM);
		expect(fs.existsSync(`${dest}.part`)).toBe(false);
		expect(fs.existsSync(`${dest}.zst.part`)).toBe(false);
	});

	it("rejects a digest mismatch without leaving files behind", async () => {
		using tempDir = TempDir.createSync("@omp-grammar-mismatch-");
		const info = grammarInfo("testlang-bad.wasm", "0".repeat(64));
		const dest = path.join(tempDir.path(), info.file);

		expect(await installGrammar(info, tempDir.path())).toBe(false);

		expect(fs.existsSync(dest)).toBe(false);
		expect(fs.existsSync(`${dest}.part`)).toBe(false);
		expect(fs.existsSync(`${dest}.zst.part`)).toBe(false);
	});
});

describe("wasm grammar lookup", () => {
	// An addon built without the on-demand grammar table reports
	// `wasmGrammarFor` as an absent export — a bare `undefined` on a current
	// addon, a rebuild-naming stub on a stale one. The absence is a capability
	// probe, not an error: read summaries and AST tools keep the compiled-in
	// grammars instead of rejecting over the missing optional export.
	it("answers a built-in or unknown query from the compiled-in grammars", async () => {
		expect(await ensureGrammar({ path: "code.ts" })).toBe(true);
		expect(await ensureGrammars(["not-a-real-language"])).toBe(false);
	});
});
