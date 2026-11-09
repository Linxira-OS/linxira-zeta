/**
 * `calendar` — a real, file-backed calendar store for agent use.
 *
 * Events live in `<project>/.zeta/calendar/events/<id>.json`; the directory is
 * always derived from the session cwd, never from a model-supplied path. Writes
 * stage a sibling temp file and publish it with a single rename, and mutations
 * that read-modify-write take an OS-backed lease on the events directory.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import { isEnoent, isRecord, logger, prompt } from "@linxiraos/pi-utils";
import { getProjectAgentDir } from "@linxiraos/pi-utils/dirs";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";
import calendarDescription from "../prompts/tools/calendar.md" with { type: "text" };
import type { ToolSession } from ".";
import { replaceFileAtomically } from "../utils/atomic-file";

// =============================================================================
// Types
// =============================================================================

export type CalendarAction = "list" | "get" | "create" | "update" | "delete";

/** One stored event. Optional fields are absent, never `null`. */
export interface CalendarEvent {
	id: string;
	title: string;
	/** ISO-8601 instant (`YYYY-MM-DD` or a zoned date-time). */
	start: string;
	/** ISO-8601 instant, strictly after `start` when present. */
	end?: string;
	allDay: boolean;
	location?: string;
	notes?: string;
	tags?: string[];
	project?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CalendarToolDetails {
	action: CalendarAction;
	/** Directory holding this project's event files. */
	path: string;
	event?: CalendarEvent;
	events?: CalendarEvent[];
	count?: number;
}

/** `YYYY-MM-DD` — an all-day date with no time component. */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Zoned ISO date-time; a zone designator is mandatory so no instant is ambiguous. */
const DATE_TIME_RE =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):?(\d{2}))$/;

/** Event ids are UUID-shaped or caller-safe slugs; they never contain path separators. */
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const DAY_MS = 86_400_000;

// =============================================================================
// Store locations
// =============================================================================

/** `<project>/.zeta/calendar`. */
export function getProjectCalendarDir(cwd: string): string {
	return path.join(getProjectAgentDir(cwd), "calendar");
}

/** `<project>/.zeta/calendar/events`. */
export function getProjectCalendarEventsDir(cwd: string): string {
	return path.join(getProjectCalendarDir(cwd), "events");
}

// =============================================================================
// Validation
// =============================================================================

interface ParsedInstant {
	epochMs: number;
	/** True for a bare `YYYY-MM-DD` value. */
	dateOnly: boolean;
}

function assertDateParts(year: number, month: number, day: number, field: string, input: string): void {
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		throw new ToolError(`calendar: ${field} is not a valid date: "${input}"`, { field, value: input });
	}
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
		throw new ToolError(`calendar: ${field} is not a valid date: "${input}"`, { field, value: input });
	}
}

/**
 * Parse exactly one ISO-8601 instant: a bare `YYYY-MM-DD` date or a date-time
 * that carries a `Z`/`±HH:MM` zone. Component ranges are checked explicitly so
 * `2026-02-30` cannot roll over into March.
 *
 * @throws ToolError when `value` is not valid ISO-8601.
 */
