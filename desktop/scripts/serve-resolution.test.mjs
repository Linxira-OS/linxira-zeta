import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	SERVE_BIN_DIR_ENV,
	SERVE_BIN_NAMES,
	bundledServeCommandIn,
	describeServeResolution,
	findRepoRootIn,
	missingBundledServeFiles,
	parseCommand,
	resolveServeCommandIn,
	spawnSpec,
} from "../src/serve-resolution.ts";

/**POSIX-spelled deps so names/extensions stay deterministic on any host. */
function makeDeps(overrides = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-serve-res-"));
	const deps = {
		isPackaged: false,
		platform: "linux",
		resourcesPath: path.join(root, "resources"),
		env: {},
		exists: candidate => fs.existsSync(candidate),
		readTextFile: candidate => {
			try {
				return fs.readFileSync(candidate, "utf8");
			} catch {
				return null;
			}
		},
		dirname: root,
		cwd: root,
		probePath: () => null,
		serviceBinaryName: "zeta",
		webRuntimeName: "node",
		...overrides,
	};
	return { root, deps };
}

function cleanup({ root }) {
	fs.rmSync(root, { recursive: true, force: true });
}

/** A complete packaged bundle (exe + runtime + web standalone server). */
function installBundle({ root, deps }) {
	const serviceDir = path.join(deps.resourcesPath, "zeta");
	for (const rel of ["zeta", "node", path.join("web-ui", ".next", "standalone", "server.js")]) {
		fs.mkdirSync(path.dirname(path.join(serviceDir, rel)), { recursive: true });
		fs.writeFileSync(path.join(serviceDir, rel), "");
	}
	return serviceDir;
}

test("parseCommand splits quotes and strips them", () => {
	assert.deepEqual(parseCommand('bun cli.ts serve --x "a b"'), ["bun", "cli.ts", "serve", "--x", "a b"]);
	assert.deepEqual(parseCommand("'C:/prog files/zeta' serve"), ["C:/prog files/zeta", "serve"]);
});

test("tier 1: ZETA_SERVE_COMMAND wins over PATH and the vendored bundle", () => {
	const tree = makeDeps({
		isPackaged: true,
		probePath: () => "/usr/local/bin/zetacode",
		env: { ZETA_SERVE_COMMAND: '"mock dir/zeta-c" serve --port 1' },
	});
	try {
		installBundle(tree);
		const cmd = resolveServeCommandIn(tree.deps);
		assert.equal(cmd.file, "mock dir/zeta-c");
		assert.deepEqual(cmd.args, ["serve", "--port", "1"]);
	} finally {
		cleanup(tree);
	}
});

test("tier 1: a ZETA_BIN_DIR dir outranks a PATH hit", () => {
	const tree = makeDeps({ platform: process.platform, probePath: () => "/usr/local/bin/zetacode" });
	try {
		const dir = path.join(tree.root, "override");
		fs.mkdirSync(dir);
		const binName = `zeta-c${process.platform === "win32" ? ".cmd" : ""}`;
		fs.writeFileSync(path.join(dir, binName), "");
		const cmd = resolveServeCommandIn({ ...tree.deps, env: { [SERVE_BIN_DIR_ENV]: dir } });
		assert.equal(cmd.file, path.join(dir, binName));
	} finally {
		cleanup(tree);
	}
});

test("packaged shell: the vendored bundle wins over a PATH hit; bare zeta never probed", () => {
	// v1.2.1 evidence: the shell spawned the PATH npm shim (`zetacode.cmd`), which
	// ships no Web UI, so every launch served a dead UI. The bundle is the only
	// launcher that carries the staged Web UI + Node runtime and is version-locked
	// to the shell, so a packaged shell uses it and never probes PATH at all.
	const tree = makeDeps({ isPackaged: true });
	try {
		const serviceDir = installBundle(tree);
		const probed = [];
		const cmd = resolveServeCommandIn({
			...tree.deps,
			probePath: name => {
				probed.push(name);
				return name === "zeta-c" ? path.join(tree.root, "npm", "zeta-c") : null;
			},
		});
		assert.deepEqual(probed, [], "a complete bundle must be decided before any PATH probe");
		assert.ok(!probed.includes("zeta"), "workbench bin must never be a serve candidate");
		assert.equal(cmd.file, path.join(serviceDir, "zeta"));
		assert.equal(cmd.needsShell, false);
		assert.equal(cmd.env.ZETA_WEB_RUNTIME, path.join(serviceDir, "node"));
	} finally {
		cleanup(tree);
	}
});

test("packaged shell: an incomplete bundle does not shadow a PATH hit", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		// Binary only: no Node runtime, no staged Web UI → not a usable bundle.
		const serviceDir = path.join(tree.deps.resourcesPath, "zeta");
		fs.mkdirSync(serviceDir, { recursive: true });
		fs.writeFileSync(path.join(serviceDir, "zeta"), "");
		const hit = path.join(tree.root, "npm", "zeta-c");
		const cmd = resolveServeCommandIn({ ...tree.deps, probePath: name => (name === "zeta-c" ? hit : null) });
		assert.equal(cmd.file, hit);
	} finally {
		cleanup(tree);
	}
});

