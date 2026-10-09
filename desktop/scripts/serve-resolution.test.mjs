import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	SERVE_BIN_DIR_ENV,
	SERVE_BIN_NAMES,
	bundledServeCommandIn,
	findRepoRootIn,
	parseCommand,
	resolveServeCommandIn,
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
		probePath: () => false,
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
		probePath: () => true,
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
	const tree = makeDeps({ platform: process.platform, probePath: () => true });
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

test("tier 2: the PATH probe wins over the packaged bundle; bare zeta never probed", () => {
	const tree = makeDeps({ isPackaged: true });
	try {
		const serviceDir = installBundle(tree);
		const probed = [];
		const cmd = resolveServeCommandIn({
			...tree.deps,
			probePath: name => {
				probed.push(name);
				return name === "zeta-c";
			},
		});
		// Canonical-first: the loop probes `zetacode` before its aliases and
		// stops at the first serving-capable hit; the workbench bin is never
		// probed at all.
		assert.deepEqual(probed, ["zetacode", "zeta-c"]);
		assert.ok(!probed.includes("zeta"), "workbench bin must never be a serve candidate");
		assert.equal(cmd.file, "zeta-c");
		assert.equal(cmd.args[0], "serve");
		assert.ok(!JSON.stringify(cmd).includes(serviceDir), "bundle must be skipped on the PATH hit");
	} finally {
		cleanup(tree);
	}
});

test("tier 3: packaged desktop with no PATH hit uses its vendored bundle", () => {
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