export function parseCalendarInstant(value: string, field: string): ParsedInstant {
	const text = value.trim();
	if (text === "") {
		throw new ToolError(`calendar: ${field} must not be empty`, { field });
	}

	const dateOnly = DATE_ONLY_RE.exec(text);
	if (dateOnly) {
		const year = Number(dateOnly[1]);
		const month = Number(dateOnly[2]);
		const day = Number(dateOnly[3]);
		assertDateParts(year, month, day, field, text);
		return { epochMs: Date.UTC(year, month - 1, day), dateOnly: true };
	}

	const dateTime = DATE_TIME_RE.exec(text);
	if (!dateTime) {
		throw new ToolError(
			`calendar: ${field} must be an ISO-8601 date (YYYY-MM-DD) or zoned date-time (YYYY-MM-DDTHH:mm[:ss][.fff]Z or ±HH:MM): "${text}"`,
			{ field, value: text },
		);
	}

	const year = Number(dateTime[1]);
	const month = Number(dateTime[2]);
	const day = Number(dateTime[3]);
	const hour = Number(dateTime[4]);
	const minute = Number(dateTime[5]);
	const second = dateTime[6] === undefined ? 0 : Number(dateTime[6]);
	assertDateParts(year, month, day, field, text);
	if (hour > 23 || minute > 59 || second > 59) {
		throw new ToolError(`calendar: ${field} has an out-of-range time: "${text}"`, { field, value: text });
	}
	if (dateTime[9] !== undefined) {
		const offsetHours = Number(dateTime[9]);
		const offsetMinutes = Number(dateTime[10]);
		if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes > 0)) {
			throw new ToolError(`calendar: ${field} has an out-of-range UTC offset: "${text}"`, { field, value: text });
		}
	}

	const epochMs = Date.parse(text);
	if (!Number.isFinite(epochMs)) {
		throw new ToolError(`calendar: ${field} is not a valid ISO-8601 instant: "${text}"`, { field, value: text });
	}
	return { epochMs, dateOnly: false };
}

/** Compare `start` against the optional `end`, requiring `start < end`. */
function validateEventSpan(start: string, end: string | undefined): ParsedInstant {
	const parsedStart = parseCalendarInstant(start, "start");
	if (end !== undefined) {
		const parsedEnd = parseCalendarInstant(end, "end");
		if (parsedStart.epochMs >= parsedEnd.epochMs) {
			throw new ToolError(`calendar: start must be earlier than end ("${start}" >= "${end}")`, { start, end });
		}
	}
	return parsedStart;
}

/** Last millisecond of a date-only range bound; date-times are used as given. */
function rangeBound(value: string, field: string, edge: "from" | "to"): number {
	const parsed = parseCalendarInstant(value, field);
	return parsed.dateOnly && edge === "to" ? parsed.epochMs + DAY_MS - 1 : parsed.epochMs;
}

function eventInterval(event: CalendarEvent): { startMs: number; endMs: number } {
	const start = parseCalendarInstant(event.start, "start");
	if (event.end !== undefined) {
		return { startMs: start.epochMs, endMs: parseCalendarInstant(event.end, "end").epochMs };
	}
	// A bare-date all-day event occupies that whole day, so a range later on the
	// same day still overlaps it.
	const endMs = event.allDay && start.dateOnly ? start.epochMs + DAY_MS - 1 : start.epochMs;
	return { startMs: start.epochMs, endMs };
}

function assertEventId(id: string | undefined): string {
	if (id === undefined || id.trim() === "") {
		throw new ToolError('calendar: this action requires an "id"');
	}
	const trimmed = id.trim();
	if (!EVENT_ID_RE.test(trimmed)) {
		throw new ToolError(`calendar: invalid event id "${id}"`, { id });
	}
	return trimmed;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
	if (tags === undefined) return undefined;
	const normalized = [...new Set(tags.map(tag => tag.trim()).filter(tag => tag !== ""))];
	return normalized.length > 0 ? normalized : undefined;
}

