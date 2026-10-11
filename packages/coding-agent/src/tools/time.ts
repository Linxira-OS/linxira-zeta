import { type } from "@linxiraos/pi-omptype";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { prompt } from "@linxiraos/pi-utils";
import type { Settings } from "../config/settings";
import timeDescription from "../prompts/tools/time.md" with { type: "text" };
import {
	buildDynamicToolNotice,
	buildTimeStatusLine,
	isDynamicToolEnabled,
	setDynamicToolEnabled,
	timeInjectInterval,
} from "./dynamic-tools";

/** The `time` tool's modes: report now, toggle injection, or report its state. */
export type TimeAction = "now" | "on" | "off" | "status";

const timeSchema = type({
	"action?": type('"now" | "on" | "off" | "status"').describe(
		"now (default): report the current time; on/off: enable or disable time injection; status: report injection state and interval",
	),
	"timezone?": type("string").describe(
		'IANA timezone name (e.g. "Asia/Shanghai"); omitted uses this machine\'s local zone',
	),
});

type TimeParams = typeof timeSchema.infer;

interface TimeToolDetails {
	action: TimeAction;
	enabled: boolean;
	interval: number;
	timezone?: string;
	local?: string;
	utc?: string;
	epochMs?: number;
}

/** Wall-clock rendering of one instant in one IANA zone. */
export interface WallClock {
	/** `YYYY-MM-DD` */
	date: string;
	/** Long English weekday name, e.g. `Wednesday`. */
	weekday: string;
	/** `HH:mm:ss` (24-hour) */
	time: string;
	/** Exact offset at that instant, e.g. `+08:00`. */
	offset: string;
	/** Long zone name, e.g. `China Standard Time`. */
	zoneName: string;
}

function partsOf(formatter: Intl.DateTimeFormat, now: Date): Record<string, string> {
	const parts: Record<string, string> = {};
	for (const part of formatter.formatToParts(now)) parts[part.type] = part.value;
	return parts;
}

/**
 * Render `now` in `timeZone`: wall-clock fields via `Intl.DateTimeFormat`, and
 * the exact UTC offset at that instant derived from the wall clock itself
 * (stable across ICU builds, unlike `timeZoneName: "longOffset"`).
 *
 * @throws RangeError when `timeZone` is not a supported IANA name.
 */
export function wallClock(now: Date, timeZone: string): WallClock {
	const parts = partsOf(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
			weekday: "long",
		}),
		now,
	);
	// The wall clock was computed for exactly this epoch, so the difference
	// between it (read as UTC) and the epoch is the offset at that instant.
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	const offsetMinutes = Math.round((asUtc - now.getTime()) / 60_000);
	const offsetHours = Math.trunc(offsetMinutes / 60);
	const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.abs(offsetHours)).padStart(2, "0")}:${String(Math.abs(offsetMinutes % 60)).padStart(2, "0")}`;
	let zoneName = timeZone;
	try {
		zoneName =
			partsOf(new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }), now).timeZoneName ?? timeZone;
	} catch {
		// Offset-only zone rendering stays useful without the long name.
	}
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		weekday: parts.weekday ?? "",
		time: `${parts.hour}:${parts.minute}:${parts.second}`,
		offset,
		zoneName,
	};
}

export interface TimeReport {
	timezone: string;
	local: string;
	utc: string;
	epochMs: number;
	text: string;
}

/**
 * Build the `time` tool report for `now`, in `timezone` (defaults to the
 * machine's local zone).
 *
 * @throws ToolError when `timezone` is not a supported IANA name.
 */
export function timeReport(now: Date, timezone?: string): TimeReport {
	const zone = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	let local: WallClock;
	try {
		local = wallClock(now, zone);
	} catch (error) {
		const count = Intl.supportedValuesOf("timeZone").length;
		throw new ToolError(
			`Invalid time zone${timezone ? ` "${timezone.trim()}"` : ""}: ${error instanceof Error ? error.message : String(error)}. ` +
				`${count} IANA zones are supported (Intl.supportedValuesOf("timeZone")).`,
			{ timezone },
		);
	}
	const utc = wallClock(now, "UTC");
	return {
		timezone: zone,
		local: `${local.date} (${local.weekday}) ${local.time} ${local.offset} ${local.zoneName}`,
		utc: `${utc.date} (${utc.weekday}) ${utc.time} ${utc.offset} ${utc.zoneName}`,
		epochMs: now.getTime(),
		text: [
			`Local: ${local.date} (${local.weekday}) ${local.time} ${local.offset} ${local.zoneName}`,
			`UTC:   ${utc.date} (${utc.weekday}) ${utc.time} ${utc.offset} ${utc.zoneName}`,
			`Epoch: ${now.getTime()} ms (ISO ${now.toISOString()})`,
		].join("\n"),
	};
}

/**
 * `[发送时间: YYYY-MM-DD HH:mm:ss ±HH:MM]` line appended to user messages
 * while the dynamic `time` tool is enabled — the send instant, not "now".
 */
export function sendTimestampLine(now: Date): string {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const clock = wallClock(now, zone);
	return `[发送时间: ${clock.date} ${clock.time} ${clock.offset}]`;
}

/** Reports the current local time, UTC, and epoch milliseconds on demand. */
export class TimeTool implements AgentTool<typeof timeSchema, TimeToolDetails> {
	readonly name = "time";
	readonly label = "Time";
	readonly summary = "Get the current date and time";
	readonly description = prompt.render(timeDescription);
	readonly parameters = timeSchema;
	readonly strict = true;
	readonly approval = "read" as const;
	readonly intent = "omit" as const;

	/** Substitutable clock source; production reads the real current time. */
	readonly #now: () => Date;
	/** Settings backing the `on`/`off`/`status` actions. */
	readonly #settings: Settings;

	constructor(settings: Settings, now: () => Date = () => new Date()) {
		this.#settings = settings;
		this.#now = now;
	}

	async execute(_toolCallId: string, params: TimeParams): Promise<AgentToolResult<TimeToolDetails>> {
		const action = params.action ?? "now";
		const interval = timeInjectInterval(this.#settings);
		const enabled = isDynamicToolEnabled(this.#settings, "time");
		if (action === "status") {
			return {
				content: [{ type: "text", text: buildTimeStatusLine(this.#settings) }],
				details: { action, enabled, interval },
			};
		}
		if (action === "on" || action === "off") {
			// `time` stays registered while injection is off so the model can switch
			// the feature back on; the action toggles the behavior, not the presence.
			setDynamicToolEnabled(this.#settings, "time", action === "on");
			return {
				content: [{ type: "text", text: buildDynamicToolNotice("time", action === "on", undefined) }],
				details: { action, enabled: action === "on", interval },
			};
		}
		const report = timeReport(this.#now(), params.timezone);
		return {
			content: [{ type: "text", text: report.text }],
			details: {
				action,
				enabled,
				interval,
				timezone: report.timezone,
				local: report.local,
				utc: report.utc,
				epochMs: report.epochMs,
			},
		};
	}
}
