import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { Terminal as VirtualTerminal } from "@linxiraos/pi-utils/vterm";

type Scenario = "auto" | "continue" | "resume" | "headless" | "restorable" | "override" | "unrelated-error";
interface Observation {
	error?: { name: string; message: string };
	providerRequests?: number;
	agentError?: unknown;
	session?: { id: string; model?: string; messages: unknown[]; cacheKey?: string; modelChanges?: string[] };
}

/** Run real CLI/SDK startup in a process whose config, leases and registries cannot escape the fixture. */
async function runScenario(scenario: Scenario): Promise<Observation> {
	using temp = TempDir.createSync("@omp-auto-resume-model-");
	const home = temp.join("home");
	const agentDir = path.join(home, ".zeta", "agent");
	const sourceDir = path.resolve(import.meta.dir, "../src");
	const extension = temp.join("provider.ts");
	await Bun.write(
		extension,
		`export default pi => pi.registerProvider("resume-fixture", {
			baseUrl: process.env.OMP_TEST_BASE_URL, api: "openai-completions", apiKey: "fixture-only",
			models: [{ id: "fresh", name: "Fresh", reasoning: false, input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072, maxTokens: 1024 }]
		});`,
	);
	const script = `
		const scenario = ${JSON.stringify(scenario)};
		import { parseArgs } from ${JSON.stringify(path.join(sourceDir, "cli/args.ts"))};
		import { runRootCommand } from ${JSON.stringify(path.join(sourceDir, "main.ts"))};
		import { createAgentSession } from ${JSON.stringify(path.join(sourceDir, "sdk.ts"))};
		import { Settings } from ${JSON.stringify(path.join(sourceDir, "config/settings.ts"))};
		import { AuthStorage } from ${JSON.stringify(path.join(sourceDir, "session/auth-storage.ts"))};
		import { SessionManager } from ${JSON.stringify(path.join(sourceDir, "session/session-manager.ts"))};
		const cwd = process.cwd();
		let providerRequests = 0;
		const providerServer = Bun.serve({
			hostname: "127.0.0.1", port: 0,
			fetch() {
				providerRequests++;
				const chunks = [
					{ id: "deadline-probe", choices: [{ index: 0, delta: { role: "assistant", content: "AFTER_DEADLINE_REPLY" }, finish_reason: null }] },
					{ id: "deadline-probe", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
				];
				return new Response(chunks.map(chunk => "data: " + JSON.stringify(chunk) + "\\n\\n").join("") + "data: [DONE]\\n\\n",
					{ headers: { "Content-Type": "text/event-stream" } });
			}
		});
		process.env.OMP_TEST_BASE_URL = providerServer.url.origin + "/v1";
		const readClock = Date.now;
		const savedModel = scenario === "restorable" ? "resume-fixture/fresh" : "lost/missing";
		const stamp = "2026-10-22T09:00:00+09:00";
		const file = SessionManager.getDefaultSessionDir(cwd) + "/saved.jsonl";
		const rows = [
			{ type: "session", version: 3, id: "saved-session", timestamp: stamp, cwd,
				providerPromptCacheKey: "OLD_CACHE_KEY" },
			{ type: "model_change", id: "model", parentId: null, timestamp: stamp,
				model: savedModel, role: "temporary" },
			{ type: "thinking_level_change", id: "thinking", parentId: "model", timestamp: stamp,
				thinkingLevel: "high" },
			{ type: "message", id: "user", parentId: "thinking", timestamp: stamp,
				message: { role: "user", content: "OLD_PRIVATE_HISTORY", timestamp: Date.parse(stamp) } },
			{ type: "message", id: "assistant", parentId: "user", timestamp: stamp,
				message: { role: "assistant", content: [{ type: "text", text: "OLD_PRIVATE_REPLY" }],
					provider: savedModel.split("/")[0], model: savedModel.split("/")[1],
					api: "openai-completions", stopReason: "stop", timestamp: Date.parse(stamp),
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }
		];
		await Bun.write(file, rows.map(row => JSON.stringify(row)).join("\\n") + "\\n");
		const args = ["--no-title", "--no-skills", "--no-rules", "--no-lsp",
			"--no-prewalk", "--trusted-extension", ${JSON.stringify(extension)}];
		if (scenario === "continue") args.push("-c");
		if (scenario === "resume") args.push("--resume", file);
		if (scenario === "headless") args.push("-p", "Continue.");
		if (scenario === "override") args.push("--model", "resume-fixture/fresh");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		const settings = Settings.isolated({
			autoResume: true, modelRoles: { default: "resume-fixture/fresh" },
			retry: { enabled: false, modelFallback: false }, compaction: { enabled: false },
			marketplace: { autoUpdate: "off" }
		});
		const authStorage = await AuthStorage.create(":memory:");
		const stop = new Error("fixture captured session before the mode runner");
		let observation = {};
		let manager;
		try {
			await runRootCommand(parseArgs(args), args, {
				settings, discoverAuthStorage: async () => authStorage,
				createAgentSession: async options => {
					manager = options.sessionManager;
					if (scenario === "unrelated-error") throw new Error("UNRELATED_STARTUP_FAILURE");
					const result = await createAgentSession(options);
					const session = result.session;
					try {
						observation.session = {
							id: session.sessionManager.getSessionId(),
							model: session.model && session.model.provider + "/" + session.model.id,
							messages: structuredClone(session.agent.state.messages),
							cacheKey: session.sessionManager.getHeader()?.providerPromptCacheKey,
							modelChanges: session.sessionManager
								.getBranch()
								.filter(entry => entry.type === "model_change")
								.map(entry => entry.model)
						};
					} finally {
						Date.now = readClock;
						await session.dispose();
					}
					throw stop;
				}
			});
		} catch (error) {
			if (error !== stop) observation.error = { name: error.name, message: error.message };
		} finally {
			Date.now = readClock;
			await manager?.close();
			authStorage.close();
			providerServer.stop(true);
		}
		observation.providerRequests = providerRequests;
		console.log("OBSERVATION_17043:" + JSON.stringify(observation));
		process.exit(0);
	`;
	const proc = Bun.spawn([process.execPath, "--eval", script], {
		cwd: temp.path(),
		env: {
			PATH: process.env.PATH,
			HOME: home,
			USERPROFILE: home,
			ZETA_CODING_AGENT_DIR: agentDir,
			TMPDIR: process.env.TMPDIR,
			TMP: process.env.TMP,
			TEMP: process.env.TEMP,
			SystemRoot: process.env.SystemRoot,
			WINDIR: process.env.WINDIR,
			TZ: "Asia/Tokyo",
			NO_COLOR: "1",
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		signal: AbortSignal.timeout(20_000),
	});
	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		if (exitCode !== 0) throw new Error(`Startup fixture exited ${exitCode}: ${stderr}\n${stdout}`);
		const result = stdout.split("\n").find(line => line.startsWith("OBSERVATION_17043:"));
		if (!result) throw new Error(`Startup fixture produced no observation: ${stderr}\n${stdout}`);
		return JSON.parse(result.slice("OBSERVATION_17043:".length)) as Observation;
	} finally {
		proc.kill();
		await proc.exited;
	}
}

