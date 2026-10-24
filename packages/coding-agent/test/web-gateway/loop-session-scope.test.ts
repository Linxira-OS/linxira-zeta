/**
 * `/loop` is session state. The gateway wrapper owns one controller per
 * session, so a loop started through an attached session must never touch a
 * sibling session (or a default workspace) and must not leak across a switch.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Agent } from "@linxiraos/pi-agent-core";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { TempDir } from "@linxiraos/pi-utils";
import * as path from "node:path";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AgentSessionWrapper } from "../../src/server/web-gateway/agents";
import { AgentSession } from "../../src/session/agent-session";
import { SessionManager } from "../../src/session/session-manager";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

const tempDir = TempDir.createSync("@zeta-loop-scope-");
const authStorage = createInMemoryAuthStorage();
const model = createMockModel({ handler: { content: ["ok"] } });
authStorage.keys.setRuntime(model.model.provider, "test-key");

function makeWrapper(name: string): AgentSessionWrapper {
	const manager = SessionManager.create(
		path.join(tempDir.path(), name),
		path.join(tempDir.path(), `${name}-sessions`),
	);
	const session = new AgentSession({
		agent: new Agent({
			initialState: { model: model.model, systemPrompt: ["test"], tools: [], messages: [] },
			streamFn: model.stream,
		}),
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(authStorage),
	});
	return new AgentSessionWrapper(session, manager.getSessionId(), manager.getSessionFile() ?? null);
}

afterAll(async () => {
	authStorage.close();
	tempDir.removeSync();
});

describe("loop session scope", () => {
	test("a waiting loop adopts the next host prompt on its own session", async () => {
		const wrapper = makeWrapper("waiting");
		try {
			await wrapper.send({ type: "loop_start", args: "3" });
			await wrapper.send({ type: "prompt", message: "manual-body" });
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				await Bun.sleep(50);
				if (wrapper.getSession().messages.filter(message => message.role === "user").length >= 2) break;
			}
			const users = wrapper
				.getSession()
				.messages.filter(message => message.role === "user")
				.map(message =>
					typeof message.content === "string"
						? message.content
						: message.content
								.filter(block => block.type === "text")
								.map(block => block.text)
								.join(""),
				);
			expect(users.slice(0, 2)).toEqual(["manual-body", "manual-body"]);
			const state = (await wrapper.send({ type: "get_state" })) as {
				loop?: { enabled: boolean; prompt?: string } | null;
			};
			expect(state.loop).toMatchObject({ enabled: true, prompt: "manual-body" });
			await wrapper.send({ type: "loop_stop" });
		} finally {
			await wrapper
				.getSession()
				.dispose()
				.catch(() => undefined);
		}
	}, 30_000);

	test("a forwarded slash command does not become the waiting loop body", async () => {
		const wrapper = makeWrapper("forwarded");
		try {
			await wrapper.send({ type: "loop_start", args: "3" });
			await wrapper.send({ type: "prompt", message: "/status", loopBody: false });
			const state = (await wrapper.send({ type: "get_state" })) as {
				loop?: { enabled: boolean; prompt?: string } | null;
			};
			expect(state.loop).toMatchObject({ enabled: true });
			expect(state.loop?.prompt).toBeUndefined();
			await wrapper.send({ type: "loop_stop" });
		} finally {
			await wrapper
				.getSession()
				.dispose()
				.catch(() => undefined);
		}
	}, 30_000);

	test("a loop belongs to the session it was started on", async () => {
		const first = makeWrapper("first");
		const second = makeWrapper("second");
		try {
			await first.send({ type: "loop_start", args: "7" });
			const firstState = (await first.send({ type: "get_state" })) as {
				loop?: { enabled: boolean; prompt?: string } | null;
			};
			expect(firstState.loop).toMatchObject({ enabled: true });
			expect(firstState.loop?.prompt).toBeUndefined();

			const secondState = (await second.send({ type: "get_state" })) as { loop?: unknown };
			expect(secondState.loop).toBeNull();

			// A loop on the second session runs its own prompt only.
			await second.send({ type: "loop_start", args: "1 only-here" });
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				await Bun.sleep(50);
				const users = second.getSession().messages.filter(message => message.role === "user");
				if (users.length >= 2) break;
			}
			const secondUsers = second
				.getSession()
				.messages.filter(message => message.role === "user")
				.map(message =>
					typeof message.content === "string"
						? message.content
						: message.content
								.filter(block => block.type === "text")
								.map(block => block.text)
								.join(""),
				);
			expect(secondUsers).toEqual(["only-here", "only-here"]);

			const firstAfter = (await first.send({ type: "get_state" })) as {
				loop?: { enabled: boolean; prompt?: string } | null;
			};
			expect(firstAfter.loop).toMatchObject({ enabled: true });
			expect(firstAfter.loop?.prompt).toBeUndefined();
			expect(first.getSession().messages).toHaveLength(0);

			await second.send({ type: "loop_stop" });
			expect(((await second.send({ type: "get_state" })) as { loop?: unknown }).loop).toBeNull();
		} finally {
			await first
				.getSession()
				.dispose()
				.catch(() => undefined);
			await second
				.getSession()
				.dispose()
				.catch(() => undefined);
		}
	}, 30_000);
});
