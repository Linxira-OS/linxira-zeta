import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sanitizeText } from "@linxiraos/pi-utils";
import { canonicalProjectDir } from "../../../daemon/client";
import { projectScope, type UnitRef, type UnitSnapshot } from "../../../daemon/protocol";
import { requestService, startService } from "../../../launch/services";
import type { ToolSession } from "../../../tools";
import { cfgLaunchEnabled } from "../../../tools/settings";
import { invalid, unavailable } from "../errors.js";
import type { StudioServiceRow, WorkbenchOperation, WorkbenchResultMap } from "../protocol/contracts/workbench.js";

export type ServiceOperation = Extract<WorkbenchOperation, { kind: `services.${string}` }>;
export type ServiceKind = ServiceOperation["kind"];
type ServiceResult = WorkbenchResultMap[ServiceKind];

/** Snapshot shape of the launch broker the daemon replaced; older rows still project through it. */
interface LegacyServiceSnapshot {
	name: string;
	id: string;
	state: StudioServiceRow["state"];
	pid?: number;
	startedAt: number;
	readyAt?: number;
	exitedAt?: number;
	exitCode?: number;
	restartCount: number;
	outputBytes: number;
	owner?: string;
	persist: boolean;
	detached: boolean;
	previewUrl?: string;
}

type ServiceSnapshot = UnitSnapshot | LegacyServiceSnapshot;

/** Snapshot identity; the daemon's launch generation changes on every restart. */
function instanceIdOf(daemon: ServiceSnapshot): string {
	return daemon.id + ":" + ("generation" in daemon ? daemon.generation : daemon.startedAt);
}

/** Only public process facts; no command, environment or runtime directory. */
export function projectService(daemon: ServiceSnapshot): StudioServiceRow {
	const name = "name" in daemon ? daemon.name : daemon.key;
	const pid = "pid" in daemon ? daemon.pid : "pids" in daemon ? daemon.pids[0] : undefined;
	const persist = "persist" in daemon ? daemon.persist : daemon.policy.hold === "persist";
	const detached = "detached" in daemon ? daemon.detached : daemon.policy.survive === "detached";
	return {
		name,
		instanceId: instanceIdOf(daemon),
		state: daemon.state,
		startedAt: daemon.startedAt,
		...("previewUrl" in daemon && daemon.previewUrl !== undefined ? { previewUrl: daemon.previewUrl } : {}),
		...(pid === undefined ? {} : { pid }),
		...(daemon.readyAt === undefined ? {} : { readyAt: daemon.readyAt }),
		...(daemon.exitedAt === undefined ? {} : { exitedAt: daemon.exitedAt }),
		...(daemon.exitCode === undefined ? {} : { exitCode: daemon.exitCode }),
		restartCount: daemon.restartCount,
		outputBytes: daemon.outputBytes,
		...(daemon.owner === undefined ? {} : { ownerId: daemon.owner, ownerAgentId: daemon.owner }),
		mode: detached ? "detached" : persist ? "persist" : "session",
	};
}

/** Refuse to touch a replacement generation when the row the client holds is stale. */
function assertSameInstance(
	daemon: UnitSnapshot,
	expectedInstanceId: string,
	message = "Service instance changed; refresh before trying again",
): void {
	if (instanceIdOf(daemon) !== expectedInstanceId) throw unavailable(message);
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
		return {
			enabled: cfgLaunchEnabled.get(session.settings),
			services: result.units.slice(0, 500).map(projectService),
		};
	}
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
	const unit: UnitRef = {
		kind: "proc",
		scope: projectScope(await canonicalProjectDir(session.cwd)),
		key: operation.name,
	};
	if (operation.kind === "services.logs") {
		const result = await requestService(
			session,
			{
				op: "logs",
				unit,
				lines: operation.lines ?? 200,
				head: false,
				follow: false,
				timeoutMs: 1000,
				cursor: operation.cursor,
			},
			undefined,
			assertCurrent,
		);
		assertCurrent();
		return {
			instanceId: instanceIdOf(result.unit),
			text: sanitizeText(result.text).slice(-65536),
			cursor: result.cursor,
			state: result.unit.state,
		};
	}
	// The daemon fences only stops by generation. Read the row's generation first so
	// restart/mode/send cannot target a replacement launched after the client's row.
	const described = await requestService(session, { op: "describe", unit }, undefined, assertCurrent);
	assertCurrent();
	assertSameInstance(described.unit, operation.instanceId);
	const result = await requestService(
		session,
		operation.kind === "services.stop"
			? {
					op: "stop",
					unit,
					timeoutMs: 5000,
					generation: operation.instanceId.slice(operation.instanceId.lastIndexOf(":") + 1),
				}
			: operation.kind === "services.restart"
				? { op: "restart", unit }
				: operation.kind === "services.mode.set"
					? { op: "mode", unit, mode: operation.mode }
					: { op: "send", unit, data: operation.text },
		undefined,
		assertCurrent,
	);
	assertCurrent();
	if (operation.kind !== "services.restart") assertSameInstance(result.unit, operation.instanceId);
	return { service: projectService(result.unit) };
}
