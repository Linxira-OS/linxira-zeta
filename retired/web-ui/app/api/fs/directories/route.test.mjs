import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { GET, POST } = await jiti.import("./route.ts");

function makeTree() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-fs-route-"));
	fs.mkdirSync(path.join(root, "beta"));
	fs.mkdirSync(path.join(root, "Alpha"));
	fs.mkdirSync(path.join(root, "$RECYCLE.BIN"));
	fs.writeFileSync(path.join(root, "notes.txt"), "not a directory");
	return root;
}

function getRequest(targetPath) {
	return new Request(
		`http://127.0.0.1/api/fs/directories?path=${encodeURIComponent(targetPath)}`,
	);
}

test("GET lists only subdirectories, naturally sorted, recycling bin skipped", async () => {
	const root = makeTree();
	try {
		const res = await GET(getRequest(root));
		assert.equal(res.status, 200);
		const data = await res.json();
		assert.equal(data.currentPath, root);
		assert.equal(data.parentPath, path.dirname(root));
		assert.deepEqual(
			data.directories.map(d => d.name),
			["Alpha", "beta"],
		);
		// Every entry must carry an absolute path so the picker can navigate.
		for (const dir of data.directories) {
			assert.ok(path.isAbsolute(dir.path));
			assert.equal(typeof dir.modified, "string");
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("GET on a missing directory answers 404 with the path in the error", async () => {
	const missing = path.join(os.tmpdir(), "zeta-fs-route-does-not-exist");
	const res = await GET(getRequest(missing));
	assert.equal(res.status, 404);
	const data = await res.json();
	assert.match(data.error, /Directory does not exist/);
	assert.ok(data.error.includes(missing));
});

test("GET on a file answers 400, not a crash", async () => {
	const root = makeTree();
	try {
		const res = await GET(getRequest(path.join(root, "notes.txt")));
		assert.equal(res.status, 400);
		assert.match((await res.json()).error, /not a directory/i);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("POST creates the folder on disk and returns its path", async () => {
	const root = makeTree();
	try {
		const res = await POST(
			new Request("http://127.0.0.1/api/fs/directories", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ parentPath: root, folderName: "workspace-new" }),
			}),
		);
		assert.equal(res.status, 200);
		const data = await res.json();
		assert.equal(data.success, true);
		assert.equal(data.path, path.join(root, "workspace-new"));
		assert.ok(fs.statSync(data.path).isDirectory(), "folder must exist on disk");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("POST on an existing folder name answers 409 without touching it", async () => {
	const root = makeTree();
	try {
		const res = await POST(
			new Request("http://127.0.0.1/api/fs/directories", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ parentPath: root, folderName: "beta" }),
			}),
		);
		assert.equal(res.status, 409);
		assert.match((await res.json()).error, /already exists/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("POST without a folder name answers 400", async () => {
	const root = makeTree();
	try {
		const res = await POST(
			new Request("http://127.0.0.1/api/fs/directories", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ parentPath: root, folderName: "   " }),
			}),
		);
		assert.equal(res.status, 400);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
