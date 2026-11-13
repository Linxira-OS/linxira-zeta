/** Adapter capabilities match the read-only model the IM page consumes. */

import { describe, expect, test } from "bun:test";
import {
	CHANNEL_PLATFORM_CAPABILITIES,
	DiscordChannel,
	FeishuChannel,
	OneBotChannel,
	TelegramChannel,
	WeChatChannel,
} from "@linxiraos/pi-channels";

const onMessage = (): void => {};

describe("channel capabilities read model", () => {
	test("every shipped adapter reports the same capability values", () => {
		const adapters = [
			new WeChatChannel({ config: { botToken: "t" }, onMessage } as never),
			new FeishuChannel({ onMessage } as never),
			// Telegram/ Discord/OneBot read only the credential/onMessage fields here.
			new TelegramChannel({ botToken: "t", onMessage } as never),
			new DiscordChannel({ botToken: "t", onMessage } as never),
			new OneBotChannel({ onMessage } as never),
		];
		for (const adapter of adapters) {
			expect(adapter.capabilities).toEqual(CHANNEL_PLATFORM_CAPABILITIES[adapter.platform]);
		}
	});

	test("Feishu advertises files as unsupported and implements no file sender", () => {
		const feishu = new FeishuChannel({ onMessage } as never);
		expect(feishu.capabilities.supportsFiles).toBe(false);
		expect("sendFile" in feishu).toBe(false);
		expect(feishu.capabilities.supportsImages).toBe(true);
	});
});
