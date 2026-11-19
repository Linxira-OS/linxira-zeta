import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type } from "@linxiraos/zeta-schema";
import { discoverCustomCommands, loadCustomCommands } from "../../../src/extensibility/custom-commands/loader";
import type { CustomCommandsLoadResult } from "../../../src/extensibility/custom-commands/types";
import { SYMLINKS_USABLE } from "../../helpers/symlink-support";

let tempRoot: string | undefined;

afterEach(async () => {
	if (tempRoot) {
		await fs.rm(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

function commandSource(name: string, description: string): string {
	return `export default () => ({ name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)}, execute() {} });`;
}

async function makeCommandsRoot(prefix: string): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	await fs.mkdir(path.join(root, "commands"), { recursive: true });
	return root;
}

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

	it("accepts a template-only command and rejects a command with neither execute nor template", async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-custom-command-template-"));
		const validDir = path.join(tempRoot, "commands", "template-only");
		const invalidDir = path.join(tempRoot, "commands", "inert");
		await fs.mkdir(validDir, { recursive: true });
		await fs.mkdir(invalidDir, { recursive: true });
		const validPath = path.join(validDir, "index.js");
		const invalidPath = path.join(invalidDir, "index.js");
		await Bun.write(
			validPath,
			[
				"export default () => ({",
				'\tname: "template-only",',
				'\tdescription: "Runs a template",',
				'\tagent: "reviewer",',
				'\tmodel: "anthropic/claude-sonnet-4-5",',
				'\ttemplate: "Review $ARGUMENTS",',
				"});",
			].join("\n"),
		);
		await Bun.write(
			invalidPath,
			["export default () => ({", '\tname: "inert",', '\tdescription: "No handler",', "});"].join("\n"),
		);

		const result = await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot });

		const templateOnly = result.commands.find(({ command }) => command.name === "template-only")?.command;
		expect(templateOnly).toBeDefined();
		expect(templateOnly?.agent).toBe("reviewer");
		expect(templateOnly?.model).toBe("anthropic/claude-sonnet-4-5");
		expect(templateOnly?.template).toBe("Review $ARGUMENTS");
		expect(result.errors.find(error => error.path === invalidPath)?.error).toContain("execute function or template");
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
		const descriptionOf = (result: CustomCommandsLoadResult): string | undefined => {
			const description = result.commands.find(({ command }) => command.name === "live-edit")?.command.description;
			return typeof description === "function" ? description() : description;
		};

		await Bun.write(commandPath, source("first description"));
		expect(descriptionOf(await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot }))).toBe("first description");

		// The two bodies differ in length, so the cache-busting tag differs even
		// when both writes land inside one filesystem timestamp tick.
		await Bun.write(commandPath, source("second description, longer"));
		expect(descriptionOf(await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot }))).toBe(
			"second description, longer",
		);
	});

	// Sharing one command package between checkouts is done by linking it into the commands
	// dir. `readdir(withFileTypes)` reports that entry as a link rather than a directory, so
	// before the fix discovery dropped the link with no path and no warning.
	it.skipIf(!SYMLINKS_USABLE)("loads a command package linked into the commands dir", async () => {
		tempRoot = await makeCommandsRoot("zeta-custom-command-symlink-");
		const commandsDir = path.join(tempRoot, "commands");
		const shared = path.join(tempRoot, "shared", "linked-cmd");
		const linkedDir = path.join(commandsDir, "linked-cmd");
		await fs.mkdir(shared, { recursive: true });
		await Bun.write(path.join(shared, "index.js"), commandSource("linked-cmd", "Linked shared package"));
		await fs.symlink(shared, linkedDir, "dir");

		const discovered = await discoverCustomCommands({ cwd: tempRoot, agentDir: tempRoot });
		expect(discovered.paths.map(({ path: commandPath }) => commandPath)).toContain(path.join(linkedDir, "index.js"));

		const result = await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot });
		expect(result.commands.find(({ command }) => command.name === "linked-cmd")?.command.description).toBe(
			"Linked shared package",
		);
	});

	// The fix accepts a link so the index.* probe can look through it. A link to a file has
	// no index.* inside, so it must stay rejected rather than turning every link into a
	// candidate.
	it.skipIf(!SYMLINKS_USABLE)("rejects a commands dir entry linked to a file", async () => {
		tempRoot = await makeCommandsRoot("zeta-custom-command-file-link-");
		const commandsDir = path.join(tempRoot, "commands");
		const sharedFile = path.join(tempRoot, "shared-command.js");
		await Bun.write(sharedFile, commandSource("file-link", "Link to a file, not a package"));
		await fs.symlink(sharedFile, path.join(commandsDir, "file-link"), "file");

		const discovered = await discoverCustomCommands({ cwd: tempRoot, agentDir: tempRoot });
		expect(discovered.paths).toHaveLength(0);

		const result = await loadCustomCommands({ cwd: tempRoot, agentDir: tempRoot });
		expect(result.commands.map(({ command }) => command.name)).not.toContain("file-link");
	});
});
