import type { ComputerScreenshot } from "./protocol";

/** Host-owned policy and telemetry. Absent outside Studio; never parses tool source or input. */
export interface ComputerRunIdentity {
	runId: string;
	sessionId: string;
	toolCallId?: string;
	invocationId?: string;
	/** Native AgentSession identity; never exposed in public read models. */
	instanceKey?: string;
}
export type ComputerLifecycleEvent =
	| { kind: "run"; identity: ComputerRunIdentity; phase: "running" | "completed" | "failed" | "cancelled"; at: number }
	| {
			kind: "action";
			identity: ComputerRunIdentity;
			actionId: string;
			method: string;
			target?: string;
			mode: "read" | "background" | "takeover" | "unknown";
			phase: "running" | "completed" | "failed" | "cancelled";
			at: number;
	  }
	| { kind: "frame"; identity: ComputerRunIdentity; screenshot: ComputerScreenshot; actionId?: string; at: number }
	| {
			kind: "control";
			identity: ComputerRunIdentity;
			foreground: "none" | "requested" | "held" | "unknown";
			at: number;
	  };
export interface ComputerRunPermit {
	signal: AbortSignal;
	revision: number;
}
export interface ComputerScopeHook {
	owns(sessionId: string, ownerId?: string, instanceKey?: string): boolean;
	authorize(sessionId: string, ownerId?: string, instanceKey?: string): ComputerRunPermit | Promise<ComputerRunPermit>;
	event(event: ComputerLifecycleEvent): void;
	consumeIntent?(sessionId: string, message: unknown, instanceKey?: string): void;
	deliver?(sessionId: string, toolCallId: string, result: unknown, instanceKey?: string): void;
}
const scopes = new Set<ComputerScopeHook>();

export interface ComputerScopeBridge {
	has(sessionId: string, ownerId?: string, instanceKey?: string): boolean;
	permits(sessionId: string, ownerId?: string, instanceKey?: string): Promise<ComputerRunPermit[]>;
	event(event: ComputerLifecycleEvent): void;
	consumeIntent(sessionId: string, message: unknown, instanceKey?: string): void;
	deliver(sessionId: string, toolCallId: string, result: unknown, instanceKey?: string): unknown;
}
let bridge: ComputerScopeBridge | undefined;
export function installComputerScopeBridge(value: ComputerScopeBridge): void {
	bridge = value;
}
export function registerComputerScope(hook: ComputerScopeHook): () => void {
	scopes.add(hook);
	return () => scopes.delete(hook);
}
export async function computerRunPermits(
	sessionId: string,
	ownerId?: string,
	instanceKey?: string,
): Promise<ComputerRunPermit[]> {
	if (bridge) return bridge.permits(sessionId, ownerId, instanceKey);
	return Promise.all(
		[...scopes]
			.filter(scope => scope.owns(sessionId, ownerId, instanceKey))
			.map(scope => scope.authorize(sessionId, ownerId, instanceKey)),
	);
}
export function hasComputerScope(sessionId: string, ownerId?: string, instanceKey?: string): boolean {
	if (bridge) return bridge.has(sessionId, ownerId, instanceKey);
	return [...scopes].some(scope => scope.owns(sessionId, ownerId, instanceKey));
}
export function emitComputerLifecycle(event: ComputerLifecycleEvent): void {
	if (bridge) {
		bridge.event(event);
		return;
	}
	for (const scope of scopes) {
		if (!scope.owns(event.identity.sessionId, undefined, event.identity.instanceKey)) continue;
		try {
			scope.event(event);
		} catch {
			/* Observation must never rerun or fail a native action. */
		}
	}
}
/** Called only at the actual AgentSession message/result boundary, not on enqueue. */
export function computerUserMessageStarted(sessionId: string, message: unknown, instanceKey?: string): void {
	if (bridge) {
		bridge.consumeIntent(sessionId, message, instanceKey);
		return;
	}
	for (const scope of scopes)
		if (scope.owns(sessionId, undefined, instanceKey)) scope.consumeIntent?.(sessionId, message, instanceKey);
}
export function computerToolResultDelivered(
	sessionId: string,
	toolCallId: string,
	result: unknown,
	instanceKey?: string,
): unknown {
	if (bridge) {
		const delivered = bridge.deliver(sessionId, toolCallId, result, instanceKey);
		if (result && typeof result === "object" && delivered && typeof delivered === "object") {
			const source = delivered as { details?: unknown; content?: unknown };
			Object.assign(result, { details: source.details, content: source.content });
		}
		return result;
	}
	for (const scope of scopes)
		if (scope.owns(sessionId, undefined, instanceKey)) scope.deliver?.(sessionId, toolCallId, result, instanceKey);
	return result;
}