test("unpackaged shells never prefer a bundle over PATH", () => {
	const tree = makeDeps({ isPackaged: false });
	try {
		installBundle(tree);
		const hit = path.join(tree.root, "usr", "bin", "zetacode");
		const cmd = resolveServeCommandIn({ ...tree.deps, probePath: name => (name === "zetacode" ? hit : null) });
		assert.equal(cmd.file, hit);
	} finally {
		cleanup(tree);
	}
});

test("tier 3: with no bundle, the PATH probe resolves the absolute suffixed path; bare zeta never probed", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		const probed = [];
		const hit = path.join(tree.root, "npm", "zeta-c");
		const cmd = resolveServeCommandIn({
			...tree.deps,
			probePath: name => {
				probed.push(name);
				return name === "zeta-c" ? hit : null;
			},
		});
		// Canonical-first: the loop probes `zetacode` before its aliases and
		// stops at the first serving-capable hit; the workbench bin is never
		// probed at all.
		assert.deepEqual(probed, ["zetacode", "zeta-c"]);
		assert.ok(!probed.includes("zeta"), "workbench bin must never be a serve candidate");
		// The resolved absolute path is spawned, never the bare probe name.
		assert.equal(cmd.file, hit);
		assert.equal(cmd.needsShell, false);
		assert.equal(cmd.args[0], "serve");
	} finally {
		cleanup(tree);
	}
});

test("tier 3 (win32): a .cmd PATH hit resolves to its absolute suffixed path and needs a shell", () => {
	const tree = makeDeps({ isPackaged: true, platform: "win32" });
	try {
		installBundle(tree);
		// What `where zetacode` yields on an npm install: the shim, with suffix.
		const shim = "C:\\Users\\me\\AppData\\Roaming\\npm\\zetacode.cmd";
		const cmd = resolveServeCommandIn({
			...tree.deps,
			exists: () => false, // no bundle: prove the PATH hit alone resolves
			probePath: name => (name === "zetacode" ? shim : null),
		});
		assert.equal(cmd.file, shim);
		assert.match(cmd.file, /zetacode\.cmd$/);
		assert.notEqual(cmd.file, "zetacode", "must not hand spawn the bare name");
		assert.equal(cmd.needsShell, true);
		assert.deepEqual(cmd.args, ["serve"]);
	} finally {
		cleanup(tree);
	}
});

test("tier 3 (win32): a native .exe PATH hit spawns without a shell", () => {
	const tree = makeDeps({ isPackaged: true, platform: "win32" });
	try {
		installBundle(tree);
		const cmd = resolveServeCommandIn({
			...tree.deps,
			exists: () => false,
			probePath: name => (name === "zetacode" ? "C:\\Program Files\\Zeta\\zetacode.exe" : null),
		});
		assert.equal(cmd.file, "C:\\Program Files\\Zeta\\zetacode.exe");
		assert.equal(cmd.needsShell, false);
	} finally {
		cleanup(tree);
	}
});

test("tier 2: packaged desktop uses its vendored bundle", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		const serviceDir = installBundle(tree);
		const cmd = resolveServeCommandIn(tree.deps);
		assert.equal(cmd.file, path.join(serviceDir, "zeta"));
		assert.equal(cmd.env.ZETA_WEB_RUNTIME, path.join(serviceDir, "node"));
		assert.equal(bundledServeCommandIn(tree.deps)?.cwd, serviceDir);
	} finally {
		cleanup(tree);
	}
});

test("packaged desktop with no PATH hit and an incomplete bundle reports failure (null)", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		assert.equal(resolveServeCommandIn(tree.deps), null);
	} finally {
		cleanup(tree);
	}
});

test("packaged bundle: every missing piece is named, not silently dropped", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		const serviceDir = path.join(tree.deps.resourcesPath, "zeta");
		fs.mkdirSync(serviceDir, { recursive: true });
		fs.writeFileSync(path.join(serviceDir, "zeta"), ""); // binary only
		const missing = missingBundledServeFiles(tree.deps);
		assert.equal(missing.length, 2);
		assert.ok(missing.some(m => m.includes(path.join(serviceDir, "node"))), "Node runtime must be reported");
		assert.ok(
			missing.some(m => m.includes(path.join("web-ui", ".next", "standalone", "server.js"))),
			"Web UI standalone server must be reported",
		);
	} finally {
		cleanup(tree);
	}
});

