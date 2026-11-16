import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ComputerControlPolicy } from "../src/server/studio-host/services/computer-control-policy";
import { ComputerViewLeases } from "../src/server/studio-host/services/computer-view-leases";
import {
	validateComputerWorkspaceOperation,
	validateComputerWorkspaceResult,
} from "../src/server/studio-host/protocol/computer-workspace-validation";
import {
	computerResultProjection,
	hasComputerResultDetails,
} from "../src/server/studio-host/services/computer-result-projection";
import {
	ComputerObservationBudget,
	COMPUTER_OBSERVATION_RESERVATION_BYTES,
} from "../src/server/studio-host/services/computer-observation-budget";

test("stop aborts synchronously, and only the exact executed user continue nonce creates a fresh permit", async () => {
	const cancel = Promise.withResolvers<void>();
	const persisted: string[] = [];
	const policy = new ComputerControlPolicy("root", {
		persist: async state => {
			persisted.push(state.status);
		},
		cancel: () => cancel.promise,
		changed() {},
	});
	const before = await policy.authorize();
	const stopping = policy.stop();
	expect(before.signal.aborted).toBe(true);
	await expect(policy.authorize()).rejects.toThrow("stopped");
	expect(() => policy.prepareContinue(policy.state.revision)).toThrow("cleanup");
	cancel.resolve();
	await stopping;
	expect(persisted).toEqual(["stopping", "stopped"]);
	const { intent } = policy.prepareContinue(policy.state.revision);
	const message = {
		role: "custom",
		customType: "studio-computer-continue",
		display: true,
		attribution: "user",
		details: intent,
	};
	policy.consume("root", { ...message, attribution: "agent" });
	await expect(policy.authorize()).rejects.toThrow("stopped");
	policy.consume("child", message);
	await expect(policy.authorize()).rejects.toThrow("stopped");
	policy.consume("root", message);
	const after = await policy.authorize();
	expect(after.signal).not.toBe(before.signal);
	expect(after.signal.aborted).toBe(false);
	expect(before.signal.aborted).toBe(true);
	policy.dispose();
	await expect(policy.authorize()).rejects.toThrow("stopped");
});

test("disposing during continue persistence cannot resurrect control", async () => {
	const durable = Promise.withResolvers<void>();
	const policy = new ComputerControlPolicy("root", {
		persist: async state => {
			if (state.status === "allowed") await durable.promise;
		},
		cancel: async () => {},
		changed() {},
	});
	await policy.stop();
	const { intent } = policy.prepareContinue(policy.state.revision);
	policy.consume("root", {
		role: "custom",
		customType: "studio-computer-continue",
		display: true,
		attribution: "user",
		details: intent,
	});
	policy.dispose();
	durable.resolve();
	await expect(policy.authorize()).rejects.toThrow("stopped");
});

test("private view descriptors never expose owner identity publicly and release settles writes", async () => {
	const directory = await mkdtemp(fileURLToPath(new URL("../../../temp/zeta-computer-view-", import.meta.url)));
	const leases = new ComputerViewLeases(directory);
	const leaseId = crypto.randomUUID();
	let live = true;
	try {
		await leases.publish({
			leaseId,
			ownerId: "context:private-cookie-owner",
			scopeSessionId: "root",
			expiresAt: Date.now() + 120000,
			isLive: () => live,
		});
		const data = JSON.parse(await readFile(join(directory, "computer-views", leaseId + ".json"), "utf8"));
		expect(data.scopeSessionId).toBe("root");
		expect(data.owner).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.stringify(data)).not.toContain("private-cookie-owner");
		live = false;
		await leases.release(leaseId);
		await expect(readFile(join(directory, "computer-views", leaseId + ".json"))).rejects.toThrow();
		await expect(
			leases.publish({
				leaseId,
				ownerId: "owner",
				scopeSessionId: "root",
				expiresAt: Date.now() + 120000,
				isLive: () => live,
			}),
		).rejects.toThrow("closed");
	} finally {
		await leases.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace validation rejects mutation payloads and private result fields", () => {
	expect(() =>
		validateComputerWorkspaceOperation({
			kind: "computer.frame.capture",
			sessionId: "root",
			leaseId: crypto.randomUUID(),
			targetId: "display:all",
			input: "click",
		}),
	).toThrow();
	expect(() =>
		validateComputerWorkspaceOperation({
			kind: "computer.observe.close",
			sessionId: "root",
			leaseId: "../../secret",
		}),
	).toThrow();
	expect(() =>
		validateComputerWorkspaceResult("computer.observe.open", {
			leaseId: crypto.randomUUID(),
			sessionId: "root",
			expiresAt: 1,
			directory: "private",
		}),
	).toThrow();
});

test("conversation references omit native paths, owner keys, and nested image payloads", () => {
	const frameId = crypto.randomUUID();
	const details = {
		computerFrames: [{ frameId, sessionId: "root", toolCallId: "eval", delivered: true, path: "/private/frame.png" }],
		screenshots: [{ path: "/private/frame.png" }],
		images: [{ data: "secret-pixels" }],
		cells: [{ code: "await computer.screenshot()", output: "captured", images: [{ data: "secret-pixels" }] }],
		owner: "private-owner",
	};
	expect(hasComputerResultDetails(details)).toBe(true);
	const result = computerResultProjection(details),
		encoded = JSON.stringify(result);
	expect(encoded).toContain(frameId);
	expect(encoded).not.toContain("secret-pixels");
	expect(encoded).not.toContain("/private");
	expect(encoded).not.toContain("private-owner");
	expect(computerResultProjection({ computerFrames: [{ frameId: "../../private" }] })).toBeUndefined();
});

test("profile reservations reject excess capture and cancel without leaking staged media", async () => {
	const directory = await mkdtemp(fileURLToPath(new URL("../../../temp/zeta-computer-budget-", import.meta.url)));
	const budget = new ComputerObservationBudget(directory);
	const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
	try {
		for (const id of ids) await budget.reserve(id, "root", "root", Date.now() + 120000);
		await expect(budget.reserve(crypto.randomUUID(), "root", "root", Date.now() + 120000)).rejects.toThrow("64 MiB");
		await expect(
			budget.commit(ids[0], COMPUTER_OBSERVATION_RESERVATION_BYTES + 1, Date.now() + 120000),
		).rejects.toThrow("budget");
		for (const id of ids) await budget.cancel(id);
		const stored = JSON.parse(
			await readFile(join(directory, "computer-workspace", "observation-budget.json"), "utf8"),
		);
		expect(stored.reservations).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
