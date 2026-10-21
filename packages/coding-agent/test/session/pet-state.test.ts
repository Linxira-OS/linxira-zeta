import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent } from "@linxiraos/pi-agent-core";

import { petStateForAgentEvent, petStatePath, writePetState } from "../../src/session/pet-state";

let root: string;

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "pet-state-"));
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("pet state mapping", () => {
	it("maps the agent lifecycle to the pet's states", () => {
		expect(petStateForAgentEvent({ type: "agent_start" } as unknown as AgentEvent)).toBe("working");
		expect(
			petStateForAgentEvent({
				type: "message_start",
				message: { role: "assistant" },
			} as unknown as AgentEvent),
		).toBe("thinking");
		expect(
			petStateForAgentEvent({ type: "message_start", message: { role: "user" } } as unknown as AgentEvent),
		).toBeUndefined();
		expect(petStateForAgentEvent({ type: "tool_execution_start" } as unknown as AgentEvent)).toBe("working");
		expect(petStateForAgentEvent({ type: "message_update" } as unknown as AgentEvent)).toBeUndefined();
		expect(
			petStateForAgentEvent({
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "stop" }],
			} as unknown as AgentEvent),
		).toBe("done");
		expect(
			petStateForAgentEvent({
				type: "agent_end",
				messages: [{ role: "assistant", stopReason: "error" }],
			} as unknown as AgentEvent),
		).toBe("error");
	});
});

describe("pet state writer", () => {
	it("does nothing when the pet directory is absent and never creates it", async () => {
		const workspace = path.join(root, "missing");
		await writePetState("working", { workspaceDir: workspace });
		const created = await fs.stat(path.join(workspace, "pet")).then(
			() => true,
			() => false,
		);
		expect(created).toBe(false);
	});

	it("writes state and since when the pet directory exists", async () => {
		const workspace = path.join(root, "installed");
		await fs.mkdir(path.join(workspace, "pet"), { recursive: true });
		await writePetState("done", { workspaceDir: workspace, now: () => 1234 });
		const written = JSON.parse(await fs.readFile(petStatePath(workspace), "utf-8"));
		expect(written).toEqual({ state: "done", since: 1234 });
	});

	it("swallows an unwritable state file", async () => {
		const workspace = path.join(root, "readonly");
		await fs.mkdir(path.join(workspace, "pet"), { recursive: true });
		// A directory where the file belongs makes the rename fail.
		await fs.mkdir(petStatePath(workspace));
		await writePetState("error", { workspaceDir: workspace });
	});
});
