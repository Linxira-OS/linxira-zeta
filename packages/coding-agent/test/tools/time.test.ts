import { describe, expect, test } from "bun:test";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { Settings } from "@linxiraos/zeta/config/settings";
import { buildDynamicToolNotice, isDynamicToolEnabled } from "@linxiraos/zeta/tools/dynamic-tools";
import { sendTimestampLine, TimeTool, timeReport, wallClock } from "@linxiraos/zeta/tools/time";

describe("wallClock", () => {
	test("renders a fixed instant in a positive whole-hour zone", () => {
		expect(wallClock(new Date("2026-10-07T06:30:05.123Z"), "Asia/Shanghai")).toMatchObject({
			date: "2026-10-07",
			weekday: "Wednesday",
			time: "14:30:05",
			offset: "+08:00",
		});
	});

	test("renders DST standard time with a negative offset", () => {
		expect(wallClock(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toMatchObject({
			date: "2026-01-15",
			weekday: "Thursday",
			time: "07:00:00",
			offset: "-05:00",
		});
	});

	test("renders a half-hour offset zone", () => {
		expect(wallClock(new Date("2026-10-07T06:30:05Z"), "Asia/Kolkata")).toMatchObject({
			date: "2026-10-07",
			time: "12:00:05",
			offset: "+05:30",
		});
	});

	test("carries a non-empty long zone name", () => {
		expect(wallClock(new Date(0), "UTC").zoneName.length).toBeGreaterThan(0);
		expect(wallClock(new Date("2026-10-07T06:30:05.123Z"), "Asia/Shanghai").zoneName.length).toBeGreaterThan(0);
	});
});

describe("timeReport", () => {
	test("formats local, UTC, and epoch lines", () => {
		const now = new Date("2026-10-07T06:30:05.123Z");
		const report = timeReport(now, "Asia/Shanghai");
		const shanghai = wallClock(now, "Asia/Shanghai");
		expect(report.timezone).toBe("Asia/Shanghai");
		expect(report.local).toBe(`2026-10-07 (Wednesday) 14:30:05 +08:00 ${shanghai.zoneName}`);
		expect(report.utc).toBe(`2026-10-07 (Wednesday) 06:30:05 +00:00 ${wallClock(now, "UTC").zoneName}`);
		expect(report.epochMs).toBe(Date.parse("2026-10-07T06:30:05.123Z"));
		expect(report.text).toBe(
			[
				`Local: ${report.local}`,
				`UTC:   ${report.utc}`,
				`Epoch: ${report.epochMs} ms (ISO 2026-10-07T06:30:05.123Z)`,
			].join("\n"),
		);
	});

	test("defaults to the machine's local zone", () => {
		const now = new Date("2026-10-07T06:30:05.123Z");
		const report = timeReport(now);
		expect(report.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		expect(report.utc).toBe(`2026-10-07 (Wednesday) 06:30:05 +00:00 ${wallClock(now, "UTC").zoneName}`);
	});

	test("a blank timezone falls back to the local zone", () => {
		expect(timeReport(new Date(0), "  ").timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
	});

	test("an invalid timezone raises a ToolError naming the supported zone count", () => {
		const supported = Intl.supportedValuesOf("timeZone").length;
		expect(() => timeReport(new Date(0), "Not/AZone")).toThrow(ToolError);
		try {
			timeReport(new Date(0), "Not/AZone");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain('"Not/AZone"');
			expect(message).toContain(`${supported} IANA zones`);
		}
	});
});

describe("sendTimestampLine", () => {
	test("formats the send-instant line in the local zone", () => {
		expect(sendTimestampLine(new Date("2026-10-07T06:30:05.123Z"))).toMatch(
			/^\[发送时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}\]$/,
		);
	});
});

/** First text block of a tool result, asserted to be text. */
function firstText(result: { content: readonly { type: string; text?: string }[] }): string {
	const block = result.content[0];
	if (!block || block.type !== "text" || block.text === undefined) throw new Error("expected a text block");
	return block.text;
}

describe("TimeTool", () => {
	test("reports the frozen current time", async () => {
		const frozen = () => new Date("2026-10-07T06:30:05.123Z");
		const result = await new TimeTool(Settings.isolated(), frozen).execute("call-1", {});
		expect(result.content).toEqual([{ type: "text", text: timeReport(frozen()).text }]);
		expect(result.details).toMatchObject({
			action: "now",
			interval: 50,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			epochMs: Date.parse("2026-10-07T06:30:05.123Z"),
		});
	});

	test("forwards an explicit timezone", async () => {
		const result = await new TimeTool(Settings.isolated(), () => new Date("2026-10-07T06:30:05.123Z")).execute(
			"call-2",
			{ timezone: "Asia/Shanghai" },
		);
		expect(result.details?.timezone).toBe("Asia/Shanghai");
		expect(firstText(result)).toContain("14:30:05 +08:00");
	});

	test("invalid timezone surfaces as ToolError", async () => {
		await expect(new TimeTool(Settings.isolated()).execute("call-3", { timezone: "Not/AZone" })).rejects.toThrow(
			ToolError,
		);
	});
});

describe("TimeTool actions", () => {
	test("on/off toggle the injection feature and return the model notice", async () => {
		const settings = Settings.isolated();
		const tool = new TimeTool(settings, () => new Date("2026-10-07T06:30:05.123Z"));
		const on = await tool.execute("call-on", { action: "on" });
		expect(isDynamicToolEnabled(settings, "time")).toBe(true);
		expect(firstText(on)).toBe(buildDynamicToolNotice("time", true, undefined));
		expect(on.details).toMatchObject({ action: "on", enabled: true });

		const off = await tool.execute("call-off", { action: "off" });
		expect(isDynamicToolEnabled(settings, "time")).toBe(false);
		expect(firstText(off)).toBe(buildDynamicToolNotice("time", false, undefined));
		expect(off.details).toMatchObject({ action: "off", enabled: false });
	});

	test("status reports state and the interval", async () => {
		const settings = Settings.isolated();
		const tool = new TimeTool(settings);
		const status = await tool.execute("call-status", { action: "status" });
		const text = firstText(status);
		expect(text).toContain("time: off");
		expect(text).toContain("50");
		expect(status.details).toMatchObject({ action: "status", enabled: false, interval: 50 });
	});
});
