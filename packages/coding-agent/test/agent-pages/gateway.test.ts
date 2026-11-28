/**
 * `/api/agent-pages` gateway routes.
 *
 * Pins the HTTP contract: inventory and one manifest, a page-owned static
 * asset served only from inside the page root, and a workflow run that returns
 * explicit codes for unknown pages/workflows, cycles, permission denials, and
 * cancellation. The route table itself lives in `server/web-gateway.ts`; these
 * tests call `webGatewayFetch`, so the normal auth/origin/scope gate runs too.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { webGatewayFetch } from "../../src/server/web-gateway";

let root: string;
let previousRoot: string | undefined;

const DEMO_MANIFEST = {
	schema: "agent-page/1",
	id: "demo",
	name: "Demo",
	entry: "index.html",
	permissions: { read: ["data/"], network: ["api.example.test"] },
	workflows: [
		{
			id: "hello",
			steps: [
				{ id: "seed", kind: "constant", value: "world" },
				{ id: "message", kind: "template", template: "hello {{name}}", inputs: { name: "seed" } },
			],
		},
		{
			id: "cycle",
			steps: [
				{ id: "a", kind: "constant", value: 1, dependsOn: ["b"] },
				{ id: "b", kind: "constant", value: 2, dependsOn: ["a"] },
			],
		},
	],
};

async function writePage(id: string, manifest: unknown, files: Record<string, string>): Promise<void> {
	const pageRoot = join(root, id);
	await mkdir(pageRoot, { recursive: true });
	await writeFile(join(pageRoot, "page.json"), JSON.stringify(manifest, null, 2));
	for (const [relative, content] of Object.entries(files)) {
		const file = join(pageRoot, relative);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
	}
}

function gateway(pathname: string, init?: RequestInit): Promise<Response> {
	return webGatewayFetch(new Request(`http://127.0.0.1${pathname}`, init), "127.0.0.1");
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "zeta-agent-pages-gateway-"));
	previousRoot = process.env.ZETA_AGENT_PAGES_DIR;
	process.env.ZETA_AGENT_PAGES_DIR = root;
	await writePage("demo", DEMO_MANIFEST, {
		"index.html": "<!doctype html><h1>Demo</h1>",
		"data/input.txt": "inside",
	});
	await writePage(
		"locked",
		{
			schema: "agent-page/1",
			id: "locked",
			name: "Locked",
			entry: "index.html",
			permissions: {},
			workflows: [{ id: "read", steps: [{ id: "input", kind: "read", path: "data/input.txt" }] }],
		},
		{ "index.html": "<!doctype html><h1>Locked</h1>" },
	);
	await writePage(
		"broken",
		{
			schema: "agent-page/1",
			id: "broken",
			name: "Broken",
			entry: "../outside.html",
			permissions: {},
			workflows: [],
		},
		{},
	);
	await writeFile(join(root, "outside.txt"), "OUTSIDE_MARKER");
});

afterAll(async () => {
	if (previousRoot === undefined) delete process.env.ZETA_AGENT_PAGES_DIR;
	else process.env.ZETA_AGENT_PAGES_DIR = previousRoot;
	await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
});

describe("GET /api/agent-pages", () => {
	test("lists loadable manifests with entry URLs and warning rows", async () => {
		const response = await gateway("/api/agent-pages");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			pages: Array<{ id: string; entryUrl: string }>;
			warnings: Array<{ id: string; error: string }>;
		};
		expect(body.pages.map(page => page.id)).toEqual(["demo", "locked"]);
		expect(body.pages.find(page => page.id === "demo")?.entryUrl).toBe("/api/agent-pages/demo/assets/index.html");
		expect(body.warnings.some(warning => warning.id === "broken")).toBe(true);
	});

	test("returns one manifest and a 404 for an unknown or traversing id", async () => {
		const response = await gateway("/api/agent-pages/demo");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			page: { id: string; name: string; permissions: { read: string[] }; entryUrl: string };
		};
		expect(body.page).toMatchObject({ id: "demo", name: "Demo", permissions: { read: ["data/"] } });
		expect(body.page.entryUrl).toBe("/api/agent-pages/demo/assets/index.html");

		const missing = await gateway("/api/agent-pages/missing");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ code: "unknown_page" });

		const escaping = await gateway("/api/agent-pages/..%2Foutside");
		expect(escaping.status).toBe(404);
	});
});

describe("page assets", () => {
	test("serves the declared entry from inside the page root", async () => {
		const response = await gateway("/api/agent-pages/demo/assets/index.html");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await response.text()).toContain("<h1>Demo</h1>");
	});

	test("rejects traversing and encoded-separator asset paths", async () => {
		for (const pathname of [
			"/api/agent-pages/demo/assets/..%2Foutside.txt",
			"/api/agent-pages/demo/assets/%2e%2e/outside.txt",
			"/api/agent-pages/demo/assets/%2e%2e%2foutside.txt",
		]) {
			const response = await gateway(pathname);
			expect(response.status).not.toBe(200);
			expect(await response.text()).not.toContain("OUTSIDE_MARKER");
		}
	});
});

describe("POST workflow run", () => {
	function run(workflowId: string, body: unknown = {}): Promise<Response> {
		return gateway(`/api/agent-pages/demo/workflows/${workflowId}/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("runs a two-step DAG and returns typed outputs in order", async () => {
		const response = await run("hello", { concurrency: 2 });
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			workflowId: string;
			order: string[];
			outputs: Record<string, { stepId: string; type: string; value: unknown }>;
		};
		expect(body.workflowId).toBe("hello");
		expect(body.order).toEqual(["seed", "message"]);
		expect(body.outputs.message).toEqual({ stepId: "message", type: "text", value: "hello world" });
	});

	test("reports unknown pages, unknown workflows, cycles, and permission denials", async () => {
		const missingPage = await gateway("/api/agent-pages/missing/workflows/hello/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(missingPage.status).toBe(404);
		expect(await missingPage.json()).toMatchObject({ code: "unknown_page" });

		const missingWorkflow = await run("missing");
		expect(missingWorkflow.status).toBe(404);
		expect(await missingWorkflow.json()).toMatchObject({ code: "unknown_workflow" });

		const cycle = await run("cycle");
		expect(cycle.status).toBe(409);
		expect(await cycle.json()).toMatchObject({ code: "cycle" });

		const denied = await gateway("/api/agent-pages/locked/workflows/read/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(denied.status).toBe(403);
		expect(await denied.json()).toMatchObject({ code: "permission_denied" });
	});

	test("rejects a bad concurrency body before running", async () => {
		const response = await run("hello", { concurrency: 0 });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "invalid_request" });
	});

	test("reports cancellation from the request signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const response = await gateway("/api/agent-pages/demo/workflows/hello/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
			signal: controller.signal,
		});
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: "cancelled" });
	});
});
