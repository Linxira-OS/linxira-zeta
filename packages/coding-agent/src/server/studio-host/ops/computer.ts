import type { StudioFamily, StudioHostContext } from "../registry.js";
import { invalid, StudioOpError, unavailable } from "../errors.js";
import { computerRuntime, type ComputerRuntimeView } from "../services/computer-runtime";
import type {
	ComputerObservationOperation,
	ComputerObservationResultMap,
} from "../protocol/contracts/computer-observation.js";
import type {
	ComputerWorkspaceOperation,
	ComputerWorkspaceQuery,
	ComputerWorkspaceCommand,
	ComputerWorkspaceResultMap,
} from "../protocol/contracts/computer-workspace.js";
import { validateComputerWorkspaceOperation } from "../protocol/computer-workspace-validation.js";
import { snapshotFor } from "./session.js";
import { requiredString } from "../gateway.js";

function observationInput(kind: ComputerObservationOperation["kind"], input: unknown): void {
	const sessionId = requiredString(input, "sessionId");
	if (sessionId.length > 512 || sessionId.includes("\0")) throw invalid("Invalid Computer session identity");
	if (kind === "computer.configure" && typeof (input as Record<string, unknown>).enabled !== "boolean")
		throw invalid("Computer enabled must be boolean");
	if (kind === "computer.capture") {
		const targetId = requiredString(input, "targetId");
		if (targetId.length > 1024 || targetId.includes("\0")) throw invalid("Invalid Computer target identity");
	}
}

async function workspace<K extends ComputerWorkspaceOperation["kind"]>(
	kind: K,
	input: Omit<Extract<ComputerWorkspaceOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
): Promise<ComputerWorkspaceResultMap[K]> {
	return performWorkspace(kind, input, await computerRuntime(input, context));
}
async function performWorkspace<K extends ComputerWorkspaceOperation["kind"]>(
	kind: K,
	input: Omit<Extract<ComputerWorkspaceOperation, { kind: K }>, "kind">,
	runtime: ComputerRuntimeView,
): Promise<ComputerWorkspaceResultMap[K]> {
	const operation = { ...input, kind };
	try {
		validateComputerWorkspaceOperation(operation);
	} catch {
		throw invalid("Invalid Computer workspace operation");
	}
	try {
		const result =
			kind === "computer.workspace.get" ||
			kind === "computer.activity.list" ||
			kind === "computer.frame.get" ||
			kind === "computer.structure.get"
				? await runtime.workspace.query(operation as ComputerWorkspaceQuery, runtime.view)
				: await runtime.workspace.execute(operation as ComputerWorkspaceCommand, runtime.view);
		if (!runtime.view.isLive()) throw unavailable("Computer view or session changed");
		return result as ComputerWorkspaceResultMap[K];
	} catch (error) {
		if (error instanceof StudioOpError) throw error;
		throw unavailable("Computer operation is unavailable; the native backend, view, or session may have changed");
	}
}
async function command<K extends ComputerWorkspaceCommand["kind"]>(
	kind: K,
	input: Omit<Extract<ComputerWorkspaceCommand, { kind: K }>, "kind">,
	context: StudioHostContext,
) {
	const runtime = await computerRuntime(input, context);
	const result = await performWorkspace(kind, input, runtime);
	const snapshot = await snapshotFor(runtime.sessionId);
	if (!runtime.view.isLive()) throw unavailable("Computer view or session changed");
	return { snapshot, result };
}
async function legacy<K extends ComputerObservationOperation["kind"]>(
	kind: K,
	input: Omit<Extract<ComputerObservationOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
) {
	const operation = { ...input, kind } as ComputerObservationOperation;
	observationInput(kind, input);
	const runtime = await computerRuntime(input, context);
	try {
		const result = (await runtime.observation.execute(operation)) as ComputerObservationResultMap[K];
		if (!runtime.view.isLive()) throw unavailable("Computer view or session changed");
		const snapshot = await snapshotFor(runtime.sessionId);
		if (!runtime.view.isLive()) throw unavailable("Computer view or session changed");
		return { snapshot, result };
	} catch (error) {
		if (error instanceof StudioOpError) throw error;
		throw unavailable("Computer observation is unavailable; refresh the native targets");
	}
}
export const computerOps: StudioFamily = {
	id: "computer",
	queries: {
		"computer.workspace.get": (input, context) => workspace("computer.workspace.get", input, context),
		"computer.activity.list": (input, context) => workspace("computer.activity.list", input, context),
		"computer.frame.get": (input, context) => workspace("computer.frame.get", input, context),
		"computer.structure.get": (input, context) => workspace("computer.structure.get", input, context),
	},
	commands: {
		"computer.observe.open": (input, context) => command("computer.observe.open", input, context),
		"computer.observe.close": (input, context) => command("computer.observe.close", input, context),
		"computer.frame.capture": (input, context) => command("computer.frame.capture", input, context),
		"computer.control.stop": (input, context) => command("computer.control.stop", input, context),
		"computer.control.continue": (input, context) => command("computer.control.continue", input, context),
		"computer.status": (input, context) => legacy("computer.status", input, context),
		"computer.configure": (input, context) => legacy("computer.configure", input, context),
		"computer.capture": (input, context) => legacy("computer.capture", input, context),
		"computer.stop": (input, context) => legacy("computer.stop", input, context),
		"computer.observe.release": (input, context) => legacy("computer.observe.release", input, context),
	},
};
