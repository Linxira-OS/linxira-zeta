import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type } from "@linxiraos/pi-omptype";
import { loadCustomCommands } from "../../../src/extensibility/custom-commands/loader";
import type { CustomCommandsLoadResult } from "../../../src/extensibility/custom-commands/types";

let tempRoot: string | undefined;

afterEach(async () => {
	if (tempRoot) {
		await fs.rm(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

describe("custom command loader", () => {
	it("supports legacy and callable ArkType injection", async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-custom-command-loader-"));
		const commandDir = path.join(tempRoot, "commands", "arktype-compat");
		await fs.mkdir(commandDir, { recursive: true });
		const commandPath = path.join(commandDir, "index.js");
		await Bun.write(
			commandPath,
			[
				"export default api => {",
				'\tconst legacy = api.arktype.type("string");',
				'\tconst current = api.arktype("string");',
				'\tif (legacy("ok") !== "ok" || current("ok") !== "ok") throw new Error("ArkType schema failed");',
				"\treturn {",
				'\t\tname: "arktype-compat",',
				'\t\tdescription: "Checks both ArkType injection forms",',
				"\t\texecute() {},",
				"\t};",
				"};",
			].join("\n"),
		);

		const result = await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot });

		expect(result.errors.find(error => error.path === commandPath)).toBeUndefined();
		expect(result.commands.map(({ command }) => command.name)).toContain("arktype-compat");

		expect((type as typeof type & { type?: typeof type }).type).toBeUndefined();
		expect(Object.prototype.propertyIsEnumerable.call(type, "type")).toBeFalse();
	});

	it("re-evaluates an edited command module on the next load", async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-custom-command-reload-"));
		const commandDir = path.join(tempRoot, "commands", "live-edit");
		await fs.mkdir(commandDir, { recursive: true });
		const commandPath = path.join(commandDir, "index.js");
		const source = (description: string): string =>
			[
				"export default () => ({",
				'\tname: "live-edit",',
				`\tdescription: ${JSON.stringify(description)},`,
				"\texecute() {},",
				"});",
			].join("\n");
		const descriptionOf = (result: CustomCommandsLoadResult): string | undefined =>
			result.commands.find(({ command }) => command.name === "live-edit")?.command.description;

		await Bun.write(commandPath, source("first description"));
		expect(descriptionOf(await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot }))).toBe("first description");

		// The two bodies differ in length, so the cache-busting tag differs even
		// when both writes land inside one filesystem timestamp tick.
		await Bun.write(commandPath, source("second description, longer"));
		expect(descriptionOf(await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot }))).toBe(
			"second description, longer",
		);
	});
});
