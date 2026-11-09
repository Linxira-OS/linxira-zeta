/**
 * The user board store (`.zeta/board/`), backing the web gateway's
 * `/api/board*` routes and the built-in `board` tool. The GUI and IDE panels
 * read and write the same card files; this module owns the format for the
 * TypeScript side.
 *
 * One markdown file per card; the file is the only truth. A card edited in a
 * text editor is the card the next read returns:
 *
 * ```markdown
 * ---
 * title: Fix the parser
 * column: doing
 * tags: [rust, parser]
 * assignee: agent
 * due: 2026-11-01
 * ---
 *
 * The brief handed to an agent.
 * ```
 *
 * The store owns parsing, validation and file writes. The HTTP routes stay in
 * `../server/web-gateway/board.ts`; this module is deliberately free of
 * `Request`/`Response` so a tool can import it without pulling in the gateway.
 */

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type BoardColumn = "todo" | "doing" | "done";
export type BoardAssignee = "user" | "agent";

/** Columns in board order. */
export const BOARD_COLUMNS: readonly BoardColumn[] = ["todo", "doing", "done"];

/** One card as the API returns it. `id` is the file stem. */
export interface BoardCard {
	id: string;
	title: string;
	column: BoardColumn;
	tags: string[];
	assignee: BoardAssignee;
	due: string | null;
	body: string;
	/** `.zeta/board/<id>.md`, relative to `cwd`. */
	file: string;
}

/** A `.md` file under the board directory that is not a usable card. */
export interface BoardWarning {
	file: string;
	reason: string;
}

/** The card plus the hand-added front-matter keys an update must preserve. */
export interface StoredCard extends BoardCard {
	extra: Array<[string, string]>;
}

/** A card file that cannot be parsed (422 to an API caller). */
export class BoardFormatError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "BoardFormatError";
	}
}

/** A request field or id the board will not accept (400 to an API caller). */
export class BoardInputError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "BoardInputError";
	}
}

/** The caller named a card that is not there. */
export class NotFoundError extends Error {
	constructor() {
		super("card not found");
		this.name = "NotFoundError";
	}
}

const ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const MAX_ID = 80;
const MAX_FILE = 512 * 1024;
const MAX_BODY = 64 * 1024;
const MAX_TITLE = 200;
const MAX_TAGS = 20;
const MAX_TAG = 40;
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `<root>/.zeta/board`. */
export function boardDir(root: string): string {
	return path.join(root, ".zeta", "board");
}

/** Whether `id` is a file stem this module will touch. */
export function isValidId(id: string): boolean {
	return id.length > 0 && id.length <= MAX_ID && !id.startsWith(".") && ID_RE.test(id);
}

/** The absolute path of a card, refusing anything that leaves the board. */
function cardPath(root: string, id: string): string {
	if (!isValidId(id)) throw new BoardInputError("invalid card id");
	const directory = path.resolve(boardDir(root));
	const resolved = path.resolve(directory, `${id}.md`);
	if (path.dirname(resolved) !== directory) throw new BoardInputError("invalid card id");
	return resolved;
}

/** Strip one pair of matching quotes. */
function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
	}
	return value;
}

/** Fold a value onto one line so it cannot break the front matter. */
function oneLine(value: string): string {
	return value.split(/\s+/).filter(Boolean).join(" ");
}

function parseTags(value: string): string[] {
	let inner = value.trim();
	if (inner.startsWith("[") && inner.endsWith("]")) inner = inner.slice(1, -1);
	return inner
		.split(",")
		.map(tag => unquote(tag.trim()))
		.filter(tag => tag.length > 0);
}

/**
 * Parse a card file. The front matter must open and close with `---` and
 * carry a non-empty `title`; `column` defaults to `todo` and `assignee` to
 * `user`, because a card written by hand with only a title is still a card.
 */
export function parseCard(id: string, text: string): StoredCard {
	if (!isValidId(id)) throw new BoardFormatError("invalid card id");
	const source = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n/g, "\n");
	const lines = source.split("\n");
	if ((lines[0] ?? "").trim() !== "---") throw new BoardFormatError("missing front matter");

	let title: string | null = null;
	let column: BoardColumn = "todo";
	let tags: string[] = [];
	let assignee: BoardAssignee = "user";
	let due: string | null = null;
	const extra: Array<[string, string]> = [];
	let closed = false;
	let index = 1;
	for (; index < lines.length; index++) {
		const line = lines[index].trim();
		if (line === "---") {
			closed = true;
			break;
		}
		if (line === "" || line.startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon <= 0) throw new BoardFormatError(`front matter line is not \`key: value\`: ${line}`);
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = unquote(line.slice(colon + 1).trim());
		switch (key) {
			case "title":
				title = value;
				break;
			case "column":
				if (!BOARD_COLUMNS.includes(value.toLowerCase() as BoardColumn)) {
					throw new BoardFormatError(`unknown column \`${value}\` (todo, doing or done)`);
				}
				column = value.toLowerCase() as BoardColumn;
				break;
			case "tags":
				tags = parseTags(value);
				break;
			case "assignee":
				if (value.toLowerCase() !== "user" && value.toLowerCase() !== "agent") {
					throw new BoardFormatError(`unknown assignee \`${value}\` (user or agent)`);
				}
				assignee = value.toLowerCase() as BoardAssignee;
				break;
			case "due":
				due = value === "" ? null : value;
				break;
			default:
				extra.push([key, value]);
		}
	}
	if (!closed) throw new BoardFormatError("front matter is not closed with ---");
	const normalizedTitle = (title ?? "").trim();
	if (normalizedTitle === "") throw new BoardFormatError("front matter has no title");
	const body = lines
		.slice(index + 1)
		.join("\n")
		.replace(/^\n+/, "")
		.trimEnd();
	return {
		id,
		title: normalizedTitle,
		column,
		tags,
		assignee,
		due,
		body,
		file: `.zeta/board/${id}.md`,
		extra,
	};
}

