import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sanitizeText } from "@linxiraos/pi-utils";
import type { DaemonSnapshot } from "../../../launch/protocol";
import { requestService, startService } from "../../../launch/services";
import type { ToolSession } from "../../../tools";
import { cfgLaunchEnabled } from "../../../tools/settings";
import { invalid, unavailable } from "../errors.js";
import type { StudioServiceRow, WorkbenchOperation, WorkbenchResultMap } from "../protocol/contracts/workbench.js";

export type ServiceOperation = Extract<WorkbenchOperation, { kind: `services.${string}` }>;
export type ServiceKind = ServiceOperation["kind"];
type ServiceResult = WorkbenchResultMap[ServiceKind];

/** Only public process facts; no command, environment or runtime directory. */
export function projectService(daemon: DaemonSnapshot): StudioServiceRow {
	return {
		name: daemon.name,
		instanceId: daemon.id + ":" + daemon.startedAt,
		state: daemon.state,
		startedAt: daemon.startedAt,
		...(daemon.previewUrl === undefined ? {} : { previewUrl: daemon.previewUrl }),
		...(daemon.pid === undefined ? {} : { pid: daemon.pid }),
		...(daemon.readyAt === undefined ? {} : { readyAt: daemon.readyAt }),
		...(daemon.exitedAt === undefined ? {} : { exitedAt: daemon.exitedAt }),
		...(daemon.exitCode === undefined ? {} : { exitCode: daemon.exitCode }),
		restartCount: daemon.restartCount,
		outputBytes: daemon.outputBytes,
		...(daemon.owner === undefined ? {} : { ownerId: daemon.owner, ownerAgentId: daemon.owner }),
		mode: daemon.detached ? "detached" : daemon.persist ? "persist" : "session",
	};
}

/** The official service seam uses the native ToolSession and its completion subscriptions. */
export async function executeProjectService(
	session: ToolSession,
	operation: ServiceOperation,
	assertCurrent: () => void,
): Promise<ServiceResult> {
	assertCurrent();
	if (operation.kind === "services.list") {
		const result = await requestService(session, { op: "list" }, undefined, assertCurrent);
		assertCurrent();
		if (result.op !== "list") throw new Error("Unexpected service list response");
		return {
			enabled: cfgLaunchEnabled.get(session.settings),
			services: result.daemons.slice(0, 500).map(projectService),
		};
	}
	// Older brokers discard unknown fence fields; do not send them Studio control.
	const ping = await requestService(session, { op: "ping" }, undefined, assertCurrent);
	assertCurrent();
	if (ping.op !== "ping" || !ping.instanceFencing)
		throw unavailable(
			"This project broker needs to be restarted with the updated Runtime before controlling services",
		);
	if (operation.kind === "services.start") {
		const spec = operation.spec;
		const root = await fs.realpath(session.cwd);
		const cwd = await fs.realpath(path.resolve(root, spec.cwd ?? "."));
		const relative = path.relative(root, cwd);
		if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
			throw invalid("Service directory must stay inside the workspace");
		assertCurrent();
		const result = await startService(
			session,
			{
				...spec,
				cwd,
				replace: false,
				awaitReady: false,
				...(spec.ready ? { ready: { ...spec.ready, timeout: spec.ready.timeoutMs / 1000 } } : {}),
			},
			undefined,
			undefined,
			assertCurrent,
		);
		assertCurrent();
		return { service: projectService(result.daemon), readyTimedOut: result.readyTimedOut };
	}
	const named = { name: operation.name, expectedInstanceId: operation.instanceId };
	if (operation.kind === "services.logs") {
		const result = await requestService(
			session,
			{
				op: "logs",
				...named,
				lines: operation.lines ?? 200,
				head: false,
				follow: false,
				timeoutMs: 1000,
				cursor: operation.cursor,
				renderTerminalRows: true,
			},
			undefined,
			assertCurrent,
		);
		assertCurrent();
		if (result.op !== "logs") throw new Error("Unexpected service logs response");
		return {
			instanceId: operation.instanceId,
			text: sanitizeText(result.terminalRows?.join("\n") ?? result.text).slice(-65536),
			cursor: result.cursor,
			state: result.state,
		};
	}
	const result = await requestService(
		session,
		operation.kind === "services.stop"
			? { op: "stop", ...named, timeoutMs: 5000 }
			: operation.kind === "services.restart"
				? { op: "restart", ...named }
				: operation.kind === "services.mode.set"
					? { op: "mode", ...named, mode: operation.mode }
					: { op: "send", ...named, data: operation.text },
		undefined,
		assertCurrent,
	);
	assertCurrent();
	if (!("daemon" in result)) throw new Error("Unexpected service response");
	return { service: projectService(result.daemon) };
}
