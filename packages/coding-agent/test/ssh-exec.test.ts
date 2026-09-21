import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDir, setAgentDir, setProjectDir } from "@linxiraos/pi-utils";
import { writeSSHConfigFile } from "../src/ssh/config-writer";
import type { ToolSession } from "../src/tools";
import { resolveTarget, SshExecTool } from "../src/tools/ssh-exec";

const fakeSession = {} as ToolSession;

describe("ssh_exec tool", () => {
	const originalAgentDir = getAgentDir();
	let home: string;

	beforeAll(async () => {
		home = await mkdtemp(path.join(tmpdir(), "zeta-ssh-exec-"));
		await mkdir(path.join(home, "agent"), { recursive: true });
		await mkdir(path.join(home, "proj", ".zeta"), { recursive: true });
		setAgentDir(path.join(home, "agent"));
		setProjectDir(path.join(home, "proj"));
		await writeSSHConfigFile(path.join(home, "agent", "ssh.json"), {
			hosts: {
				"user-only": { host: "203.0.113.10" },
				both: { host: "203.0.113.20" },
			},
		});
		await writeSSHConfigFile(path.join(home, "proj", ".zeta", "ssh.json"), {
			hosts: { both: { host: "203.0.113.21" } },
		});
	});

	afterAll(() => setAgentDir(originalAgentDir));

	test("project scope wins over user scope for the same name", async () => {
		const target = await resolveTarget("both");
		expect(target?.host).toBe("203.0.113.21");
	});

	test("user scope is the fallback when project has no such host", async () => {
		const target = await resolveTarget("user-only");
		expect(target?.host).toBe("203.0.113.10");
	});

	test("unknown host produces a guided error result", async () => {
		const tool = new SshExecTool(fakeSession);
		const result = await tool.execute("t1", { host: "nope", command: "true" });
		expect(result.isError).toBe(true);
		expect(result.content[0].type === "text" && result.content[0].text).toContain("/ssh add");
	});

	test("unreachable host surfaces a connection failure, not a hang", async () => {
		await writeSSHConfigFile(path.join(home, "ssh.json"), {
			hosts: { dead: { host: "127.0.0.1", port: 1 } },
		});
		const tool = new SshExecTool(fakeSession);
		const result = await tool.execute("t2", { host: "dead", command: "true", timeoutMs: 15_000 });
		expect(result.isError).toBe(true);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text.length).toBeGreaterThan(0);
	});
});
