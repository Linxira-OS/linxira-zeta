/**
 * /tracking on|off tests — the toggle surface that flips `tracking.enabled`
 * and teaches the model what just appeared or vanished.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { Settings } from "@linxiraos/zeta/config/settings";
import { setLanguage } from "@linxiraos/zeta/i18n/index";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { executeAcpBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/acp-builtins";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import { cfgTrackingEnabled } from "@linxiraos/zeta/tools/settings";

function createRuntime(trackingEnabled = false) {
	const settings = Settings.isolated(trackingEnabled ? { "tracking.enabled": true } : {});
	const sendCustomMessage = vi.fn(async () => false);
	const session = { sendCustomMessage } as unknown as AgentSession;
	const output = vi.fn();
	const runtime = {
		session,
		sessionManager: { getSessionId: () => "s1", getCwd: () => process.cwd() } as never,
		settings,
		cwd: process.cwd(),
		output,
		refreshCommands: () => {},
		reloadPlugins: async () => {},
	} as unknown as SlashCommandRuntime;
	return { runtime, sendCustomMessage, output, settings };
}

describe("/tracking on|off", () => {
	beforeEach(() => setLanguage("zh"));
	afterEach(() => setLanguage("en"));

	test("on persists the setting and injects exactly one notice", async () => {
		const h = createRuntime(false);
		expect(cfgTrackingEnabled.get(h.settings)).toBe(false);

		const result = await executeAcpBuiltinSlashCommand("/tracking on", h.runtime);

		expect(result).toEqual({ consumed: true });
		expect(cfgTrackingEnabled.get(h.settings)).toBe(true);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(1);
		const [message, options] = h.sendCustomMessage.mock.calls[0] as unknown as [
			{ customType: string; content: string; display: boolean },
			{ deliverAs?: string },
		];
		expect(message.customType).toBe("tracking-toggle-notice");
		expect(message.display).toBe(false);
		expect(message.content).toBe(
			"项目追踪已开启：用 tracking_update 维护追踪文档（状态、索引、日志、计划），文档跨压缩保留。",
		);
		expect(options?.deliverAs).toBe("nextTurn");
	});

	test("a repeated on changes nothing and injects no notice", async () => {
		const h = createRuntime(false);
		await executeAcpBuiltinSlashCommand("/tracking on", h.runtime);
		await executeAcpBuiltinSlashCommand("/tracking on", h.runtime);

		expect(cfgTrackingEnabled.get(h.settings)).toBe(true);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(1);
		expect(h.output).toHaveBeenLastCalledWith("项目追踪已是该状态，未做改动。");
	});

	test("off after on flips it back and injects the off notice", async () => {
		const h = createRuntime(false);
		await executeAcpBuiltinSlashCommand("/tracking on", h.runtime);
		await executeAcpBuiltinSlashCommand("/tracking off", h.runtime);

		expect(cfgTrackingEnabled.get(h.settings)).toBe(false);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(2);
		const [offMessage] = h.sendCustomMessage.mock.calls[1] as unknown as [{ content: string }];
		expect(offMessage.content).toBe("项目追踪已关闭：不再调用 tracking_update，阶段提醒停止，磁盘上的文档原样保留。");
	});

	test("status with tracking disabled prints the hint, not the documents report", async () => {
		const h = createRuntime(false);
		await executeAcpBuiltinSlashCommand("/tracking status", h.runtime);

		expect(h.output).toHaveBeenCalledWith(
			"项目追踪已关闭。用 /tracking on 开启，或在 /settings → tools → Project Tracking（tracking.enabled）中启用。",
		);
		expect(h.output.mock.calls[0]?.[0]).not.toContain("状态文件不存在");
		expect(h.sendCustomMessage).not.toHaveBeenCalled();
	});
});
