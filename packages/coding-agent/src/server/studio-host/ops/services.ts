import * as fs from "node:fs/promises";
import { sameResumePath } from "../../../resume/paths";
import { getRpcSession } from "../../web-gateway/agents";
import { ensureLiveSession } from "../gateway.js";
import { invalid, unavailable } from "../errors.js";
import { validateServiceSpec, type WorkbenchResultMap } from "../protocol/contracts/workbench.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { executeProjectService, type ServiceKind, type ServiceOperation } from "../services/project-services.js";
import { currentSessionId, sessionWorkspaceId, snapshotFor } from "./session.js";
import { resolveWorkspacePath } from "./workspace.js";

function serviceInput(operation: ServiceOperation): void {
	if (operation.kind === "services.start") {
		validateServiceSpec(operation.spec);
		return;
	}
	if (operation.kind === "services.list") return;
	for (const [value, max] of [
		[operation.name, 48],
		[operation.instanceId, 512],
	] as const)
		if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
			throw invalid("Invalid service identity");
	if (operation.kind === "services.mode.set" && !["session", "persist", "detached"].includes(operation.mode))
		throw invalid("Invalid service mode");
	if (
		operation.kind === "services.send" &&
		(typeof operation.text !== "string" || operation.text.length > 65536 || operation.text.includes("\0"))
	)
		throw invalid("Invalid service input");
	if (operation.kind === "services.logs") {
		if (operation.cursor !== undefined && (!Number.isSafeInteger(operation.cursor) || operation.cursor < 0))
			throw invalid("Invalid service cursor");
		if (
			operation.lines !== undefined &&
			(!Number.isSafeInteger(operation.lines) || operation.lines < 1 || operation.lines > 1000)
		)
			throw invalid("Service logs require 1–1000 lines");
	}
}

async function execute<K extends ServiceKind>(
	kind: K,
	input: Omit<Extract<ServiceOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
) {
	const operation = { ...input, kind } as ServiceOperation;
	try {
		serviceInput(operation);
	} catch (error) {
		throw invalid(error instanceof Error ? error.message : String(error));
	}
	const owner = context.privateOwner;
	const sessionId = await currentSessionId();
	const view = () => {
		if (
			!owner ||
			!owner.isLive() ||
			owner.expiresAt <= Date.now() ||
			context.selection?.closed ||
			(context.selection && context.selection.sessionId !== sessionId)
		)
			throw unavailable("Services require the same live authenticated conversation");
	};
	view();
	const workspaceId = await sessionWorkspaceId(sessionId);
	view();
	if (!workspaceId || (context.selection && context.selection.workspaceId !== workspaceId))
		throw invalid("Service workspace does not own this session");
	const workspace = await fs.realpath(await resolveWorkspacePath(workspaceId));
	view();
	await ensureLiveSession(sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	const toolSession = session?.getEvalToolSession();
	if (!session || !toolSession || !sameResumePath(toolSession.cwd, workspace))
		throw unavailable("Service context is not available in this workspace");
	const assertCurrent = () => {
		view();
		if (
			session.isDisposed ||
			session.sessionId !== sessionId ||
			getRpcSession(sessionId)?.getSession() !== session ||
			session.getEvalToolSession() !== toolSession ||
			!sameResumePath(toolSession.cwd, workspace)
		)
			throw unavailable("Service session changed");
		if (kind !== "services.list" && kind !== "services.logs") session.assertEvalExecutionAllowed();
	};
	const result = (await executeProjectService(toolSession, operation, assertCurrent)) as WorkbenchResultMap[K];
	const snapshot = await snapshotFor(sessionId);
	assertCurrent();
	return { snapshot, result };
}

export const servicesOps: StudioFamily = {
	id: "services",
	commands: {
		"services.list": (input, context) => execute("services.list", input, context),
		"services.start": (input, context) => execute("services.start", input, context),
		"services.stop": (input, context) => execute("services.stop", input, context),
		"services.restart": (input, context) => execute("services.restart", input, context),
		"services.mode.set": (input, context) => execute("services.mode.set", input, context),
		"services.send": (input, context) => execute("services.send", input, context),
		"services.logs": (input, context) => execute("services.logs", input, context),
	},
};