/** Render a card in the canonical form {@link writeCardFile} writes. */
export function renderCard(card: StoredCard): string {
	let out = "---\n";
	out += `title: ${oneLine(card.title)}\n`;
	out += `column: ${card.column}\n`;
	if (card.tags.length > 0) out += `tags: [${card.tags.join(", ")}]\n`;
	out += `assignee: ${card.assignee}\n`;
	if (card.due) out += `due: ${oneLine(card.due)}\n`;
	for (const [key, value] of card.extra) out += `${key}: ${value}\n`;
	out += "---\n";
	const body = card.body.replace(/^\n+/, "").trimEnd();
	if (body !== "") out += `\n${body}\n`;
	return out;
}

/** Public shape: the API never exposes `extra`. */
function publicCard(card: StoredCard): BoardCard {
	const { extra: _extra, ...rest } = card;
	return rest;
}

async function writeCardFile(root: string, card: StoredCard): Promise<void> {
	const target = cardPath(root, card.id);
	await mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.tmp`;
	await writeFile(temp, renderCard(card), "utf8");
	await rename(temp, target);
}

/** Read every card under `root`'s board directory. */
export async function loadBoard(root: string): Promise<{ cards: BoardCard[]; warnings: BoardWarning[] }> {
	const directory = boardDir(root);
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { cards: [], warnings: [] };
		throw error;
	}
	const cards: BoardCard[] = [];
	const warnings: BoardWarning[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const name = entry.name;
		if (name.startsWith(".") || !name.endsWith(".md")) continue;
		const id = name.slice(0, -3);
		if (!isValidId(id)) {
			warnings.push({ file: name, reason: "file name is not a card id" });
			continue;
		}
		try {
			const text = await readFile(path.join(directory, name), "utf8");
			if (Buffer.byteLength(text, "utf8") > MAX_FILE) {
				warnings.push({ file: name, reason: "file is too large to be a card" });
				continue;
			}
			cards.push(publicCard(parseCard(id, text)));
		} catch (error) {
			warnings.push({
				file: name,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	cards.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	warnings.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
	return { cards, warnings };
}

/** Read one card, including the hand-added keys an update preserves. */
export async function readCard(root: string, id: string): Promise<StoredCard> {
	const target = cardPath(root, id);
	let text: string;
	try {
		text = await readFile(target, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError();
		throw error;
	}
	return parseCard(id, text);
}

/** Read one card in its public shape. */
export async function getCard(root: string, id: string): Promise<BoardCard> {
	return publicCard(await readCard(root, id));
}

/** A title-safe file stem: lowercase ASCII alphanumerics, `-` between words,
 * capped at 40 characters. A title with no ASCII letters or digits gets a
 * stable short hash, so two Chinese-only titles never share `card`. */
export function slugify(title: string): string {
	let slug = "";
	let pendingDash = false;
	for (const character of title) {
		if (/[A-Za-z0-9]/.test(character)) {
			if (pendingDash && slug !== "") slug += "-";
			pendingDash = false;
			slug += character.toLowerCase();
			if (slug.length >= 40) break;
		} else if (slug !== "") {
			pendingDash = true;
		}
	}
	slug = slug.replace(/-+$/, "");
	if (slug !== "") return slug;
	let hash = 2166136261;
	for (const byte of Buffer.from(title, "utf8")) {
		hash ^= byte;
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return `card-${(hash & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Whether `value` is a real calendar date, not a rolled-over one. */
function isRealDate(value: string): boolean {
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Validated card input; shared by create and update. */
export interface CardInput {
	title?: unknown;
	column?: unknown;
	tags?: unknown;
	assignee?: unknown;
	due?: unknown;
	body?: unknown;
}

export interface ValidatedCard {
	title?: string;
	column?: BoardColumn;
	tags?: string[];
	assignee?: BoardAssignee;
	due?: string | null;
	body?: string;
}

/** Reject a request field that would not survive the format. */
export function validateInput(input: CardInput): ValidatedCard {
	const out: ValidatedCard = {};
	if (input.title !== undefined) {
		if (typeof input.title !== "string") throw new BoardInputError("title must be a string");
		const title = oneLine(input.title);
		if (title === "") throw new BoardInputError("title must not be empty");
		if (title.length > MAX_TITLE) throw new BoardInputError(`title is longer than ${MAX_TITLE}`);
		out.title = title;
	}
	if (input.column !== undefined) {
		if (typeof input.column !== "string" || !BOARD_COLUMNS.includes(input.column as BoardColumn)) {
			throw new BoardInputError("column must be one of todo, doing, done");
		}
		out.column = input.column as BoardColumn;
	}
	if (input.tags !== undefined) {
		if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== "string")) {
			throw new BoardInputError("tags must be an array of strings");
		}
		if (input.tags.length > MAX_TAGS) throw new BoardInputError(`at most ${MAX_TAGS} tags`);
		out.tags = input.tags.map(tag => oneLine(tag as string)).filter(tag => tag !== "");
		if (out.tags.some(tag => tag.length > MAX_TAG || /[,[\]\n]/.test(tag))) {
			throw new BoardInputError("a tag is too long or carries a comma/bracket");
		}
	}
	if (input.assignee !== undefined) {
		if (input.assignee !== "user" && input.assignee !== "agent") {
			throw new BoardInputError("assignee must be user or agent");
		}
		out.assignee = input.assignee;
	}
	if (input.due !== undefined) {
		if (input.due === null || input.due === "") {
			out.due = null;
		} else if (typeof input.due !== "string" || !DUE_RE.test(input.due)) {
			throw new BoardInputError("due must be YYYY-MM-DD");
		} else if (!isRealDate(input.due)) {
			throw new BoardInputError("due is not a real date");
		} else {
			out.due = input.due;
		}
	}
	if (input.body !== undefined) {
		if (typeof input.body !== "string") throw new BoardInputError("body must be a string");
		if (input.body.length > MAX_BODY) throw new BoardInputError(`body is longer than ${MAX_BODY}`);
		out.body = input.body.trimEnd();
	}
	return out;
}

/** Create a card file and return it. The id is a slug of the title. */
export async function createCard(root: string, input: CardInput): Promise<BoardCard> {
	const validated = validateInput(input);
	if (validated.title === undefined) throw new BoardInputError("a card needs a title");
	const directory = boardDir(root);
	await mkdir(directory, { recursive: true });
	const base = slugify(validated.title);
	const existing = new Set(await readdir(directory));
	let candidate = base;
	let suffix = 2;
	while (existing.has(`${candidate}.md`)) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	const card: StoredCard = {
		id: candidate,
		title: validated.title,
		column: validated.column ?? "todo",
		tags: validated.tags ?? [],
		assignee: validated.assignee ?? "user",
		due: validated.due ?? null,
		body: validated.body ?? "",
		file: `.zeta/board/${candidate}.md`,
		extra: [],
	};
	await writeCardFile(root, card);
	return publicCard(card);
}

/** Update a card in place. The id (file name) never changes. */
export async function updateCard(root: string, id: string, input: CardInput): Promise<BoardCard> {
	const current = await readCard(root, id);
	const validated = validateInput(input);
	const next: StoredCard = {
		...current,
		...(validated.title !== undefined ? { title: validated.title } : {}),
		...(validated.column !== undefined ? { column: validated.column } : {}),
		...(validated.tags !== undefined ? { tags: validated.tags } : {}),
		...(validated.assignee !== undefined ? { assignee: validated.assignee } : {}),
		...(validated.due !== undefined ? { due: validated.due } : {}),
		...(validated.body !== undefined ? { body: validated.body } : {}),
	};
	await writeCardFile(root, next);
	return publicCard(next);
}

/** Move a card between columns. */
export async function moveCard(root: string, id: string, column: unknown): Promise<BoardCard> {
	if (typeof column !== "string" || !BOARD_COLUMNS.includes(column as BoardColumn)) {
		throw new BoardInputError("column must be one of todo, doing, done");
	}
	return updateCard(root, id, { column });
}

/** Delete a card file. */
export async function deleteCard(root: string, id: string): Promise<void> {
	const target = cardPath(root, id);
	try {
		await rm(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError();
		throw error;
	}
}

/** The brief an agent session starts from: title, facts, then the body. */
export function briefFor(card: BoardCard): string {
	let out = `# ${oneLine(card.title)}\n\n`;
	out += `- column: ${card.column}\n`;
	if (card.tags.length > 0) out += `- tags: ${card.tags.join(", ")}\n`;
	out += `- assignee: ${card.assignee}\n`;
	if (card.due) out += `- due: ${card.due}\n`;
	const body = card.body.trim();
	if (body !== "") out += `\n${body}\n`;
	return out;
}

/**
 * Read a card for hand-off, optionally recording that it now belongs to the
 * agent. Returns the public card and its brief; starts no session.
 */
export async function handoffCard(
	root: string,
	id: string,
	assign: boolean,
): Promise<{ card: BoardCard; brief: string }> {
	const current = await readCard(root, id);
	const next = assign && current.assignee !== "agent" ? { ...current, assignee: "agent" as BoardAssignee } : current;
	if (next !== current) await writeCardFile(root, next);
	const card = publicCard(next);
	return { card, brief: briefFor(card) };
}
