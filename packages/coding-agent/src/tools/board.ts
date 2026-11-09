import type { AgentTool, AgentToolResult, ToolApprovalDecision } from "@linxiraos/pi-agent-core";
import type { Component } from "@linxiraos/pi-tui";
import { Text } from "@linxiraos/pi-tui";
import { ToolError } from "@linxiraos/pi-tui/tools/tool-errors";
import { type } from "@linxiraos/zeta-schema";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import boardDescription from "../prompts/tools/board.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import {
	BoardFormatError,
	BoardInputError,
	type BoardCard,
	type BoardWarning,
	NotFoundError,
	briefFor,
	createCard,
	deleteCard,
	getCard,
	loadBoard,
	moveCard,
	updateCard,
} from "./board-store";

const BoardAction = type('"list" | "get" | "create" | "update" | "move" | "assign" | "delete"');
const BoardColumnEnum = type('"todo" | "doing" | "done"');
const BoardAssigneeEnum = type('"user" | "agent"');

const boardSchema = type({
	action: BoardAction.describe("operation to perform"),
	"id?": type("string").describe("card id (the file stem, e.g. fix-the-parser)"),
	"title?": type("string").describe("card title (create/update)"),
	"description?": type("string").describe("card description/brief in markdown; alias of body (create/update)"),
	"body?": type("string").describe("card description/brief in markdown (create/update)"),
	"column?": BoardColumnEnum.describe('card status column (create; update uses action "move")'),
	"status?": BoardColumnEnum.describe("alias of column (create)"),
	"assignee?": BoardAssigneeEnum.describe("card owner: user or agent (create/assign)"),
	"owner?": BoardAssigneeEnum.describe("alias of assignee (create/assign)"),
	"tags?": type("string").array().describe("card tags (create/update)"),
	"due?": type("string").describe("due date YYYY-MM-DD; empty string clears it (create/update)"),
	"tag?": type("string").describe("list filter: only cards carrying this tag"),
});

export type BoardParams = typeof boardSchema.infer;
export type BoardAction = BoardParams["action"];

export interface BoardToolDetails {
	action: BoardAction;
	cwd: string;
	message: string;
	card?: BoardCard;
	cards?: BoardCard[];
	warnings?: BoardWarning[];
}

/** Parse a card id-shaped value from the model before touching the store. */
function requireId(value: string | undefined): string {
	const id = value?.trim() ?? "";
	if (id === "") throw new ToolError("board requires a card id.");
	return id;
}

/**
 * Resolve a field that has a store-native name and a model-friendly alias.
 * Both spellings reach the same store field, so disagreeing values are a
 * caller error rather than a silent pick.
 */
function resolveAlias<T>(
	primary: T | undefined,
	alias: T | undefined,
	primaryName: string,
	aliasName: string,
): T | undefined {
	if (primary !== undefined && alias !== undefined && primary !== alias) {
		throw new ToolError(`board received both ${primaryName} and ${aliasName} with different values.`);
	}
	return primary ?? alias;
}

function cardLine(card: BoardCard): string {
	const facts = [`[${card.column}]`, card.id, `— ${card.title}`, `(${card.assignee}`];
	if (card.tags.length > 0) facts.push(`, ${card.tags.join(", ")}`);
	if (card.due) facts.push(`, due ${card.due}`);
	facts.push(")");
	return facts.join(" ");
}

/** Translate store errors into the tool's error type, preserving the message. */
function asToolError(error: unknown): ToolError {
	if (error instanceof ToolError) return error;
	if (error instanceof BoardInputError) return new ToolError(error.message);
	if (error instanceof BoardFormatError) return new ToolError(`not a board card: ${error.message}`);
	if (error instanceof NotFoundError) return new ToolError("card not found");
	return new ToolError(error instanceof Error ? error.message : String(error));
}

/**
 * The user board (`.zeta/board/`): project-scoped cards that outlive a
 * session. The card file is the truth; this tool and the web API share one
 * store.
 */
