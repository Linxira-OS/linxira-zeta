import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import { lookup } from "@linxiraos/zeta/config/registry";
import { handleSettingsRawGet, handleSettingsRawPut } from "@linxiraos/zeta/server/web-gateway/settings";

/**
 * Raw settings editor contract.
 *
 * The gateway owns the writer: invalid YAML is rejected before any write,
 * a valid save is atomic and leaves the previous file as `.bak`, and a project
 * layer still shadows the global layer in the effective settings.
 */

let root: string;
let cwd: string;
let agentDir: string;

function projectConfig(): string {
	return path.join(cwd, ".zeta", "config.yml");
}

function request(method: "GET" | "PUT", body?: unknown): Request {
	return new Request(`http://test/api/settings/raw?scope=project`, {
		method,
		headers: { "content-type": "application/json", "x-zeta-cwd": cwd },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "zeta-raw-config-"));
	cwd = path.join(root, "project");
	agentDir = path.join(root, "agent");
	fs.mkdirSync(cwd, { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
});

afterEach(async () => {
	// Windows may still hold the watched config dir for a moment; cleanup must
	// not turn a passing contract test into a failure.
	try {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	} catch {
		/* best-effort temp cleanup */
	}
});

describe("settings raw config", () => {
	it("rejects invalid YAML without writing anything", async () => {
		const response = await handleSettingsRawPut(request("PUT", { scope: "project", contents: "plan: [unclosed" }));
		expect(response.status).toBe(400);
		expect(fs.existsSync(projectConfig())).toBe(false);
	});

	it("writes atomically and keeps the previous file as .bak", async () => {
		const first = "plan:\n  autosave: false\n";
		const second = "plan:\n  autosave: true\n";
		expect((await handleSettingsRawPut(request("PUT", { scope: "project", contents: first }))).status).toBe(200);
		expect(fs.readFileSync(projectConfig(), "utf8")).toBe(first);

		expect((await handleSettingsRawPut(request("PUT", { scope: "project", contents: second }))).status).toBe(200);
		expect(fs.readFileSync(projectConfig(), "utf8")).toBe(second);
		expect(fs.readFileSync(`${projectConfig()}.bak`, "utf8")).toBe(first);
		// No temp sibling survives a completed write.
		expect(fs.readdirSync(path.dirname(projectConfig())).some(name => name.endsWith(".tmp"))).toBe(false);
	});

	it("serves the layer path and contents back to the editor", async () => {
		const contents = "plan:\n  autosave: true\n";
		await handleSettingsRawPut(request("PUT", { scope: "project", contents }));
		const response = await handleSettingsRawGet(request("GET"));
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { path: string; contents: string; precedence: string[] };
		expect(payload.path).toBe(projectConfig());
		expect(payload.contents).toBe(contents);
		expect(payload.precedence[0]).toBe("runtime");
		expect(payload.precedence.at(-1)).toBe("default");
	});

	it("keeps project precedence over global in effective settings", async () => {
		fs.mkdirSync(path.dirname(projectConfig()), { recursive: true });
		fs.writeFileSync(projectConfig(), "plan:\n  autosave: true\n");
		fs.writeFileSync(path.join(agentDir, "config.yml"), "plan:\n  autosave: false\n");
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		expect(lookup("plan.autosave")?.get(settings)).toBe(true);
		settings.stopWatching();
	});
});
