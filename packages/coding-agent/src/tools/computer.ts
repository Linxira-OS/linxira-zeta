import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolApprovalDecision,
} from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { isClaudeModelId } from "@oh-my-pi/pi-catalog/identity";
import type { DesktopCapabilities } from "@oh-my-pi/pi-natives";
import { once, prompt } from "@oh-my-pi/pi-utils";
import { type Type, type } from "arktype";
import { callSessionTool } from "../eval/js/tool-bridge";
import computerDescription from "../prompts/tools/computer.md" with { type: "text" };
import { enforceInlineByteCap } from "../session/streaming-output";
import { truncateForPrompt } from "./approval";
import type { ComputerScreenshot, ComputerSessionSnapshot } from "./computer/protocol";
import { type ComputerController, ComputerSupervisor, registerComputerController } from "./computer/supervisor";
import type { ToolSession } from "./index";
import { ToolError, throwIfAborted } from "./tool-errors";
import { clampTimeout } from "./tool-timeouts";

// Image transports that cannot preserve native screenshot detail resize frames
// without returning transformed dimensions. Keep their native coordinate frames
// below the empirically verified threshold so pointer actions match what the
// model sees. Claude paths predate the resolved transport capability and retain
// their established model-family fallback.
const COORDINATE_SAFE_MAX_CAPTURE_WIDTH = 1280;
const COORDINATE_SAFE_MAX_CAPTURE_HEIGHT = 896;

function usesCoordinateSafeImageSizing(model: Model | undefined): boolean {
	if (!model) return false;
	const compat = model.compat;
	return (
		(!!compat && "supportsImageDetailOriginal" in compat && compat.supportsImageDetailOriginal === false) ||
		isClaudeModelId(model.id) ||
		(model.requestModelId !== undefined && isClaudeModelId(model.requestModelId)) ||
		(typeof model.name === "string" && /^claude(?:\s|$)/i.test(model.name))
	);
}

interface ComputerToolInput {
	code: string;
	read_only?: boolean;
	timeout?: number;
}

type ComputerSchema = Type<ComputerToolInput>;

const getComputerSchema: () => ComputerSchema = once(() =>
	type({
		code: type("string").describe(
			"JavaScript executed in the persistent computer session; top-level await allowed; `desktop`, `wait`, `assert` in scope",
		),
		"read_only?": type("boolean").describe(
			"true = inspection only: screenshots and ax reads allowed, all input/mutation blocked",
		),
		"timeout?": type("number").describe("run budget in seconds"),
		"+": "reject",
	}),
);

/** Renderer and artifact metadata produced by a computer tool run. */
export interface ComputerToolDetails {
	width: number;
	height: number;
	backend: DesktopCapture["backend"];
	displayServer?: string;
	capturePermission: string;
	inputPermission: string;
	displays: DesktopDisplay[];
	capabilities?: DesktopCapabilities;
	actions: ComputerAction["type"][];
}

export type ComputerControllerFactory = (options: DesktopSessionOptions) => ComputerController;

