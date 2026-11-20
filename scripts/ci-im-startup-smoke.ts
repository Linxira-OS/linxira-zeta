/**
 * Release smoke: a real CLI startup against the web.yml shape the IM instance
 * editor writes.
 *
 * 1.5.10 wrote empty-peer instances (`allow.peers: []`) and then rejected them
 * while loading web.yml, so every CLI command crashed before dispatch. Unit
 * tests had encoded the wrong contract; this gate runs the actual CLI entrypoint
 * with a fixture config instead of trusting the validator's own tests.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const profile = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: {
		builtin: [],
		extensions: [],
		customTools: [],
		mcpServers: [],
		skills: [],
		commands: [],
	},
	memory: {},
};

const platforms = ["wechat", "feishu", "telegram", "discord", "qq"];
const fixture = {
	imAgents: [profile],
	channels: {
		instances: platforms.map((platform, index) => ({
			id: platform,
			platform,
			label: platform,
			enabled: index === 0,
			agentProfile: profile.id,
			allow: { peers: [] },
			credentials: {},
		})),
	},
};

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-im-startup-"));
try {
	await Bun.write(path.join(dir, "web.yml"), `${JSON.stringify(fixture, null, 2)}\n`);
	const result = Bun.spawnSync([process.execPath, "packages/coding-agent/src/cli.ts", "--version"], {
		env: { ...process.env, ZETA_CODING_AGENT_DIR: dir },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI startup rejected the IM instance config (exit ${result.exitCode})\n${result.stdout.toString()}${result.stderr.toString()}`,
		);
	}
	const output = result.stdout.toString().trim();
	if (!output.startsWith("zetacode/")) throw new Error(`Unexpected --version output: ${output}`);
	console.log(`IM startup smoke passed: ${output}`);
} finally {
	await fs.rm(dir, { recursive: true, force: true });
}