test("describeServeResolution lists every tier, the paths checked, and the fix", () => {
	const tree = makeDeps({ platform: "linux" });
	try {
		const text = describeServeResolution({
			...tree.deps,
			env: { [SERVE_BIN_DIR_ENV]: "/opt/zeta/bin" },
			probePath: name => (name === "zeta-cli" ? "/usr/bin/zeta-cli" : null),
		});
		assert.match(text, /①/);
		assert.match(text, /②/);
		assert.match(text, /③/);
		assert.ok(text.includes("/opt/zeta/bin"), "explicit dir must appear");
		assert.ok(text.includes("/usr/bin/zeta-cli"), "resolved PATH hit must appear");
		assert.ok(text.includes("zetacode → not found"), "each probed name must appear");
		assert.ok(text.includes("npm install -g @linxiraos/zeta"), "install hint must appear");
	} finally {
		cleanup(tree);
	}
});

test("describeServeResolution reports the bundle tier before the PATH tier when packaged", () => {
	const tree = makeDeps({ isPackaged: true, probePath: name => (name === "zeta-cli" ? "/usr/bin/zeta-cli" : null) });
	try {
		const serviceDir = installBundle(tree);
		const text = describeServeResolution(tree.deps);
		assert.ok(
			text.indexOf(serviceDir) < text.indexOf("/usr/bin/zeta-cli"),
			"the bundled runtime must be listed before the PATH probe",
		);
		assert.match(text, /② vendored/);
		assert.match(text, /③ PATH/);
	} finally {
		cleanup(tree);
	}
});

test("describeServeResolution names the missing bundled files when packaged", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		const serviceDir = path.join(tree.deps.resourcesPath, "zeta");
		const text = describeServeResolution(tree.deps);
		assert.ok(text.includes(serviceDir), "bundled dir must appear");
		assert.ok(text.includes("incomplete"), "an incomplete bundle must be called out");
		assert.ok(text.includes("npm install -g @linxiraos/zeta"));
	} finally {
		cleanup(tree);
	}
});

test("spawnSpec leaves a real executable untouched", () => {
	assert.deepEqual(spawnSpec({ file: "C:\\bin\\zeta.exe", args: ["serve"], cwd: ".", env: {}, needsShell: false }), {
		file: "C:\\bin\\zeta.exe",
		args: ["serve"],
		windowsVerbatimArguments: false,
	});
});

test(
	"real spawn (win32): a resolved .cmd shim starts through cmd.exe even with a spaced path",
	{ skip: process.platform !== "win32" },
	() => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-serve-spawn-"));
		try {
			const dir = path.join(root, "npm dir"); // space on purpose
			fs.mkdirSync(dir, { recursive: true });
			const shim = path.join(dir, "zetacode.cmd");
			fs.writeFileSync(shim, "@echo off\r\necho ZETA-SHIM %*\r\nexit /b 0\r\n");

			// Resolution (what the desktop does) then the exact spawn shape it uses.
			const cmd = resolveServeCommandIn({
				...makeDeps().deps,
				platform: "win32",
				exists: () => false,
				probePath: name => (name === "zetacode" ? shim : null),
			});
			assert.match(cmd.file, /zetacode\.cmd$/);
			assert.equal(cmd.needsShell, true);

			const spec = spawnSpec(cmd);
			const result = spawnSync(spec.file, spec.args, {
				encoding: "utf8",
				windowsVerbatimArguments: spec.windowsVerbatimArguments,
			});
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /ZETA-SHIM serve/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	},
);

test("tier 3 dev: repo dist binary, then bun-run source, then the bare launcher", () => {
	const repoRoot = path.join(os.tmpdir(), "zeta-serve-res-virtual-repo");
	const deps = {
		...makeDeps().deps,
		dirname: path.join(repoRoot, "desktop", "dist"),
		readTextFile: candidate => (candidate === path.join(repoRoot, "package.json") ? '{"workspaces":[]}' : null),
	};

	const withDist = resolveServeCommandIn({
		...deps,
		exists: candidate => candidate === path.join(repoRoot, "packages", "coding-agent", "dist", "zeta"),
	});
	assert.equal(withDist.file, path.join(repoRoot, "packages", "coding-agent", "dist", "zeta"));
	assert.equal(withDist.cwd, repoRoot);

	const withSrc = resolveServeCommandIn({
		...deps,
		exists: candidate => candidate === path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts"),
	});
	assert.equal(withSrc.file, "bun");
	assert.deepEqual(withSrc.args, [path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts"), "serve"]);

	const bare = resolveServeCommandIn({ ...deps, exists: () => false });
	assert.deepEqual([bare.file, bare.args[0]], ["zetacode", "serve"]);
});

test("repo-root walk finds the monorepo manifest", () => {
	const tree = makeDeps();
	try {
		const repoRoot = path.join(tree.root, "repo");
		fs.mkdirSync(path.join(repoRoot, "desktop", "dist"), { recursive: true });
		fs.writeFileSync(path.join(repoRoot, "package.json"), '{"name":"zeta"}');
		assert.equal(findRepoRootIn({ ...tree.deps, dirname: path.join(repoRoot, "desktop", "dist") }), repoRoot);
	} finally {
		cleanup(tree);
	}
});