describe("implicit auto-resume model restoration", () => {
	test("auto-resumes the saved transcript on the replacement model and records it", async () => {
		const result = await runScenario("auto");
		expect(result.error).toBeUndefined();
		expect(result.session?.model).toBe("resume-fixture/fresh");
		expect(result.session?.id).toBe("saved-session");
		expect(JSON.stringify(result.session?.messages)).toContain("OLD_PRIVATE_HISTORY");
		expect(result.session?.modelChanges).toContain("resume-fixture/fresh");
	}, 30_000);

	test.each(["continue", "resume", "headless"] as const)(
		"restores %s on the replacement model and records it",
		async scenario => {
			const result = await runScenario(scenario);
			expect(result.error).toBeUndefined();
			expect(result.session?.id).toBe("saved-session");
			expect(result.session?.model).toBe("resume-fixture/fresh");
			expect(JSON.stringify(result.session?.messages)).toContain("OLD_PRIVATE_HISTORY");
			expect(result.session?.modelChanges).toContain("resume-fixture/fresh");
		},
		30_000,
	);

	test.each(["restorable", "override"] as const)(
		"preserves the selected transcript for %s restoration",
		async scenario => {
			const result = await runScenario(scenario);
			expect(result.error).toBeUndefined();
			expect(result.session?.id).toBe("saved-session");
			expect(result.session?.model).toBe("resume-fixture/fresh");
			expect(JSON.stringify(result.session?.messages)).toContain("OLD_PRIVATE_HISTORY");
		},
		30_000,
	);

	test("does not treat unrelated startup errors as permission to start fresh", async () => {
		const result = await runScenario("unrelated-error");
		expect(result.error).toEqual({ name: "Error", message: "UNRELATED_STARTUP_FAILURE" });
		expect(result.session).toBeUndefined();
	}, 30_000);

	test.skipIf(process.platform === "win32")(
		"keeps saved model controls and oversized names out of the startup terminal",
		async () => {
			using temp = TempDir.createSync("@omp-auto-resume-warning-");
			const home = temp.join("home");
			const agentDir = path.join(home, ".zeta", "agent");
			const sourceDir = path.resolve(import.meta.dir, "../src");
			const env = {
				PATH: process.env.PATH,
				HOME: home,
				USERPROFILE: home,
				ZETA_CODING_AGENT_DIR: agentDir,
				TZ: "Asia/Tokyo",
				TERM: "xterm-256color",
				OMP_TUI_NATIVE: "0",
				PI_TUI_NATIVE: "0",
				AWS_EC2_METADATA_DISABLED: "true",
			};
			await Bun.write(
				path.join(agentDir, "config.yml"),
				JSON.stringify({
					autoResume: true,
					modelRoles: { default: "warning-fixture/fresh" },
					retry: { enabled: false, modelFallback: false },
					compaction: { enabled: false },
					startup: { showSplash: false, setupWizard: false, changelogMode: "hidden", checkUpdate: false },
					marketplace: { autoUpdate: "off" },
				}),
			);
			await Bun.write(
				path.join(agentDir, "models.yml"),
				JSON.stringify({
					providers: {
						"warning-fixture": {
							baseUrl: "http://127.0.0.1:1/v1",
							api: "openai-completions",
							auth: "none",
							models: [
								{
									id: "fresh",
									name: "Fresh",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 131072,
									maxTokens: 1024,
								},
							],
						},
					},
				}),
			);
			const selector =
				"lost/visible-\x1b[2J\x1b]0;UNTRUSTED_MODEL_TITLE\x07\x1bPUNTRUSTED_MODEL_DCS\x1b\\\r\n\t\x85\x9b2J" +
				"long-model-".repeat(50) +
				"UNTRUSTED_MODEL_TAIL";
			const prepare = Bun.spawn(
				[
					process.execPath,
					"--eval",
					`
						import { SessionManager } from ${JSON.stringify(path.join(sourceDir, "session/session-manager.ts"))};
						const cwd = process.cwd();
						const timestamp = "2026-10-27T00:00:00+09:00";
						const rows = [
							{ type: "session", version: 3, id: "saved-warning", timestamp, cwd },
							{ type: "model_change", id: "model", parentId: null, timestamp, model: ${JSON.stringify(selector)} },
							{ type: "message", id: "user", parentId: "model", timestamp,
								message: { role: "user", content: "OLD_WARNING_HISTORY", timestamp: Date.parse(timestamp) } }
						];
						await Bun.write(SessionManager.getDefaultSessionDir(cwd) + "/saved.jsonl",
							rows.map(row => JSON.stringify(row)).join("\\n") + "\\n");
					`,
				],
				{ cwd: temp.path(), env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(10_000) },
			);
			const [prepared, preparationError] = await Promise.all([prepare.exited, new Response(prepare.stderr).text()]);
			if (prepared !== 0) throw new Error(`Could not seed the saved session: ${preparationError}`);

			const screen = new VirtualTerminal({ cols: 160, rows: 50, scrollback: 100 });
			const warningSeen = Promise.withResolvers<void>();
			const closed = Promise.withResolvers<void>();
			const decoder = new TextDecoder();
			let output = "";
			let warningScreen = "";
			let screenWritten = Promise.resolve();
			await using terminal = new Bun.Terminal({
				cols: 160,
				rows: 50,
				data(_terminal, data) {
					output += decoder.decode(data, { stream: true });
					const written = Promise.withResolvers<void>();
					screenWritten = written.promise;
					screen.write(data, () => {
						const buffer = screen.buffer.active;
						const visible = Array.from({ length: buffer.length }, (_, row) =>
							buffer.getLine(row)?.translateToString(true).trim(),
						).join(" ");
						if (visible.includes("Could not restore model lost/visible-")) {
							warningScreen = visible;
							warningSeen.resolve();
						}
						written.resolve();
					});
				},
				exit() {
					closed.resolve();
				},
			});
			const proc = Bun.spawn(
				[
					process.execPath,
					path.join(sourceDir, "cli.ts"),
					"--no-title",
					"--no-extensions",
					"--no-skills",
					"--no-rules",
					"--no-tools",
					"--no-lsp",
					"--no-prewalk",
				],
				{ cwd: temp.path(), env, terminal, signal: AbortSignal.timeout(20_000) },
			);
			try {
				// The startup warning may be replaced or suppressed when the setup path
				// re-resolves the model; the security property is that the saved selector
				// never reaches the terminal as control input.
				await Bun.sleep(2000);
				terminal.write("\x04");
				expect(await proc.exited).toBe(0);
				terminal.close();
				await closed.promise;
				await screenWritten;
				expect(output).not.toContain("\x1b]0;UNTRUSTED_MODEL_TITLE\x07");
				expect(output).not.toContain("\x1bPUNTRUSTED_MODEL_DCS\x1b\\");
				expect(output).not.toContain("\x9b");
				expect(output).not.toContain("UNTRUSTED_MODEL_TAIL");
				if (warningScreen) expect(warningScreen).toContain("Could not restore model");
			} finally {
				if (proc.exitCode === null) proc.kill();
				await proc.exited;
				terminal.close();
				await closed.promise;
				await screenWritten;
				screen.dispose();
			}
		},
		30_000,
	);
});
