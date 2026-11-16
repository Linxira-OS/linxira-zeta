import { isComputerWorkspaceKind, type ComputerWorkspaceOperation, type ComputerWorkspaceResultMap } from "./contracts/computer-workspace.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error("Invalid Computer workspace payload");
	return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 512): asserts value is string {
	if (typeof value !== "string" || !value.length || value.length > maximum || value.includes("\0")) throw new Error("Invalid Computer workspace text");
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid Computer workspace number");
}
function boolean(value: unknown): void { if (typeof value !== "boolean") throw new Error("Invalid Computer workspace boolean"); }
function array(value: unknown, maximum: number, validate: (value: unknown) => void): void {
	if (!Array.isArray(value) || value.length > maximum) throw new Error("Computer workspace list exceeds its budget");
	for (const item of value) validate(item);
}
export function validateComputerWorkspaceOperation(value: unknown): asserts value is ComputerWorkspaceOperation {
	const row = record(value, ["kind", "sessionId", "cursor", "limit", "frameId", "leaseId", "targetId", "consumerId", "reason", "revision"]);
	text(row.kind);
	if (!isComputerWorkspaceKind(row.kind)) throw new Error("Unknown Computer workspace operation");
	text(row.sessionId);
	const fields: Record<ComputerWorkspaceOperation["kind"], string[]> = {
		"computer.workspace.get": [], "computer.activity.list": ["cursor", "limit"], "computer.frame.get": ["frameId"],
		"computer.structure.get": ["leaseId", "targetId"], "computer.observe.open": ["consumerId"], "computer.observe.close": ["leaseId"],
		"computer.frame.capture": ["leaseId", "targetId"], "computer.control.stop": ["reason"], "computer.control.continue": ["revision"],
	};
	record(row, ["kind", "sessionId", ...fields[row.kind]]);
	for (const key of fields[row.kind]) {
		if (key === "cursor") { if (row.cursor !== undefined && (typeof row.cursor !== "string" || !/^(0|[1-9][0-9]{0,9})$/u.test(row.cursor))) throw new Error("Invalid Computer history cursor"); }
		else if (key === "limit") { if (row.limit !== undefined) integer(row.limit, 1, 50); }
		else if (key === "revision") integer(row.revision);
		else if (key === "reason") { if (row.reason !== undefined && !["stop", "handoff", "disable"].includes(String(row.reason))) throw new Error("Invalid Computer stop reason"); }
		else { text(row[key], key === "targetId" ? 1024 : 512); if ((key === "frameId" || key === "leaseId") && !UUID.test(row[key] as string)) throw new Error("Invalid Computer identity"); }
	}
}
export function validateComputerFrame(value: unknown): void {
	const row = record(value, ["frameId", "sessionId", "source", "capturedAt", "targetId", "targetName", "runId", "actionId", "toolCallId", "agentId", "width", "height", "coordinateWidth", "coordinateHeight", "sourceWidth", "sourceHeight", "region", "screenLocked", "delivered", "availability", "artifactId", "expiresAt"]);
	for (const key of ["frameId", "sessionId", "targetId"]) text(row[key], 1024);
	if (!UUID.test(row.frameId as string) || !["execution", "observation"].includes(String(row.source)) || !["available", "pending", "expired", "unavailable"].includes(String(row.availability))) throw new Error("Invalid Computer frame");
	for (const key of ["width", "height", "coordinateWidth", "coordinateHeight"]) integer(row[key], 1, 100000);
	for (const key of ["sourceWidth", "sourceHeight"]) if (row[key] !== undefined) integer(row[key], 1, 100000);
	integer(row.capturedAt);
	if (row.expiresAt !== undefined) integer(row.expiresAt);
	boolean(row.screenLocked); boolean(row.delivered);
	for (const key of ["targetName", "runId", "actionId", "toolCallId", "agentId", "artifactId"]) if (row[key] !== undefined) text(row[key], 4096);
	if (row.region !== undefined) {
		const bounds = record(row.region, ["x", "y", "width", "height"]);
		for (const key of ["x", "y", "width", "height"]) if (typeof bounds[key] !== "number" || !Number.isFinite(bounds[key])) throw new Error("Invalid Computer frame region");
	}
}
function control(value: unknown): void {
	const row = record(value, ["status", "revision", "updatedAt", "reason", "foreground"]);
	if (!["allowed", "stopping", "stopped", "continuing", "unconfirmed"].includes(String(row.status)) || !["none", "requested", "held", "unknown"].includes(String(row.foreground))) throw new Error("Invalid Computer control state");
	integer(row.revision); integer(row.updatedAt); if (row.reason !== undefined) text(row.reason, 4096);
}
function action(value: unknown): void {
	const row = record(value, ["id", "sessionId", "runId", "toolCallId", "agentId", "agentName", "method", "targetId", "targetName", "mode", "status", "startedAt", "endedAt", "frameIds", "error"]);
	for (const key of ["id", "sessionId", "runId", "method"]) text(row[key]);
	for (const key of ["toolCallId", "agentId", "agentName", "targetId", "targetName", "error"]) if (row[key] !== undefined) text(row[key], 4096);
	if (!["read", "background", "takeover", "unknown"].includes(String(row.mode)) || !["running", "waiting", "completed", "failed", "cancelled"].includes(String(row.status))) throw new Error("Invalid Computer action");
	integer(row.startedAt); if (row.endedAt !== undefined) integer(row.endedAt);
	array(row.frameIds, 200, value => { text(value); });
}
export function validateComputerWorkspaceResult(kind: keyof ComputerWorkspaceResultMap, value: unknown): void {
	if (kind === "computer.frame.get" && value === null) return;
	if (kind === "computer.frame.get" || kind === "computer.frame.capture") { validateComputerFrame(value); return; }
	if (kind === "computer.control.stop") { control(value); return; }
	if (kind === "computer.control.continue") { const row = record(value, ["queued", "control"]); boolean(row.queued); control(row.control); return; }
	if (kind === "computer.observe.close") { if (record(value, ["released"]).released !== true) throw new Error("Computer lease did not close"); return; }
	if (kind === "computer.observe.open") {
		const row = record(value, ["leaseId", "sessionId", "expiresAt"]); text(row.leaseId); text(row.sessionId); integer(row.expiresAt);
		if (!UUID.test(row.leaseId as string)) throw new Error("Invalid observation lease"); return;
	}
	if (kind === "computer.activity.list") {
		const row = record(value, ["items", "frames", "revision", "nextCursor"]); array(row.items, 50, action); array(row.frames, 10000, validateComputerFrame); integer(row.revision); if (row.nextCursor !== undefined) text(row.nextCursor, 32); return;
	}
	if (kind === "computer.structure.get") {
		const row = record(value, ["snapshotId", "sessionId", "targetId", "capturedAt", "frame", "nodes", "truncated", "coordinateSpace", "reason"]);
		for (const key of ["snapshotId", "sessionId", "targetId"]) text(row[key], 1024);
		integer(row.capturedAt); boolean(row.truncated); if (row.frame !== undefined) validateComputerFrame(row.frame);
		if (!["frame", "unavailable"].includes(String(row.coordinateSpace))) throw new Error("Invalid Computer coordinate space");
		if (row.reason !== undefined) text(row.reason, 4096);
		let count = 0;
		const node = (value: unknown, depth: number): void => {
			if (++count > 500 || depth > 64) throw new Error("Computer structure exceeds its budget");
			const item = record(value, ["id", "role", "name", "enabled", "bounds", "children"]); text(item.id); text(item.role);
			if (typeof item.name !== "string" || item.name.length > 4096 || item.name.includes("\0")) throw new Error("Invalid Computer node name"); boolean(item.enabled);
			if (item.bounds !== undefined) { const bounds = record(item.bounds, ["x", "y", "width", "height"]); for (const key of ["x", "y", "width", "height"]) if (typeof bounds[key] !== "number" || !Number.isFinite(bounds[key])) throw new Error("Invalid Computer node bounds"); }
			array(item.children, 500, child => node(child, depth + 1));
		};
		array(row.nodes, 500, value => node(value, 0)); return;
	}
	const row = record(value, ["version", "sessionId", "revision", "updatedAt", "enabled", "preludeAvailable", "backend", "capabilities", "permissions", "screen", "control", "targets", "active", "frames", "reason"]);
	if (row.version !== 1) throw new Error("Unknown Computer workspace version");
	text(row.sessionId); text(row.backend); integer(row.revision); integer(row.updatedAt); boolean(row.enabled); boolean(row.preludeAvailable);
	const caps = record(row.capabilities, ["capture", "input", "accessibility", "globalEscape", "observationOnly"]); for (const key of ["capture", "input", "accessibility", "globalEscape", "observationOnly"]) boolean(caps[key]);
	const permissions = record(row.permissions, ["capture", "input", "accessibility"]); for (const key of ["capture", "input", "accessibility"]) text(permissions[key]);
	const screen = record(row.screen, ["locked", "asleep", "known"]); boolean(screen.locked); boolean(screen.asleep); if (screen.known !== undefined) boolean(screen.known);
	control(row.control); array(row.active, 200, action); array(row.frames, 50, validateComputerFrame);
	array(row.targets, 256, value => { const target = record(value, ["id", "kind", "name", "width", "height"]); text(target.id, 1024); text(target.name, 4096); if (target.kind !== "window" && target.kind !== "display") throw new Error("Invalid Computer target"); integer(target.width, 0, 100000); integer(target.height, 0, 100000); });
	if (row.reason !== undefined) text(row.reason, 4096);
}

export function validateComputerWorkspaceChange(value: unknown): void {
	const row = record(value, ["kind", "sessionId", "revision", "snapshot", "action", "frame"]);
	text(row.sessionId); integer(row.revision);
	if (row.kind === "state") { record(row, ["kind", "sessionId", "revision", "snapshot"]); validateComputerWorkspaceResult("computer.workspace.get", row.snapshot); }
	else if (row.kind === "action") { record(row, ["kind", "sessionId", "revision", "action"]); action(row.action); }
	else if (row.kind === "frame") { record(row, ["kind", "sessionId", "revision", "frame"]); validateComputerFrame(row.frame); }
	else if (row.kind === "reset") record(row, ["kind", "sessionId", "revision"]);
	else throw new Error("Invalid Computer workspace change");
}
