import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
	classifyDroppedPath,
	findWorkspace,
	firstEditorTarget,
	isPathWithin,
	resolveWorkspaceFile,
	workspaceIdFor,
} from "../dist/workspace-actions.js";

const KEY = "C:/repo";
const WORKSPACE_ID = "ws-a85ddcfc9bd6c975";

test("workspaceIdFor matches the Studio host id formula", () => {
	// packages/coding-agent/src/server/studio-host/ops/workspace.ts is the producer.
	assert.equal(workspaceIdFor(KEY), WORKSPACE_ID);
	assert.equal(workspaceIdFor("/home/u/project"), "ws-7e7fde0aadd4721c");
});

test("findWorkspace reads the gateway project inventory", () => {
	const payload = {
		projects: [
			{ workspaces: "junk" },
			{ workspaces: [{ key: KEY, path: "C:/repo", name: "repo" }] },
			{ workspaces: [{ key: "relative", path: "relative/dir" }] },
		],
	};
	assert.deepEqual(findWorkspace(payload, WORKSPACE_ID), { workspaceId: WORKSPACE_ID, path: "C:/repo", name: "repo" });
	assert.equal(findWorkspace(payload, "ws-unknown"), null);
	assert.equal(findWorkspace(null, WORKSPACE_ID), null);
	assert.equal(findWorkspace({ projects: "junk" }, WORKSPACE_ID), null);
});

test("resolveWorkspaceFile keeps reads inside the workspace", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-ws-actions-"));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-ws-outside-"));
	try {
		fs.mkdirSync(path.join(root, "src"));
		fs.writeFileSync(path.join(root, "src", "a.ts"), "x");
		fs.writeFileSync(path.join(outside, "b.ts"), "x");
		const realpath = fs.realpathSync.native;
		assert.equal(resolveWorkspaceFile(root, "src/a.ts", realpath), realpath(path.join(root, "src", "a.ts")));
		assert.equal(resolveWorkspaceFile(root, "../b.ts", realpath), null);
		assert.equal(resolveWorkspaceFile(root, "/etc/passwd", realpath), null);
		assert.equal(resolveWorkspaceFile(root, "C:/windows/system32", realpath), null);
		assert.equal(resolveWorkspaceFile(root, "src/missing.ts", realpath), null);
		assert.equal(resolveWorkspaceFile(root, "", realpath), null);
		assert.equal(resolveWorkspaceFile(root, "src/../src/a.ts", realpath), null);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("isPathWithin rejects siblings and parents", () => {
	const root = path.resolve("work", "repo");
	assert.equal(isPathWithin(root, root), true);
	assert.equal(isPathWithin(root, path.join(root, "src", "a.ts")), true);
	assert.equal(isPathWithin(root, path.resolve("work", "repo-other", "a.ts")), false);
	assert.equal(isPathWithin(root, path.resolve("work", "a.ts")), false);
});

test("classifyDroppedPath separates workspace-relative and absolute drops", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-ws-drop-"));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-ws-drop-out-"));
	try {
		fs.mkdirSync(path.join(root, "src"));
		fs.writeFileSync(path.join(root, "src", "a.ts"), "x");
		fs.writeFileSync(path.join(root, "icon.png"), "png");
		fs.writeFileSync(path.join(outside, "b.ts"), "x");
		const stat = target => fs.statSync(target);
		const realpath = fs.realpathSync.native;

		assert.deepEqual(classifyDroppedPath(root, path.join(root, "src", "a.ts"), stat, realpath), {
			ok: true,
			kind: "file",
			scope: "workspace",
			path: "src/a.ts",
			name: "a.ts",
		});
		assert.deepEqual(classifyDroppedPath(root, path.join(root, "icon.png"), stat, realpath), {
			ok: true,
			kind: "image",
			scope: "workspace",
			path: "icon.png",
			name: "icon.png",
		});
		assert.deepEqual(classifyDroppedPath(root, path.join(root, "src"), stat, realpath), {
			ok: true,
			kind: "dir",
			scope: "workspace",
			path: "src",
			name: "src",
		});
		assert.deepEqual(classifyDroppedPath(root, path.join(outside, "b.ts"), stat, realpath), {
			ok: true,
			kind: "file",
			scope: "absolute",
			path: path.join(outside, "b.ts"),
			name: "b.ts",
		});
		assert.deepEqual(classifyDroppedPath(root, path.join(outside, "missing.ts"), stat, realpath), {
			ok: false,
			reason: "missing",
		});
		assert.deepEqual(classifyDroppedPath(root, "relative/dir", stat, realpath), { ok: false, reason: "invalid" });
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("firstEditorTarget picks an installed editor, not the file manager", () => {
	assert.equal(
		firstEditorTarget([{ id: "file-manager" }, { id: "editor:vscode" }, { id: "editor:cursor" }]),
		"editor:vscode",
	);
	assert.equal(firstEditorTarget([{ id: "file-manager" }]), null);
	assert.equal(firstEditorTarget([]), null);
});
