import { AsyncLocalStorage } from "node:async_hooks";
import { invalid, unavailable } from "./errors.js";

/** Mutable selection owned by one authenticated conversation context. */
export interface StudioSelection {
	readonly workspaceId: string;
	sessionId?: string;
	closed: boolean;
}

const selections = new AsyncLocalStorage<StudioSelection>();

export function currentStudioSelection(): StudioSelection | undefined {
	const selection = selections.getStore();
	if (selection?.closed) throw unavailable("conversation context is closed");
	return selection;
}

export function runWithStudioSelection<T>(selection: StudioSelection | undefined, action: () => T): T {
	return selection === undefined ? action() : selections.run(selection, action);
}

export function selectStudioSession(sessionId: string): boolean {
	const selection = currentStudioSelection();
	if (selection === undefined) return false;
	selection.sessionId = sessionId;
	return true;
}

export function clearStudioSession(sessionId: string): boolean {
	const selection = currentStudioSelection();
	if (selection === undefined) return false;
	if (selection.sessionId === sessionId) delete selection.sessionId;
	return true;
}

export function requireStudioWorkspace(workspaceId: string): void {
	const selection = currentStudioSelection();
	if (selection !== undefined && selection.workspaceId !== workspaceId) {
		throw invalid("workspace does not belong to this conversation context");
	}
}