function isInt32(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

function isCoordinate(value: unknown): value is number {
	return isInt32(value) && value >= 0;
}

type AllowedFields = Record<string, true>;

const POINT_FIELDS: AllowedFields = { x: true, y: true };
const MOUSE_BUTTONS: AllowedFields = { left: true, right: true, wheel: true, back: true, forward: true };
const ACTION_FIELDS: Record<ComputerAction["type"], AllowedFields> = {
	click: { type: true, button: true, x: true, y: true, keys: true },
	double_click: { type: true, x: true, y: true, keys: true },
	drag: { type: true, path: true, keys: true },
	keypress: { type: true, keys: true },
	move: { type: true, x: true, y: true, keys: true },
	screenshot: { type: true },
	scroll: { type: true, x: true, y: true, scroll_x: true, scroll_y: true, keys: true },
	type: { type: true, text: true },
	wait: { type: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldsForAction(actionType: string): AllowedFields | undefined {
	switch (actionType) {
		case "click":
		case "double_click":
		case "drag":
		case "keypress":
		case "move":
		case "screenshot":
		case "scroll":
		case "type":
		case "wait":
			return ACTION_FIELDS[actionType];
		default:
			return undefined;
	}
}

function hasOnlyFields(value: Record<string, unknown>, allowed: AllowedFields): boolean {
	return Object.keys(value).every(key => allowed[key] === true);
}

function isPoint(value: unknown): value is { x: number; y: number } {
	return isRecord(value) && hasOnlyFields(value, POINT_FIELDS) && isCoordinate(value.x) && isCoordinate(value.y);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === "string");
}

function modifierBit(value: string): number {
	switch (value.trim().toUpperCase()) {
		case "CTRL":
		case "CONTROL":
			return 1;
		case "SHIFT":
			return 2;
		case "ALT":
		case "OPTION":
			return 4;
		case "META":
		case "CMD":
		case "COMMAND":
		case "SUPER":
		case "WINDOWS":
			return 8;
		default:
			return 0;
	}
}

function isModifierArray(value: unknown): value is string[] | null | undefined {
	if (value == null) return true;
	if (!isStringArray(value)) return false;
	let seen = 0;
	for (const entry of value) {
		for (const component of entry.split("+")) {
			const bit = modifierBit(component);
			if (bit === 0 || (seen & bit) !== 0) return false;
			seen |= bit;
		}
	}
	return true;
}

function isKeypressArray(value: unknown): value is string[] {
	return (
		isStringArray(value) &&
		value.length > 0 &&
		value.every(key => key.split("+").every(component => component.trim().length > 0))
	);
}

function isComputerAction(value: unknown): value is ComputerAction {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	const action = value;
	const actionType = value.type;
	const allowed = fieldsForAction(actionType);
	if (!allowed || !hasOnlyFields(action, allowed)) return false;
	switch (actionType) {
		case "click":
			return (
				isCoordinate(action.x) &&
				isCoordinate(action.y) &&
				typeof action.button === "string" &&
				MOUSE_BUTTONS[action.button] === true &&
				isModifierArray(action.keys)
			);
		case "double_click":
			return isCoordinate(action.x) && isCoordinate(action.y) && isModifierArray(action.keys);
		case "drag":
			return (
				Array.isArray(action.path) &&
				action.path.length >= 2 &&
				action.path.every(isPoint) &&
				isModifierArray(action.keys)
			);
		case "keypress":
			return isKeypressArray(action.keys);
		case "move":
			return isCoordinate(action.x) && isCoordinate(action.y) && isModifierArray(action.keys);
		case "screenshot":
		case "wait":
			return true;
		case "scroll":
			return (
				isCoordinate(action.x) &&
				isCoordinate(action.y) &&
				isInt32(action.scroll_x) &&
				isInt32(action.scroll_y) &&
				isModifierArray(action.keys)
			);
		case "type":
			return typeof action.text === "string";
		default:
			return false;
	}
}

function parseActions(value: unknown): ComputerAction[] {
	// Missing or empty action batches degrade to a plain screenshot so a
	// function-calling model can observe the screen before acting.
	if (value == null) return [{ type: "screenshot" }];
	if (!Array.isArray(value)) throw new ToolError(M.cmErrNotArray);
	if (value.length === 0) return [{ type: "screenshot" }];
	if (!value.every(isComputerAction)) throw new ToolError(M.cmErrInvalidAction);
	return value;
}

function toDesktopAction(action: ComputerAction): DesktopAction {
	switch (action.type) {
		case "click":
			return {
				type: "click",
				x: action.x,
				y: action.y,
				button: action.button,
				...(action.keys ? { keys: action.keys } : {}),
			};
		case "double_click":
			return {
				type: "double_click",
				x: action.x,
				y: action.y,
				...(action.keys ? { keys: action.keys } : {}),
			};
		case "drag":
			return { type: "drag", path: action.path, ...(action.keys ? { keys: action.keys } : {}) };
		case "keypress":
			return { type: "keypress", keys: action.keys };
		case "move":
			return { type: "move", x: action.x, y: action.y, ...(action.keys ? { keys: action.keys } : {}) };
		case "screenshot":
			return { type: "screenshot" };
		case "scroll":
			return {
				type: "scroll",
				x: action.x,
				y: action.y,
				scroll_x: action.scroll_x,
				scroll_y: action.scroll_y,
				...(action.keys ? { keys: action.keys } : {}),
			};
		case "type":
			return { type: "type", text: action.text };
		case "wait":
			return { type: "wait" };
	}
}

function callMetadata(context: AgentToolContext | undefined): ComputerToolCallMetadata | undefined {
	const metadata = context?.toolCall?.providerMetadata;
	return metadata?.type === "computer" ? metadata : undefined;
}

/** Creates the session-scoped controller used by the computer tool. */
export type ComputerControllerFactory = (session: ToolSession) => ComputerController;
/** Maps inspection-only runs to read approval and all other runs to execution approval. */
export function computerApproval(args: unknown): ToolApprovalDecision {
	if (args === null || typeof args !== "object" || !("read_only" in args)) return "exec";
	return args.read_only === true ? "read" : "exec";
}

/** Executes persistent desktop JavaScript through one lazy worker session. */
export class ComputerTool implements AgentTool<ComputerSchema, ComputerToolDetails> {
	readonly name = "computer";
	readonly label = "Computer";
	readonly loadMode = "essential" as const;
	readonly concurrency = "exclusive" as const;
	readonly summary = "Control the host desktop with persistent JavaScript and OS accessibility APIs";
	readonly strict = false;
	readonly approval = computerApproval;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		if (args === null || typeof args !== "object") return [""];
		const code = "code" in args && typeof args.code === "string" ? args.code : "";
		return [
			...("read_only" in args && args.read_only === true ? ["read-only"] : []),
			...truncateForPrompt(code, 2_000).split("\n"),
		];
	};

	readonly #controller: ComputerController;
	readonly #unregisterOwner: () => void;
	#closed = false;
	#description?: string;

	constructor(
		readonly session: ToolSession,
		createController: ComputerControllerFactory = currentSession =>
			new ComputerSupervisor(currentSession, undefined, undefined, callSessionTool),
	) {
		this.#controller = createController(session);
		this.#unregisterOwner = registerComputerController(
			session.getEvalKernelOwnerId?.() ?? undefined,
			this.#controller,
		);
	}

	get parameters(): ComputerSchema {
		return getComputerSchema();
	}

	get description(): string {
		this.#description ??= prompt.render(computerDescription);
		return this.#description;
	}

	async execute(
		_toolCallId: string,
		params: ComputerToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ComputerToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ComputerToolDetails>> {
		throwIfAborted(signal);
		if (this.#closed) throw new ToolError(M.cmErrClosed);
		const metadata = callMetadata(context);
		const actions = parseActions(metadata?.actions ?? params.actions);
		const pendingSafetyChecks: ComputerSafetyCheck[] = metadata?.pendingSafetyChecks ?? [];
		if (pendingSafetyChecks.length > 0 && context?.providerSafetyApproved !== true) {
			throw new ToolError(M.cmErrSafetyApproval);
		}
		await this.#refreshControllerForModel();
		throwIfAborted(signal);
		const capture = await this.#controller.execute(actions.map(toDesktopAction), signal);
		throwIfAborted(signal);
		const data = Buffer.from(capture.data).toBase64();
		return {
			content: [{ type: "image", data, mimeType: "image/png", detail: "original" }],
			details: {
				width: capture.width,
				height: capture.height,
				backend: capture.backend,
				displayServer: capture.displayServer,
				capturePermission: capture.capturePermission,
				inputPermission: capture.inputPermission,
				displays: capture.displays,
				capabilities: this.#controller.capabilities,
				actions: actions.map(action => action.type),
			},
			...(metadata
				? {
						providerMetadata: {
							type: "computer" as const,
							screenshot: { type: "computer_screenshot" as const, image_url: `data:image/png;base64,${data}` },
							acknowledgedSafetyChecks: pendingSafetyChecks,
						},
					}
				: {}),
		};
		const run = await this.#controller.run(params.code, timeoutSeconds * 1000, snapshot, signal);
		throwIfAborted(signal);

		const details: ComputerToolDetails = {
			code: params.code,
			readOnly: snapshot.readOnly,
			screenshots: run.screenshots,
		};
		if (run.returnValue !== undefined) details.returnValue = stringifyReturnValue(run.returnValue);
		populateCapabilityDetails(details, run.capabilities);

		const textBlocks = run.displays
			.filter((content): content is { type: "text"; text: string } => content.type === "text")
			.map(content => content.text);
		if (details.returnValue !== undefined) textBlocks.push(details.returnValue);
		if (!textBlocks.length && !run.displays.some(content => content.type === "image")) {
			textBlocks.push("Ran computer code");
		}
		const textOnly = textBlocks.join("\n");
		const cappedText = await enforceInlineByteCap(textOnly, {
			saveArtifact: full => saveComputerOutputArtifact(this.session, full),
		});
		const images = run.displays
			.filter(content => content.type === "image")
			.map(content => ({ ...content, detail: "original" as const }));
		const content = [...(cappedText ? [{ type: "text" as const, text: cappedText }] : []), ...images];
		return { content, details };
	}

	async capabilities(): Promise<DesktopCapabilities | undefined> {
		if (this.#closed) return undefined;
		return await this.#controller.capabilities();
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#unregisterOwner();
		await this.#controller.close();
	}
}

function stringifyReturnValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function populateCapabilityDetails(details: ComputerToolDetails, capabilities: DesktopCapabilities | undefined): void {
	if (!capabilities) return;
	details.backend = capabilities.backend;
	details.capturePermission = capabilities.capturePermission;
	details.inputPermission = capabilities.inputPermission;
	details.axPermission = capabilities.axPermission;
}

/** Persist over-cap computer run output as a session artifact; mirrors the browser run save path. */
async function saveComputerOutputArtifact(session: ToolSession, fullText: string): Promise<string | undefined> {
	try {
		const alloc = await session.allocateOutputArtifact?.("computer-original");
		if (!alloc?.path || !alloc.id) return undefined;
		await Bun.write(alloc.path, fullText);
		return alloc.id;
	} catch {
		return undefined;
	}
}
