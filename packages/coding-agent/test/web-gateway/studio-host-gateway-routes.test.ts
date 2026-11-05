/**
 * Gateway routes added for the Studio host cutover.
 *
 * Three contract changes ride here, each with a failure mode worth pinning:
 *
 * - `GET /api/settings/values` reads ANY registered setting, including rows the
 *   panel hides (`disabledProviders`, `cycleOrder`). Without it a caller that
 *   composes state instead of rendering it can only guess, and a one-element
 *   write would silently drop the rest of a deny-list.
 * - `PUT /api/settings` accepts a registered setting that has no `ui` metadata.
 *   `ui` decides what the panel lists, not what an authenticated caller may
 *   write; the panel gate used to reject the model provider toggles.
 * - `POST /api/skills/reveal` opens ONE skill folder in the OS file manager.
 *   The client never sends a path, so every refusal here is the route's only
 *   defence against being turned into "open any path".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refreshDirsFromEnv, TempDir } from "@linxiraos/pi-utils";
import { resetSettingsForTest } from "@linxiraos/zeta/config/settings";
import { handleSkillsReveal } from "../../src/server/web-gateway/skills";
import { handleSettingsPut, handleSettingsValuesGet } from "../../src/server/web-gateway/settings";

let agentDir: TempDir;
let previousAgentDir: string | undefined;
let projectDir: string;

beforeEach(() => {
	agentDir = TempDir.createSync("@zeta-studio-gateway-routes-");
	previousAgentDir = process.env.ZETA_CODING_AGENT_DIR;
	process.env.ZETA_CODING_AGENT_DIR = agentDir.path();
	refreshDirsFromEnv();
	resetSettingsForTest();
	projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-reveal-project-"));
});

afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.ZETA_CODING_AGENT_DIR;
	else process.env.ZETA_CODING_AGENT_DIR = previousAgentDir;
	refreshDirsFromEnv();
	resetSettingsForTest();
	fs.rmSync(projectDir, { recursive: true, force: true });
});

function valuesRequest(query: string): Request {
	return new Request(`http://127.0.0.1:43143/api/settings/values?${query}`);
}

describe("GET /api/settings/values", () => {
	test("reads a registered setting whether or not it has ui metadata", async () => {
		const response = await handleSettingsValuesGet(
			valuesRequest("path=editor.autoInstall&path=disabledProviders&path=cycleOrder"),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { values: Record<string, unknown> };
		expect(typeof body.values["editor.autoInstall"]).toBe("boolean");
		// `disabledProviders` and `cycleOrder` are registered with no `ui` block:
		// they are exactly the rows the panel payload cannot carry.
		expect(Array.isArray(body.values["disabledProviders"])).toBe(true);
		expect(Array.isArray(body.values["cycleOrder"])).toBe(true);
	});

	test("unknown paths answer null instead of failing the whole read", async () => {
		const response = await handleSettingsValuesGet(valuesRequest("path=not.a.setting"));
		const body = (await response.json()) as { values: Record<string, unknown> };
		expect(body.values["not.a.setting"]).toBeNull();
	});

	test("requires at least one path", async () => {
		expect((await handleSettingsValuesGet(valuesRequest(""))).status).toBe(400);
	});
});

describe("PUT /api/settings without ui metadata", () => {
	test("writes a registered value the panel does not list", async () => {
		const before = await handleSettingsValuesGet(valuesRequest("path=disabledProviders"));
		const beforeBody = (await before.json()) as { values: Record<string, string[]> };
		const next = [...beforeBody.values["disabledProviders"]!, "some-provider"];
		const put = await handleSettingsPut(
			new Request("http://127.0.0.1:43143/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "disabledProviders", value: next }),
			}),
		);
		expect(put.status).toBe(200);
		const after = await handleSettingsValuesGet(valuesRequest("path=disabledProviders"));
		const afterBody = (await after.json()) as { values: Record<string, string[]> };
		expect(afterBody.values["disabledProviders"]).toContain("some-provider");
	});

	test("still refuses an unknown path", async () => {
		const put = await handleSettingsPut(
			new Request("http://127.0.0.1:43143/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "not.a.setting", value: true }),
			}),
		);
		expect(put.status).toBe(400);
	});
});

describe("POST /api/skills/reveal", () => {
	function reveal(body: Record<string, unknown>): Promise<Response> {
		return handleSkillsReveal(
			new Request("http://127.0.0.1:43143/api/skills/reveal", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	}

	test("requires a real project directory", async () => {
		expect((await reveal({})).status).toBe(400);
		expect((await reveal({ cwd: projectDir })).status).toBe(400);
		expect((await reveal({ cwd: path.join(projectDir, "missing"), name: "x" })).status).toBe(403);
	});

	test("never opens a name that is not in the skill scan", async () => {
		// The route resolves the folder from the scan, so a bogus name cannot
		// smuggle a path in through `name`.
		const response = await reveal({ cwd: projectDir, name: "../../etc" });
		expect(response.status).toBe(404);
	});

	test("a missing skill root is a miss, not an opener call", async () => {
		const response = await reveal({ cwd: projectDir, root: true });
		expect(response.status).toBe(404);
	});
});
