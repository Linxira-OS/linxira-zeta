import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "../../../session/agent-session";
import { cfgComputerEnabled } from "../../../tools/settings";
import type {
	ComputerObservationOperation,
	StudioComputerCapture,
	StudioComputerStatus,
} from "../protocol/contracts/computer-observation.js";
import type {
	ComputerFrame,
	ComputerObservationLease,
	ComputerWorkspaceSnapshot,
} from "../protocol/contracts/computer-workspace.js";
import { unavailable } from "../errors.js";
import type { StudioComputerWorkspaceService, ComputerWorkspaceView } from "./computer-workspace-service";

/** Legacy receipts use the same passive native path, lease budget, stop latch, and private frame copies. */
export class StudioComputerObservationService {
	#lease?: ComputerObservationLease;
	#generation = 0;
	#disposed = false;
	#flight?: Promise<unknown>;
	readonly #captures = new Map<string, NodeJS.Timeout>();
	constructor(
		readonly session: AgentSession,
		readonly directory: string,
		readonly workspace: StudioComputerWorkspaceService,
		readonly view: ComputerWorkspaceView,
	) {}
	#check(generation = this.#generation): void {
		if (this.#disposed || generation !== this.#generation || !this.view.isLive())
			throw unavailable("Computer view closed or changed");
	}
	async status(): Promise<StudioComputerStatus> {
		this.#check();
		const snapshot = (await this.workspace.query(
			{ kind: "computer.workspace.get", sessionId: this.session.sessionId },
			this.view,
		)) as ComputerWorkspaceSnapshot;
		this.#check();
		return {
			enabled: snapshot.enabled,
			available: snapshot.capabilities.capture,
			backend: snapshot.backend,
			capturePermission: snapshot.permissions.capture,
			inputPermission: snapshot.permissions.input,
			axPermission: snapshot.permissions.accessibility,
			running: snapshot.active.filter(action => action.method === "computer.run").length,
			targets: snapshot.targets,
			...(snapshot.reason ? { reason: snapshot.reason } : {}),
		};
	}
	async execute(operation: ComputerObservationOperation): Promise<unknown> {
		this.#check();
		if (operation.sessionId !== this.session.sessionId) throw unavailable("Computer session changed");
		if (operation.kind === "computer.status") return this.status();
		if (operation.kind === "computer.configure") {
			await this.workspace.setEnabled(operation.enabled);
			this.#check();
			if (!operation.enabled) await this.release();
			return { enabled: cfgComputerEnabled.get(this.session.settings) };
		}
		if (operation.kind === "computer.stop") {
			await this.workspace.stop();
			this.#check();
			return { stopped: true };
		}
		if (operation.kind === "computer.observe.release") {
			await this.release();
			return { released: true };
		}
		if (this.#flight) throw unavailable("A computer capture is already running");
		const generation = this.#generation;
		const capture = async (): Promise<StudioComputerCapture> => {
			if (!cfgComputerEnabled.get(this.session.settings)) throw unavailable("Computer Use is disabled");
			const lease = (await this.workspace.execute(
				{
					kind: "computer.observe.open",
					sessionId: operation.sessionId,
					consumerId: "legacy:" + this.view.ownerId,
				},
				this.view,
			)) as ComputerObservationLease;
			if (generation !== this.#generation || this.#disposed || !this.view.isLive()) {
				await this.workspace.releaseLease(lease.leaseId, this.view.ownerId);
				this.#check(generation);
			}
			this.#lease = lease;
			const frame = (await this.workspace.execute(
				{
					kind: "computer.frame.capture",
					sessionId: operation.sessionId,
					leaseId: lease.leaseId,
					targetId: operation.targetId,
				},
				this.view,
			)) as ComputerFrame;
			this.#check(generation);
			const result: StudioComputerCapture = {
				captureId: randomUUID(),
				sessionId: operation.sessionId,
				targetId: operation.targetId,
				width: frame.width,
				height: frame.height,
				expiresAt: Date.now() + 30_000,
			};
			const folder = join(this.directory, "computer"),
				target = join(folder, result.captureId + ".json"),
				partial = target + "." + randomUUID() + ".partial";
			await mkdir(folder, { recursive: true, mode: 0o700 });
			try {
				this.#check(generation);
				await writeFile(
					partial,
					JSON.stringify({
						version: 1,
						...result,
						scopeSessionId: this.session.sessionId,
						frameId: frame.frameId,
						leaseId: lease.leaseId,
						owner: createHash("sha256").update(this.view.ownerId).digest("hex"),
					}),
					{ flag: "wx", mode: 0o600 },
				);
				await rename(partial, target);
				this.#check(generation);
			} catch (error) {
				await unlink(target).catch(() => {});
				throw error;
			} finally {
				await unlink(partial).catch(() => {});
			}
			const timer = setTimeout(() => {
				this.#captures.delete(result.captureId);
				void unlink(target).catch(() => {});
			}, 30_000);
			timer.unref();
			this.#captures.set(result.captureId, timer);
			return result;
		};
		this.#flight = capture();
		try {
			return await this.#flight;
		} finally {
			this.#flight = undefined;
		}
	}
	async release(): Promise<void> {
		this.#generation++;
		const lease = this.#lease;
		this.#lease = undefined;
		if (lease) await this.workspace.releaseLease(lease.leaseId, this.view.ownerId);
		await this.#flight?.catch(() => {});
		await Promise.all(
			[...this.#captures].map(async ([id, timer]) => {
				clearTimeout(timer);
				await unlink(join(this.directory, "computer", id + ".json")).catch(() => {});
			}),
		);
		this.#captures.clear();
	}
	async dispose(): Promise<void> {
		this.#disposed = true;
		await this.release();
	}
}
