import { describe, expect, it, spyOn } from "bun:test";
import {
	type CliConfig,
	type CommandCtor,
	type CommandMetadata,
	renderCommandHelp,
	renderRootHelp,
} from "@linxiraos/pi-utils/cli";
import { commands } from "../src/cli-commands";

function captureStdout(render: () => void): string {
	const chunks: string[] = [];
	const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(chunk => {
		chunks.push(String(chunk));
		return true;
	});
	try {
		render();
	} finally {
		stdoutSpy.mockRestore();
	}
	return chunks.join("");
}

describe("CLI command help metadata", () => {
	it("registers every command the CLI reference documents as a subcommand", () => {
		// `zetacode attach` is the plain-terminal client for a serve session and
		// `zetacode attach --list` is the documented way to address one. The
		// command class existed without a table entry, so the flag parse fell
		// through to `launch` and the documented surface disappeared.
		expect(commands.map(entry => entry.name)).toContain("attach");
	});

	it("renders the same root help as the loaded command classes", async () => {
		const metadata = new Map<string, CommandMetadata>();
		const constructors = new Map<string, CommandCtor>();
		for (const entry of commands) {
			expect(entry.help, `${entry.name} must provide static help metadata`).toBeDefined();
			if (!entry.help) continue;
			metadata.set(entry.name, entry.help);
			constructors.set(entry.name, await entry.load());
		}

		const base = { bin: "zetacode", version: "test" };
		const metadataConfig: CliConfig<CommandMetadata> = { ...base, commands: metadata };
		const constructorConfig: CliConfig = { ...base, commands: constructors };
		const metadataRoot = captureStdout(() => renderRootHelp(metadataConfig));
		const constructorRoot = captureStdout(() => renderRootHelp(constructorConfig));
		expect(metadataRoot).toBe(constructorRoot);

		const visibleNames = commands.filter(entry => !entry.help?.hidden).map(entry => entry.name);
		const maxNameLength = Math.max(...visibleNames.map(name => name.length));
		for (const name of visibleNames) {
			const Command = constructors.get(name);
			if (!Command) throw new Error(`Missing loaded command: ${name}`);
			const commandOutput = captureStdout(() => renderCommandHelp("omp", name, Command));
			const description = commandOutput.split("\n", 1)[0];
			expect(metadataRoot).toContain(`  ${name.padEnd(maxNameLength + 2)}${description}`);
		}
	});
});
