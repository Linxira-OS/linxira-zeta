import { afterEach, describe, expect, test } from "bun:test";
import { handleAgentCommand, handleAgentNew } from "../../src/server/web-gateway/agents";
import { isGatewayDraining, setGatewayDraining } from "../../src/server/web-gateway/draining";

afterEach(() => setGatewayDraining(false));

describe("gateway drain gate", () => {
	test("refuses new sessions while draining", async () => {
		setGatewayDraining(true);
		const response = await handleAgentNew(
			new Request("http://localhost/api/agent/new", { method: "POST", body: "{}" }),
		);
		expect(response.status).toBe(503);
	});

	test("refuses prompts and steers while draining", async () => {
		setGatewayDraining(true);
		for (const body of [
			{ type: "prompt", message: "hello" },
			{ type: "steer", text: "hello" },
			{ type: "follow_up", text: "hello" },
			{ type: "compact" },
			{ type: "guided_goal", message: "ship it" },
		]) {
			const response = await handleAgentCommand(
				new Request("http://localhost/api/agent/session", { method: "POST", body: JSON.stringify(body) }),
				"session",
			);
			expect(response.status).toBe(503);
		}
	});

	test("keeps abort and state reads available while draining", async () => {
		setGatewayDraining(true);
		for (const body of [{ type: "abort" }, { type: "get_state" }]) {
			const response = await handleAgentCommand(
				new Request("http://localhost/api/agent/session", { method: "POST", body: JSON.stringify(body) }),
				"missing-session",
			);
			expect(response.status).toBe(404);
		}
	});

	test("leaves the flag clear after a normal request", () => {
		expect(isGatewayDraining()).toBe(false);
	});
});
