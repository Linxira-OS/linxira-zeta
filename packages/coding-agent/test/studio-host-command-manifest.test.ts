import { afterEach, expect, test } from "bun:test";
import { Settings } from "../src/config/settings";
import { currentLanguage, setLanguage } from "../src/i18n";
import { buildBootstrap } from "../src/server/studio-host/bootstrap";
import { buildOperatorCommandManifest } from "../src/server/studio-host/command-manifest";
import { StudioOperations } from "../src/server/studio-host/registry";
import { parseOperatorCommandManifest } from "../src/server/studio-host/protocol/validation";

const language = currentLanguage();
afterEach(() => setLanguage(language));

test("command catalog exposes text execution, preserves terminal mappings and hides retired commands", async () => {
	const operations = new StudioOperations();
	const response = await operations.query(
		{ queryName: "commands.getManifest", input: {} },
		{ capabilities: operations.capabilities().manifest },
	);
	expect(response.ok).toBe(true);
	if (!response.ok) throw new Error(response.error.message);
	const manifest = parseOperatorCommandManifest(response.result);
	const command = (name: string) => manifest.commands.find(entry => entry.name === name);
	expect(command("compact")).toMatchObject({
		id: "builtin.compact",
		implementation: "headless-handle",
		presentation: "generic-form",
		availability: "available",
	});
	expect(command("model")).toMatchObject({ aliases: ["models"] });
	expect(command("quit")).toMatchObject({ implementation: "tui-compatibility", presentation: "terminal" });
	for (const name of ["2fa", "channels"]) {
		expect(command(name)).toMatchObject({
			implementation: "tui-compatibility",
			presentation: "terminal",
			risk: "sensitive",
			effect: "process",
		});
	}
	expect(command("setup")).toBeUndefined();
	expect(command("live")).toBeUndefined();
	// These commands contain destructive subcommands even when their bare form reads status.
	expect(command("session")).toMatchObject({ risk: "destructive", effect: "session" });
	expect(command("memory")).toMatchObject({ risk: "destructive", effect: "workspace" });
	expect(command("share")).toMatchObject({ risk: "sensitive", effect: "external" });
	expect(manifest.unclassifiedBuiltins).toEqual([]);
	expect(manifest.hash).toBe(buildBootstrap(operations).commandManifestHash);
});

test("command metadata follows language changes without unstable timestamps changing its hash", () => {
	const instance = Settings.isolated();
	setLanguage("en");
	const english = buildOperatorCommandManifest(instance);
	const repeated = buildOperatorCommandManifest(instance);
	setLanguage("zh");
	const chinese = buildOperatorCommandManifest(instance);
	const description = (manifest: typeof english) =>
		manifest.commands.find(entry => entry.name === "compact")!.description;
	expect(description(chinese)).not.toBe(description(english));
	expect(english.hash).toBe(repeated.hash);
	expect(chinese.hash).not.toBe(english.hash);
});