export class BoardTool implements AgentTool<typeof boardSchema, BoardToolDetails> {
	readonly name = "board";
	readonly label = "Board";
	readonly description = boardDescription;
	readonly parameters = boardSchema;
	readonly strict = false;
	readonly loadMode = "discoverable" as const;
	readonly concurrency = "exclusive";
	readonly summary = "Read and edit project board cards under .zeta/board/";
	readonly approval = (args: unknown): ToolApprovalDecision => {
		if (args === null || typeof args !== "object" || !("action" in args)) return "write";
		const action = args.action;
		return action === "list" || action === "get" ? "read" : "write";
	};

	constructor(private readonly session: ToolSession) {}

	async execute(_id: string, params: BoardParams): Promise<AgentToolResult<BoardToolDetails>> {
		const root = this.session.cwd;
		const column = resolveAlias(params.column, params.status, "column", "status");
		const assignee = resolveAlias(params.assignee, params.owner, "assignee", "owner");
		const body = resolveAlias(params.body, params.description, "body", "description");

		try {
			switch (params.action) {
				case "list": {
					const { cards, warnings } = await loadBoard(root);
					const filtered = cards.filter(card => {
						if (column !== undefined && card.column !== column) return false;
						if (assignee !== undefined && card.assignee !== assignee) return false;
						if (params.tag !== undefined && !card.tags.includes(params.tag)) return false;
						return true;
					});
					const text =
						filtered.length === 0
							? "(the board has no matching cards)"
							: filtered.map(card => cardLine(card)).join("\n");
					return {
						content: [{ type: "text", text }],
						details: { action: "list", cwd: root, message: text, cards: filtered, warnings },
					};
				}

				case "get": {
					const id = requireId(params.id);
					const card = await getCard(root, id);
					const text = briefFor(card);
					return {
						content: [{ type: "text", text }],
						details: { action: "get", cwd: root, message: text, card },
					};
				}

				case "create": {
					const card = await createCard(root, {
						title: params.title,
						column,
						tags: params.tags,
						assignee,
						due: params.due,
						body,
					});
					const message = `Created card ${card.id} in ${card.column}.`;
					return {
						content: [{ type: "text", text: `${message}\n\n${briefFor(card)}` }],
						details: { action: "create", cwd: root, message, card },
					};
				}

				case "update": {
					const id = requireId(params.id);
					if (column !== undefined) {
						throw new ToolError('board update cannot change the column; use action "move".');
					}
					if (
						params.title === undefined &&
						body === undefined &&
						params.tags === undefined &&
						assignee === undefined &&
						params.due === undefined
					) {
						throw new ToolError(
							"board update requires at least one of title, description, tags, assignee or due.",
						);
					}
					const card = await updateCard(root, id, {
						title: params.title,
						tags: params.tags,
						assignee,
						due: params.due,
						body,
					});
					const message = `Updated card ${card.id}.`;
					return {
						content: [{ type: "text", text: `${message}\n\n${briefFor(card)}` }],
						details: { action: "update", cwd: root, message, card },
					};
				}

				case "move": {
					const id = requireId(params.id);
					if (column === undefined)
						throw new ToolError('board move requires a column ("todo", "doing" or "done").');
					const card = await moveCard(root, id, column);
					const message = `Moved card ${card.id} to ${card.column}.`;
					return {
						content: [{ type: "text", text: message }],
						details: { action: "move", cwd: root, message, card },
					};
				}

				case "assign": {
					const id = requireId(params.id);
					if (assignee === undefined)
						throw new ToolError('board assign requires an assignee ("user" or "agent").');
					const card = await updateCard(root, id, { assignee });
					const message = `Assigned card ${card.id} to ${card.assignee}.`;
					return {
						content: [{ type: "text", text: message }],
						details: { action: "assign", cwd: root, message, card },
					};
				}

				case "delete": {
					const id = requireId(params.id);
					await deleteCard(root, id);
					const message = `Deleted card ${id}.`;
					return {
						content: [{ type: "text", text: message }],
						details: { action: "delete", cwd: root, message },
					};
				}
			}
		} catch (error) {
			throw asToolError(error);
		}
	}

	render(result: AgentToolResult<BoardToolDetails>, _opts: RenderResultOptions): Component | null {
		const details = result.details;
		if (!details) return null;
		return new Text(details.message);
	}
}
