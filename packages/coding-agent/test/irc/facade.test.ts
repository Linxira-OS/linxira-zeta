import { describe, expect, it, vi } from "bun:test";
import type { IrcDeliveryReceipt, IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import type { IrcBus } from "@linxiraos/zeta/irc/bus";
import { createAgentMessenger } from "@linxiraos/zeta/irc/facade";

type SentMessage = Omit<IrcMessage, "id" | "ts">;

function fakeBus(reply: IrcMessage | null = null) {
	const send = vi.fn(async (msg: SentMessage): Promise<IrcDeliveryReceipt> => ({
		to: msg.to,
		outcome: "injected",
	}));
	const wait = vi.fn(async (): Promise<IrcMessage | null> => reply);
	const inbox = vi.fn((_agentId: string, _opts?: { peek?: boolean }): IrcMessage[] => (reply ? [{ ...reply }] : []));
	const bus = { send, wait, inbox } as unknown as IrcBus;
	return { bus, send, wait, inbox, messenger: createAgentMessenger(bus) };
}

const REPLY: IrcMessage = { id: "m-1", from: "0-Explore", to: "Main", body: "done", ts: 42 };

describe("createAgentMessenger", () => {
	it("delegates send with the message and delivery options", async () => {
		const { messenger, send } = fakeBus();

		const receipt = await messenger.send("Main", "0-Explore", "ping", {
			replyTo: "m-0",
			wakeRelay: true,
			expectsReply: true,
			suppressRelay: true,
		});

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith(
			{ from: "Main", to: "0-Explore", body: "ping", replyTo: "m-0", wakeRelay: true },
			{ expectsReply: true, suppressRelay: true },
		);
		expect(receipt).toEqual({ to: "0-Explore", outcome: "injected" });
	});

	it("passes undefined delivery options for a plain send", async () => {
		const { messenger, send } = fakeBus();

		await messenger.send("Main", "0-Explore", "ping");

		expect(send).toHaveBeenCalledWith({ from: "Main", to: "0-Explore", body: "ping" }, undefined);
	});

	it("forwards only the delivery flags that were supplied", async () => {
		const { messenger, send } = fakeBus();

		await messenger.send("Main", "0-Explore", "ping", { expectsReply: false });

		expect(send).toHaveBeenCalledWith(
			{ from: "Main", to: "0-Explore", body: "ping" },
			{ expectsReply: false, suppressRelay: undefined },
		);
	});

	it("delegates wait and returns the bus result", async () => {
		const { messenger, wait } = fakeBus(REPLY);
		const controller = new AbortController();

		await expect(messenger.wait("Main", { from: "0-Explore" }, 50, controller.signal)).resolves.toEqual(REPLY);
		expect(wait).toHaveBeenCalledWith("Main", { from: "0-Explore" }, 50, controller.signal);
	});

	it("returns null when the bus wait times out", async () => {
		const { messenger } = fakeBus(null);

		await expect(messenger.wait("Main", {}, 1)).resolves.toBeNull();
	});

	it("delegates inbox with and without peek", () => {
		const { messenger, inbox } = fakeBus(REPLY);

		expect(messenger.inbox("0-Explore")).toEqual([REPLY]);
		expect(inbox).toHaveBeenLastCalledWith("0-Explore", undefined);
		expect(messenger.inbox("0-Explore", { peek: true })).toEqual([REPLY]);
		expect(inbox).toHaveBeenLastCalledWith("0-Explore", { peek: true });
	});
});
