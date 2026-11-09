/**
 * Contract tests for the built-in `calendar` tool: the file-backed store under
 * `<cwd>/.zeta/calendar/events`, its actions and validation, project isolation,
 * and built-in/subagent availability gating.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import { BUILTIN_TOOL_NAMES } from "@linxiraos/zeta/tools/builtin-names";
import {
	BUILTIN_TOOLS,
	CalendarTool,
	type CalendarToolDetails,
	createTools,
	getProjectCalendarEventsDir,
	type Tool,
	type ToolSession,
} from "@linxiraos/zeta/tools";
import { TempDir } from "@linxiraos/pi-utils";

const tempDirs: TempDir[] = [];

function makeCwd(): string {
	const dir = TempDir.createSync("@zeta-calendar-tool-");
	tempDirs.push(dir);
	return dir.path();
}

function makeSession(cwd: string, extra: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: false,
		skipPythonPreflight: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({}),
		...extra,
	};
}

interface Clock {
	now: Date;
}

function makeTool(cwd: string, clock: Clock = { now: new Date("2026-11-09T12:00:00.000Z") }): CalendarTool {
	return new CalendarTool(makeSession(cwd), () => clock.now);
}

async function execute(tool: CalendarTool, params: Parameters<CalendarTool["execute"]>[1]) {
	const result = await tool.execute("call-1", params);
	return result.details as CalendarToolDetails;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await dir.remove();
});

describe("calendar create/get/update/delete", () => {
	it("creates an event with a stable id and stored timestamps", async () => {
		const cwd = makeCwd();
		const clock: Clock = { now: new Date("2026-11-09T12:00:00.000Z") };
		const tool = makeTool(cwd, clock);

		const created = await execute(tool, {
			action: "create",
			title: "Design review",
			start: "2026-11-10T09:00:00Z",
			end: "2026-11-10T10:00:00Z",
			location: "Room 4",
			notes: "Bring mockups",
			tags: ["design", "design", "review"],
			project: "zeta",
		});

		expect(created.action).toBe("create");
		expect(created.event?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(created.event?.title).toBe("Design review");
		expect(created.event?.allDay).toBe(false);
		expect(created.event?.tags).toEqual(["design", "review"]);
		expect(created.event?.project).toBe("zeta");
		expect(created.event?.createdAt).toBe("2026-11-09T12:00:00.000Z");
		expect(created.event?.updatedAt).toBe("2026-11-09T12:00:00.000Z");

		// One atomic JSON file per event, no leftover temp siblings.
		const files = await fs.readdir(getProjectCalendarEventsDir(cwd));
		expect(files).toEqual([`${created.event?.id}.json`]);
		expect(existsSync(path.join(getProjectCalendarEventsDir(cwd), `${created.event?.id}.json`))).toBe(true);

		const got = await execute(tool, { action: "get", id: created.event!.id });
		expect(got.event).toEqual(created.event!);
	});

	it("defaults allDay from a bare-date start and accepts a date-only end", async () => {
		const cwd = makeCwd();
		const tool = makeTool(cwd);
		const created = await execute(tool, {
			action: "create",
			title: "Holiday",
			start: "2026-12-24",
			end: "2026-12-26",
		});
		expect(created.event?.allDay).toBe(true);
		expect(created.event?.end).toBe("2026-12-26");
	});

	it("patches only supplied fields and bumps updatedAt while preserving createdAt", async () => {
		const cwd = makeCwd();
		const clock: Clock = { now: new Date("2026-11-09T12:00:00.000Z") };
		const tool = makeTool(cwd, clock);
		const created = await execute(tool, {
			action: "create",
			title: "Standup",
			start: "2026-11-10T09:00:00Z",
			end: "2026-11-10T09:15:00Z",
			location: "Room 1",
			notes: "daily",
			tags: ["team"],
		});
		const id = created.event!.id;

		clock.now = new Date("2026-11-09T13:30:00.000Z");
		const updated = await execute(tool, {
			action: "update",
			id,
			title: "Daily standup",
			end: "",
			location: "",
			tags: ["team", "sync"],
			allDay: false,
		});

		expect(updated.event?.id).toBe(id);
		expect(updated.event?.title).toBe("Daily standup");
		expect(updated.event?.end).toBeUndefined();
		expect(updated.event?.location).toBeUndefined();
		expect(updated.event?.notes).toBe("daily");
		expect(updated.event?.tags).toEqual(["team", "sync"]);
		expect(updated.event?.createdAt).toBe("2026-11-09T12:00:00.000Z");
		expect(updated.event?.updatedAt).toBe("2026-11-09T13:30:00.000Z");

		const got = await execute(tool, { action: "get", id });
		expect(got.event).toEqual(updated.event!);
	});

	it("deletes an event and reports a missing id afterwards", async () => {
		const cwd = makeCwd();
		const tool = makeTool(cwd);
		const created = await execute(tool, { action: "create", title: "One-off", start: "2026-11-11T10:00:00Z" });
		const id = created.event!.id;

		const deleted = await execute(tool, { action: "delete", id });
		expect(deleted.action).toBe("delete");
		expect(deleted.event?.title).toBe("One-off");
		expect(existsSync(path.join(getProjectCalendarEventsDir(cwd), `${id}.json`))).toBe(false);
		await expect(execute(tool, { action: "get", id })).rejects.toThrow(/not found/);
		await expect(execute(tool, { action: "delete", id })).rejects.toThrow(/not found/);
	});

	it("rejects a get/update/delete id that could escape the events directory", async () => {
		const cwd = makeCwd();
		const tool = makeTool(cwd);
		await expect(execute(tool, { action: "get", id: "../../package" })).rejects.toThrow(/invalid event id/);
		await expect(execute(tool, { action: "delete", id: "..\\x" })).rejects.toThrow(/invalid event id/);
	});
});

describe("calendar list and range filtering", () => {
	it("sorts by start and filters inclusive ranges, project labels, and limit", async () => {
		const cwd = makeCwd();
		const tool = makeTool(cwd);
		const late = await execute(tool, {
			action: "create",
			title: "Late",
			start: "2026-11-10T17:00:00Z",
			project: "alpha",
		});
		const early = await execute(tool, {
			action: "create",
			title: "Early",
			start: "2026-11-10T08:00:00Z",
			end: "2026-11-10T09:00:00Z",
			project: "beta",
		});
		const allDay = await execute(tool, {
			action: "create",
			title: "All day",
			start: "2026-11-12",
			project: "alpha",
		});

		const all = await execute(tool, { action: "list" });
		expect(all.events?.map(event => event.id)).toEqual([early.event!.id, late.event!.id, allDay.event!.id]);
		expect(all.count).toBe(3);

		const oneDay = await execute(tool, { action: "list", from: "2026-11-10", to: "2026-11-10" });
		expect(oneDay.events?.map(event => event.title)).toEqual(["Early", "Late"]);
		expect(oneDay.count).toBe(2);

		const instantWindow = await execute(tool, {
			action: "list",
			from: "2026-11-10T08:30:00Z",
			to: "2026-11-10T16:00:00Z",
		});
		expect(instantWindow.events?.map(event => event.title)).toEqual(["Early"]);

		const alpha = await execute(tool, { action: "list", project: "alpha" });
		expect(alpha.events?.map(event => event.title)).toEqual(["Late", "All day"]);

		const limited = await execute(tool, { action: "list", limit: 1 });
		expect(limited.events?.map(event => event.title)).toEqual(["Early"]);
		expect(limited.count).toBe(1);

		const allDayAfternoon = await execute(tool, {
			action: "list",
			from: "2026-11-12T12:00:00Z",
			to: "2026-11-12T18:00:00Z",
		});
		expect(allDayAfternoon.events?.map(event => event.title)).toEqual(["All day"]);

		const empty = await execute(tool, { action: "list", from: "2027-01-01" });
		expect(empty.events).toEqual([]);
	});

	it("returns an empty list when the project has no calendar yet", async () => {
		const details = await execute(makeTool(makeCwd()), { action: "list" });
		expect(details.events).toEqual([]);
		expect(details.count).toBe(0);
	});
});

describe("calendar ISO-8601 validation", () => {
	it.each([
		"not-a-date",
		"2026-02-30",
		"2026-13-01",
		"2026-11-09T09:00",
		"2026-11-09T24:00:00Z",
		"2026-11-09T09:00:00+15:00",
	])("rejects invalid start %s", async start => {
		await expect(execute(makeTool(makeCwd()), { action: "create", title: "Bad", start })).rejects.toThrow(
			/calendar:/,
		);
	});

	it("rejects an end that is not strictly after start", async () => {
		const tool = makeTool(makeCwd());
		await expect(
			execute(tool, {
				action: "create",
				title: "Backwards",
				start: "2026-11-10T10:00:00Z",
				end: "2026-11-10T09:00:00Z",
			}),
		).rejects.toThrow(/earlier than end/);
		await expect(
			execute(tool, { action: "create", title: "Zero", start: "2026-11-10", end: "2026-11-10" }),
		).rejects.toThrow(/earlier than end/);
	});

	it("rejects an inverted list range and a non-positive limit", async () => {
		const tool = makeTool(makeCwd());
		await expect(execute(tool, { action: "list", from: "2026-11-11", to: "2026-11-10" })).rejects.toThrow(
			/range is inverted/,
		);
		await expect(execute(tool, { action: "list", limit: 0 })).rejects.toThrow(/positive integer/);
	});

	it("rejects create without a title or start", async () => {
		const tool = makeTool(makeCwd());
		await expect(execute(tool, { action: "create", start: "2026-11-10" })).rejects.toThrow(
			/requires a non-empty "title"/,
		);
		await expect(execute(tool, { action: "create", title: "No start" })).rejects.toThrow(/requires a "start"/);
	});
});

describe("calendar project isolation", () => {
	it("keeps events inside the session cwd's own store", async () => {
		const cwdA = makeCwd();
		const cwdB = makeCwd();
		const created = await execute(makeTool(cwdA), {
			action: "create",
			title: "Project A only",
			start: "2026-11-10T09:00:00Z",
		});

		const filesA = await fs.readdir(path.join(cwdA, ".zeta", "calendar", "events"));
		expect(filesA).toEqual([`${created.event!.id}.json`]);
		expect(existsSync(path.join(cwdB, ".zeta"))).toBe(false);

		const listB = await execute(makeTool(cwdB), { action: "list" });
		expect(listB.events).toEqual([]);
		await expect(execute(makeTool(cwdB), { action: "get", id: created.event!.id })).rejects.toThrow(/not found/);
	});
});

describe("calendar built-in registration and availability", () => {
	const names = (tools: Tool[]): string[] => tools.map(tool => tool.name);

	it("is a registered built-in", () => {
		expect(BUILTIN_TOOL_NAMES).toContain("calendar");
		expect(typeof BUILTIN_TOOLS.calendar).toBe("function");
	});

	it("is offered to a top-level session by default", async () => {
		const xdevSession = makeSession(makeCwd());
		await createTools(xdevSession);
		// Discoverable built-ins mount under xd:// by default; the event tool is
		// still in the session's toolset as that device.
		expect(xdevSession.xdev?.mountedNames.has("calendar")).toBe(true);

		const topLevel = await createTools(
			makeSession(makeCwd(), { settings: Settings.isolated({ "tools.xdev": false }) }),
		);
		expect(names(topLevel)).toContain("calendar");
	});

	it("is withheld from a subagent without an explicit profile entry", async () => {
		const discovered = await createTools(makeSession(makeCwd(), { taskDepth: 1 }));
		expect(names(discovered)).not.toContain("calendar");

		const explicitOther = await createTools(makeSession(makeCwd(), { taskDepth: 1 }), ["read"]);
		expect(names(explicitOther)).not.toContain("calendar");
	});

	it("is granted to a subagent whose profile tools list names it, without IM tools", async () => {
		const tools = await createTools(makeSession(makeCwd(), { taskDepth: 1 }), ["read", "calendar"]);
		const toolNames = names(tools);
		expect(toolNames).toContain("calendar");
		expect(toolNames).not.toContain("channel_send");
		expect(toolNames).not.toContain("workspace_run");
		expect(toolNames).not.toContain("im_control");
	});
});
