import { expect, test } from "bun:test";
import { AgentRegistry } from "../src/registry/agent-registry";
import type { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { ownedComputerSessions } from "../src/server/studio-host/services/computer-owned-sessions";
import {
	bindRemoteComputerSession,
	computerSessionId,
	registerComputerOwnerEndpoint,
	revokeComputerSessions,
} from "../src/tools/computer/session-runtime";

test("ownership follows live registry parent links and excludes unrelated, parked, and cyclic residents", () => {
	const registry = AgentRegistry.global();
	const prefix = crypto.randomUUID();
	const session = (name: string) =>
		({
			instanceKey: "w88:" + prefix + name,
			sessionId: name,
			sessionManager: SessionManager.inMemory(),
			isDisposed: false,
		}) as unknown as AgentSession;
	const root = session("root"),
		child = session("child"),
		sibling = session("sibling"),
		cyclic = session("cyclic"),
		parked = session("parked");
	const refs = [
		registry.register({ id: prefix + "root", displayName: "root", kind: "main", session: root }),
		registry.register({
			id: prefix + "child",
			displayName: "child",
			kind: "sub",
			parentId: prefix + "root",
			session: child,
		}),
		registry.register({ id: prefix + "other", displayName: "other", kind: "main", session: sibling }),
		registry.register({
			id: prefix + "cyclic",
			displayName: "cyclic",
			kind: "sub",
			parentId: prefix + "cyclic",
			session: cyclic,
		}),
		registry.register({
			id: prefix + "parked",
			displayName: "parked",
			kind: "sub",
			parentId: prefix + "root",
			session: parked,
			status: "parked",
		}),
	];
	try {
		expect(ownedComputerSessions(root)).toEqual([root, child]);
	} finally {
		for (const ref of refs) registry.unregister(ref.id, ref);
	}
});

test("remote controller revocation is homed by instance identity and waits for every cleanup", async () => {
	const first = { instanceKey: "w91:one", sessionManager: SessionManager.inMemory() } as unknown as AgentSession;
	const second = { instanceKey: "w92:two", sessionManager: SessionManager.inMemory() } as unknown as AgentSession;
	bindRemoteComputerSession(first.instanceKey, { sessionId: "canonical-provider-session", ownerId: "eval-owner" });
	expect(computerSessionId(first)).toBe("canonical-provider-session");
	const pending = Promise.withResolvers<void>();
	let requested: string[] = [];
	const release = registerComputerOwnerEndpoint("w91", {
		revoke: async keys => {
			requested = keys;
			await pending.promise;
		},
	});
	try {
		let settled = false;
		const result = revokeComputerSessions([first, second]).catch(error => {
			settled = true;
			throw error;
		});
		const rejection = result.catch((error: unknown) => error);
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(requested).toEqual([first.instanceKey]);
		pending.resolve();
		const error = await rejection;
		expect(error).toBeInstanceOf(Error);
		if (!(error instanceof Error)) throw new Error("Expected failed remote cleanup");
		expect(error.message).toContain("unconfirmed");
	} finally {
		release();
		bindRemoteComputerSession(first.instanceKey, undefined);
	}
});
