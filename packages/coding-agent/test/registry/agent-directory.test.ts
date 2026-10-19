import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAgentDirectory, type WorkspaceRef } from "@linxiraos/zeta/registry/agent-directory";
import { AgentRegistry, type AgentRef, MAIN_AGENT_ID } from "@linxiraos/zeta/registry/agent-registry";

describe("createAgentDirectory", () => {
	let registry: AgentRegistry;
	let main: AgentRef;
	let sub: AgentRef;

	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		registry = new AgentRegistry();
		main = registry.register({ id: MAIN_AGENT_ID, displayName: "Main", kind: "main", session: null });
		sub = registry.register({
			id: "0-Explore",
			displayName: "Explore",
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: null,
			status: "idle",
			sessionFile: "/tmp/0-Explore.jsonl",
		});
	});

	afterEach(() => {
		AgentRegistry.resetGlobalForTests();
	});

	it("lists the main agent and its subagent as session-free descriptors", () => {
		const directory = createAgentDirectory(registry);
		const descriptors = directory.list();

		expect(descriptors).toHaveLength(2);
		expect(descriptors.map(d => d.id)).toEqual([MAIN_AGENT_ID, "0-Explore"]);
		expect(descriptors[0]).toEqual({
			id: MAIN_AGENT_ID,
			displayName: "Main",
			kind: "main",
			status: "running",
		});
		expect(descriptors[1]).toEqual({
			id: "0-Explore",
			displayName: "Explore",
			kind: "sub",
			status: "idle",
			parentId: MAIN_AGENT_ID,
		});
		for (const descriptor of descriptors) expect("session" in descriptor).toBe(false);
	});

	it("gets one agent by id and returns undefined for an unknown id", () => {
		const directory = createAgentDirectory(registry);

		expect(directory.get("0-Explore")).toEqual({
			id: "0-Explore",
			displayName: "Explore",
			kind: "sub",
			status: "idle",
			parentId: MAIN_AGENT_ID,
		});
		expect(directory.get("missing")).toBeUndefined();
	});

	it("does not follow later registry mutations in an earlier list() snapshot", () => {
		const directory = createAgentDirectory(registry);
		const first = directory.list();
		registry.register({ id: "1-Review", displayName: "Review", kind: "sub", session: null });

		expect(first.map(d => d.id)).toEqual([MAIN_AGENT_ID, "0-Explore"]);
		expect(directory.list().map(d => d.id)).toEqual([MAIN_AGENT_ID, "0-Explore", "1-Review"]);
	});

	it("attaches the workspace resolved for each ref without leaking the registry object", () => {
		const workspace: WorkspaceRef = { dir: "/work/api", alias: "api" };
		const directory = createAgentDirectory(registry, ref => (ref.id === "0-Explore" ? workspace : undefined));

		const descriptor = directory.get("0-Explore");
		expect(descriptor?.workspace).toEqual({ dir: "/work/api", alias: "api" });
		expect(descriptor?.workspace).not.toBe(workspace);
		expect(directory.get(MAIN_AGENT_ID)?.workspace).toBeUndefined();

		workspace.dir = "/work/renamed";
		expect(descriptor?.workspace).toEqual({ dir: "/work/api", alias: "api" });
	});

	it("omits the workspace property entirely when the resolver has none", () => {
		const directory = createAgentDirectory(registry);

		expect(directory.get(MAIN_AGENT_ID)).not.toHaveProperty("workspace");
		expect(directory.get(sub.id)?.parentId).toBe(main.id);
	});
});