/** Validate one stored payload; a malformed file is a hard error, not an empty event. */
function parseStoredEvent(raw: unknown, id: string): CalendarEvent {
	if (!isRecord(raw)) {
		throw new ToolError(`calendar: event "${id}" is corrupt (not a JSON object)`, { id });
	}
	const { title, start, end, allDay, location, notes, tags, project, createdAt, updatedAt } = raw;
	if (
		typeof title !== "string" ||
		typeof start !== "string" ||
		typeof allDay !== "boolean" ||
		typeof createdAt !== "string" ||
		typeof updatedAt !== "string" ||
		(end !== undefined && typeof end !== "string") ||
		(location !== undefined && typeof location !== "string") ||
		(notes !== undefined && typeof notes !== "string") ||
		(project !== undefined && typeof project !== "string") ||
		(tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string")))
	) {
		throw new ToolError(`calendar: event "${id}" is corrupt (unexpected field types)`, { id });
	}
	validateEventSpan(start, end);
	return {
		id,
		title,
		start,
		...(end !== undefined ? { end } : {}),
		allDay,
		...(location !== undefined ? { location } : {}),
		...(notes !== undefined ? { notes } : {}),
		...(tags !== undefined ? { tags: tags as string[] } : {}),
		...(project !== undefined ? { project } : {}),
		createdAt,
		updatedAt,
	};
}

// =============================================================================
// File I/O
// =============================================================================

function eventPath(eventsDir: string, id: string): string {
	return path.join(eventsDir, `${id}.json`);
}

async function ensureEventsDir(eventsDir: string): Promise<void> {
	await fs.mkdir(eventsDir, { recursive: true });
}

/** Stage `value` as JSON beside `filePath`, then publish it in one rename. */
async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	let removeTemp = false;
	try {
		const handle = await fs.open(tempPath, "wx", 0o600);
		removeTemp = true;
		try {
			await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await replaceFileAtomically(tempPath, filePath);
		removeTemp = false;
	} finally {
		if (removeTemp) await fs.rm(tempPath, { force: true }).catch(() => {});
	}
}

async function readEventFile(eventsDir: string, id: string): Promise<CalendarEvent> {
	let raw: unknown;
	try {
		raw = await Bun.file(eventPath(eventsDir, id)).json();
	} catch (error) {
		if (isEnoent(error)) {
			throw new ToolError(`calendar: event "${id}" not found`, { id });
		}
		throw new ToolError(
			`calendar: cannot read event "${id}": ${error instanceof Error ? error.message : String(error)}`,
			{ id },
		);
	}
	return parseStoredEvent(raw, id);
}

async function readAllEvents(eventsDir: string): Promise<CalendarEvent[]> {
	let names: string[];
	try {
		names = await fs.readdir(eventsDir);
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	const events: CalendarEvent[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -".json".length);
		if (!EVENT_ID_RE.test(id)) continue;
		try {
			events.push(await readEventFile(eventsDir, id));
		} catch (error) {
			logger.warn("calendar: skipping unreadable event file", {
				path: path.join(eventsDir, name),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return events;
}

// =============================================================================
// Operations
// =============================================================================

async function createEventFromParams(eventsDir: string, params: CalendarParams, now: Date): Promise<CalendarEvent> {
	const title = params.title?.trim();
	if (!title) {
		throw new ToolError('calendar: create requires a non-empty "title"');
	}
	if (params.start === undefined) {
		throw new ToolError('calendar: create requires a "start"');
	}
	const parsedStart = validateEventSpan(params.start.trim(), normalizeOptionalText(params.end));
	const timestamp = now.toISOString();
	const event: CalendarEvent = {
		id: randomUUID(),
		title,
		start: params.start.trim(),
		...(normalizeOptionalText(params.end) !== undefined ? { end: normalizeOptionalText(params.end) } : {}),
		allDay: params.allDay ?? parsedStart.dateOnly,
		...(normalizeOptionalText(params.location) !== undefined
			? { location: normalizeOptionalText(params.location) }
			: {}),
		...(normalizeOptionalText(params.notes) !== undefined ? { notes: normalizeOptionalText(params.notes) } : {}),
		...(normalizeTags(params.tags) !== undefined ? { tags: normalizeTags(params.tags) } : {}),
		...(normalizeOptionalText(params.project) !== undefined
			? { project: normalizeOptionalText(params.project) }
			: {}),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	await ensureEventsDir(eventsDir);
	await writeJsonFileAtomically(eventPath(eventsDir, event.id), event);
	return event;
}

async function updateEventFromParams(
	eventsDir: string,
	id: string,
	params: CalendarParams,
	now: Date,
): Promise<CalendarEvent> {
	await ensureEventsDir(eventsDir);
	return await withFileLock(path.join(eventsDir, ".lock"), async () => {
		const existing = await readEventFile(eventsDir, id);
		const next: CalendarEvent = { ...existing };

		if (params.title !== undefined) {
			const title = params.title.trim();
			if (!title) throw new ToolError('calendar: update "title" must not be empty', { id });
			next.title = title;
		}
		if (params.start !== undefined) next.start = params.start.trim();
		if (params.end !== undefined) {
			const end = normalizeOptionalText(params.end);
			if (end === undefined) delete next.end;
			else next.end = end;
		}
		if (params.allDay !== undefined) next.allDay = params.allDay;
		if (params.location !== undefined) {
			const location = normalizeOptionalText(params.location);
			if (location === undefined) delete next.location;
			else next.location = location;
		}
		if (params.notes !== undefined) {
			const notes = normalizeOptionalText(params.notes);
			if (notes === undefined) delete next.notes;
			else next.notes = notes;
		}
		if (params.tags !== undefined) {
			const tags = normalizeTags(params.tags);
			if (tags === undefined) delete next.tags;
			else next.tags = tags;
		}
		if (params.project !== undefined) {
			const project = normalizeOptionalText(params.project);
			if (project === undefined) delete next.project;
			else next.project = project;
		}

		validateEventSpan(next.start, next.end);
		next.updatedAt = now.toISOString();
		await writeJsonFileAtomically(eventPath(eventsDir, id), next);
		return next;
	});
}

async function deleteEvent(eventsDir: string, id: string): Promise<CalendarEvent> {
	await ensureEventsDir(eventsDir);
	return await withFileLock(path.join(eventsDir, ".lock"), async () => {
		const existing = await readEventFile(eventsDir, id);
		await fs.rm(eventPath(eventsDir, id), { force: true });
		return existing;
	});
}

interface ListFilter {
	fromMs?: number;
	toMs?: number;
	project?: string;
	limit?: number;
}

function listFilterFromParams(params: CalendarParams): ListFilter {
	const fromMs = params.from !== undefined ? rangeBound(params.from, "from", "from") : undefined;
	const toMs = params.to !== undefined ? rangeBound(params.to, "to", "to") : undefined;
	if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
		throw new ToolError(
			`calendar: list range is inverted ("from" is after "to": "${params.from}" > "${params.to}")`,
			{ from: params.from, to: params.to },
		);
	}
	if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) {
		throw new ToolError('calendar: list "limit" must be a positive integer', { limit: params.limit });
	}
	return {
		...(fromMs !== undefined ? { fromMs } : {}),
		...(toMs !== undefined ? { toMs } : {}),
		...(normalizeOptionalText(params.project) !== undefined
			? { project: normalizeOptionalText(params.project) }
			: {}),
		...(params.limit !== undefined ? { limit: params.limit } : {}),
	};
}

function filterEvents(events: CalendarEvent[], filter: ListFilter): CalendarEvent[] {
	const matched = events.filter(event => {
		if (filter.project !== undefined && event.project !== filter.project) return false;
		const { startMs, endMs } = eventInterval(event);
		if (filter.fromMs !== undefined && endMs < filter.fromMs) return false;
		if (filter.toMs !== undefined && startMs > filter.toMs) return false;
		return true;
	});
	matched.sort((left, right) => {
		const delta = eventInterval(left).startMs - eventInterval(right).startMs;
		return delta !== 0 ? delta : left.id.localeCompare(right.id);
	});
	return filter.limit !== undefined ? matched.slice(0, filter.limit) : matched;
}

function formatEvent(event: CalendarEvent): string {
	const when =
		event.allDay && event.end === undefined
			? `all day ${event.start}`
			: event.end !== undefined
				? `${event.start} → ${event.end}`
				: event.start;
	const extras = [
		event.location !== undefined ? `@${event.location}` : undefined,
		event.project !== undefined ? `[${event.project}]` : undefined,
		event.tags !== undefined && event.tags.length > 0 ? event.tags.map(tag => `#${tag}`).join(" ") : undefined,
	].filter((part): part is string => part !== undefined);
	return `${when} | ${event.title} (${event.id})${extras.length > 0 ? ` ${extras.join(" ")}` : ""}`;
}

// =============================================================================
// Tool
// =============================================================================

const calendarSchema = type({
	action: type('"list" | "get" | "create" | "update" | "delete"').describe(
		"list: query this project's events; get/update/delete: target one event by id; create: add an event",
	),
	"id?": type("string").describe("event id (required for get, update, delete)"),
	"title?": type("string").describe("event title (required for create)"),
	"start?": type("string").describe(
		"ISO-8601 start (required for create): YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss][.fff]Z / ±HH:MM",
	),
	"end?": type("string").describe("ISO-8601 end, strictly after start; empty string clears it on update"),
	"allDay?": type("boolean").describe("whether the event spans the whole day; defaults to start being date-only"),
	"location?": type("string").describe("free-form location; empty string clears it on update"),
	"notes?": type("string").describe("free-form notes; empty string clears it on update"),
	"tags?": type("string").array().describe("tags; an empty array clears them on update"),
	"project?": type("string").describe("project label stored on the event (create/update) or used as a list filter"),
	"from?": type("string").describe("list range start, inclusive (ISO-8601)"),
	"to?": type("string").describe("list range end, inclusive (ISO-8601; a bare date covers that whole day)"),
	"limit?": type("number").describe("maximum number of events to return from list"),
}).describe("read and mutate this project's calendar events");

export type CalendarParams = typeof calendarSchema.infer;

/** File-backed calendar scoped to the session project's `.zeta/calendar` store. */
export class CalendarTool implements AgentTool<typeof calendarSchema, CalendarToolDetails> {
	readonly name = "calendar";
	readonly label = "Calendar";
	readonly summary = "List, inspect, create, update, and delete calendar events";
	readonly description = prompt.render(calendarDescription);
	readonly parameters = calendarSchema;
	readonly approval = "read" as const;
	readonly strict = true;
	readonly loadMode = "discoverable" as const;
	// Update/delete read-modify-write one store; sibling calls must not interleave.
	readonly concurrency = "exclusive";

	readonly #session: ToolSession;
	readonly #now: () => Date;

	constructor(session: ToolSession, now: () => Date = () => new Date()) {
		this.#session = session;
		this.#now = now;
	}

	async execute(_toolCallId: string, params: CalendarParams): Promise<AgentToolResult<CalendarToolDetails>> {
		const eventsDir = getProjectCalendarEventsDir(this.#session.cwd);
		const now = this.#now();

		switch (params.action) {
			case "list": {
				const filter = listFilterFromParams(params);
				const events = filterEvents(await readAllEvents(eventsDir), filter);
				const text =
					events.length === 0
						? "No calendar events."
						: `Calendar events (${events.length}):\n${events.map(event => `- ${formatEvent(event)}`).join("\n")}`;
				return {
					content: [{ type: "text", text }],
					details: { action: "list", path: eventsDir, events, count: events.length },
				};
			}
			case "get": {
				const id = assertEventId(params.id);
				const event = await readEventFile(eventsDir, id);
				return {
					content: [{ type: "text", text: formatEvent(event) }],
					details: { action: "get", path: eventsDir, event },
				};
			}
			case "create": {
				const event = await createEventFromParams(eventsDir, params, now);
				return {
					content: [{ type: "text", text: `Created calendar event ${event.id}: ${formatEvent(event)}` }],
					details: { action: "create", path: eventsDir, event },
				};
			}
			case "update": {
				const id = assertEventId(params.id);
				const event = await updateEventFromParams(eventsDir, id, params, now);
				return {
					content: [{ type: "text", text: `Updated calendar event ${event.id}: ${formatEvent(event)}` }],
					details: { action: "update", path: eventsDir, event },
				};
			}
			case "delete": {
				const id = assertEventId(params.id);
				const event = await deleteEvent(eventsDir, id);
				return {
					content: [{ type: "text", text: `Deleted calendar event ${event.id}: ${event.title}` }],
					details: { action: "delete", path: eventsDir, event },
				};
			}
			default:
				throw new ToolError(`calendar: unknown action "${String(params.action)}"`);
		}
	}
}
