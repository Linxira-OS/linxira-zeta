/**
 * Desktop SSH execution-target bridge.
 *
 * One saved profile owns one `ssh -L` tunnel and one Studio event socket. The
 * bridge exposes only operations the renderer already calls; a missing tunnel
 * is an error, never a local-service fallback. Disconnect invalidates the
 * generation so late events and stale commands cannot mutate the next target.
 */

import * as path from "node:path";
import {
	RESYNC_REQUIRED,
	type RemoteConnectionDraft,
	type RemoteConnectionProfile,
	type RemoteConnectionStatus,
	type RemoteCredentials,
	type RemoteDirectoryList,
	type RemoteEventEnvelope,
	type RemoteInventory,
} from "./protocol";
import { freeLoopbackPort, StudioHttp, type StudioEventSocket } from "./http";
import { openTunnel, probeRemote, remoteShellPath, runRemote, shellQuote, uploadRuntime, type Tunnel } from "./ssh";
import { RemoteProfileStore } from "./store";

interface Session {
	readonly id: string;
	readonly generation: number;
	readonly http: StudioHttp;
	readonly tunnel: Tunnel;
	readonly socket: StudioEventSocket;
	readonly platform: string;
	readonly arch: string;
}

export interface RemoteBridgeDeps {
	readonly userData: string;
	readonly changed: (inventory: RemoteInventory) => void;
	readonly event: (envelope: RemoteEventEnvelope) => void;
	readonly log: (message: string) => void;
}

const REMOTE_STUDIO_PORT = 43141;

export class RemoteBridge {
	readonly #store: RemoteProfileStore;
	readonly #deps: RemoteBridgeDeps;
	readonly #statuses = new Map<string, RemoteConnectionStatus>();
	readonly #sessions = new Map<string, Session>();
	readonly #connecting = new Map<string, Promise<void>>();
	#epoch = 0;

	constructor(deps: RemoteBridgeDeps) {
		this.#deps = deps;
		this.#store = new RemoteProfileStore(deps.userData);
		this.#store.load();
		for (const profile of this.#store.snapshot().profiles) {
			this.#statuses.set(profile.id, { id: profile.id, state: "disconnected", generation: 0 });
		}
	}

	inventory(): RemoteInventory {
		const state = this.#store.snapshot();
		return {
			profiles: state.profiles,
			statuses: state.profiles.map(
				profile => this.#statuses.get(profile.id) ?? { id: profile.id, state: "disconnected" as const },
			),
			activeId: state.activeId,
		};
	}

	save(draft: RemoteConnectionDraft): RemoteConnectionProfile {
		const profile = this.#store.upsert(draft);
		if (!this.#statuses.has(profile.id))
			this.#statuses.set(profile.id, { id: profile.id, state: "disconnected", generation: 0 });
		this.#changed();
		return profile;
	}

	async remove(id: string): Promise<void> {
		await this.disconnect(id);
		if (!this.#store.remove(id)) throw new Error("SSH connection not found");
		this.#statuses.delete(id);
		this.#changed();
	}

	async select(id: string | null): Promise<void> {
		this.#store.select(id);
		this.#changed();
	}

	async connect(id: string, credentials: RemoteCredentials = {}): Promise<void> {
		const existing = this.#sessions.get(id);
		if (existing) return;
		const running = this.#connecting.get(id);
		if (running) return running;
		const profile = this.#profile(id);
		const attempt = this.#runConnect(profile, credentials);
		this.#connecting.set(id, attempt);
		try {
			await attempt;
		} finally {
			this.#connecting.delete(id);
		}
	}

	async #runConnect(profile: RemoteConnectionProfile, credentials: RemoteCredentials): Promise<void> {
		const generation = ++this.#epoch;
		this.#setStatus({ id: profile.id, state: "connecting", generation, stage: "probe", message: "正在连接 SSH…" });
		let tunnel: Tunnel | undefined;
		let socket: StudioEventSocket | undefined;
		try {
			const probe = await probeRemote(profile, credentials, this.#deps.userData);
			this.#store.update(profile.id, { platform: probe.platform });
			this.#setStatus({
				id: profile.id,
				state: "connecting",
				generation,
				stage: "connect",
				platform: probe.platform,
				arch: probe.arch,
				installRoot: profile.installRoot,
				message: probe.zetaPath
					? `已找到远端 ${probe.binary ?? "zeta"}${probe.version ? ` ${probe.version}` : ""}：${probe.zetaPath}`
					: "远端未找到 zetacode/zeta；请先安装 Runtime",
			});
			const localPort = await freeLoopbackPort();
			const opened = await openTunnel(profile, credentials, this.#deps.userData, localPort, REMOTE_STUDIO_PORT);
			tunnel = opened;
			const http = new StudioHttp(`http://127.0.0.1:${localPort}`);
			if (!(await http.health(15_000))) {
				throw new Error(
					probe.zetaPath
						? `SSH 已连接，但远端 ${REMOTE_STUDIO_PORT} 没有 Studio 服务；请先运行 zeta serve。`
						: "SSH 已连接，但远端没有运行中的 Zeta Studio 服务；请先安装并启动 Runtime。",
				);
			}
			await http.ensureSession();
			socket = http.events();
			socket.onMessage = text => {
				const session = this.#sessions.get(profile.id);
				if (!session || session.generation !== generation) return;
				try {
					this.#deps.event({ id: profile.id, generation, event: JSON.parse(text) as unknown });
				} catch {
					this.#deps.log(`Ignored malformed Studio event from ${profile.name}`);
				}
			};
			await socket.opened;
			socket.onClose = reason => {
				const session = this.#sessions.get(profile.id);
				if (!session || session.generation !== generation) return;
				this.#sessions.delete(profile.id);
				this.#setStatus({
					id: profile.id,
					state: "degraded",
					generation: ++this.#epoch,
					message: `Studio 事件通道已断开：${reason}`,
					platform: probe.platform as RemoteConnectionStatus["platform"],
					arch: probe.arch,
				});
			};
			this.#sessions.set(profile.id, {
				id: profile.id,
				generation,
				http,
				tunnel: opened,
				socket,
				platform: probe.platform,
				arch: probe.arch,
			});
			this.#setStatus({
				id: profile.id,
				state: "connected",
				generation,
				platform: probe.platform,
				arch: probe.arch,
				installRoot: profile.installRoot,
				stage: "connect",
				networkMessage: "SSH 隧道已建立；命令与事件都只走远端。",
			});
		} catch (error) {
			socket?.close("connect failed");
			tunnel?.child.kill();
			this.#setStatus({
				id: profile.id,
				state: "failed",
				generation: ++this.#epoch,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async disconnect(id: string): Promise<void> {
		const session = this.#sessions.get(id);
		this.#sessions.delete(id);
		session?.socket.close("disconnected");
		session?.tunnel.child.kill();
		this.#setStatus({ id, state: "disconnected", generation: ++this.#epoch });
	}

	async approveDeployment(id: string): Promise<void> {
		const status = this.#statuses.get(id);
		if (status?.state !== "awaiting-approval") return;
		this.#setStatus({ ...status, state: "connecting", stage: "confirmation" });
	}

	async directories(id: string, requested?: string): Promise<RemoteDirectoryList> {
		const session = this.#session(id);
		const query = requested ? `?path=${encodeURIComponent(requested)}` : "";
		const body = await session.http.gateway<{
			path?: string;
			currentPath?: string;
			parentPath?: string;
			directories?: Array<{ name?: string; path?: string }>;
		}>(`/api/cwd/browse${query}`);
		const current = body.path ?? body.currentPath ?? requested ?? ".";
		return {
			path: current,
			parent: body.parentPath ?? path.posix.dirname(current),
			directories: (body.directories ?? [])
				.filter(
					(entry): entry is { name: string; path: string } =>
						typeof entry.name === "string" && typeof entry.path === "string",
				)
				.map(entry => ({ name: entry.name, path: entry.path })),
		};
	}

	async register(id: string, directory: string): Promise<void> {
		const profile = this.#profile(id);
		const session = this.#session(id);
		if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(directory)) throw new Error("远端目录必须是绝对路径");
		await session.http.gateway("/api/projects", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: directory }),
		});
		this.#store.update(profile.id, { lastDirectory: directory });
		this.#changed();
	}

	async bootstrap(id: string): Promise<unknown> {
		return this.#session(id).http.bootstrap();
	}

	async query(id: string, request: unknown): Promise<unknown> {
		return this.#session(id).http.query(request);
	}

	async command(id: string, request: unknown): Promise<unknown> {
		return this.#session(id).http.command(request);
	}

	async installRuntime(id: string): Promise<{ installed: boolean; message?: string }> {
		const profile = this.#profile(id);
		const session = this.#session(id);
		if (profile.authMode === "password") {
			return { installed: false, message: "密码凭据只在连接期间保留；安装 Runtime 请使用 SSH 密钥或 ssh-agent。" };
		}
		const target = profile.platform === "win32" ? "win32" : profile.platform === "darwin" ? "darwin" : "linux";
		const artifact = process.env[`ZETA_REMOTE_RUNTIME_${target.toUpperCase()}`] ?? process.env.ZETA_REMOTE_RUNTIME;
		if (!artifact) {
			return {
				installed: false,
				message: `没有为 ${target} 配置 Remote Runtime 包（设置 ZETA_REMOTE_RUNTIME_${target.toUpperCase()}）。SSH 目标可继续使用远端已有的 zeta。`,
			};
		}
		const installRoot =
			profile.installRoot ?? (target === "win32" ? "C:/ProgramData/Zeta/remote" : "~/.local/share/zeta/remote");
		const current = this.#statuses.get(id) ?? { id, state: "connected" as const, generation: 0 };
		this.#setStatus({ ...current, operation: "installing-runtime", stage: "upload" });
		await runRemote(profile, {}, this.#deps.userData, `mkdir -p ${remoteShellPath(installRoot)}`);
		await uploadRuntime(profile, {}, this.#deps.userData, artifact, installRoot);
		await runRemote(
			profile,
			{},
			this.#deps.userData,
			`cd ${remoteShellPath(installRoot)} && ./${shellQuote(path.basename(artifact))} --version`,
			30_000,
		);
		this.#setStatus({
			id,
			state: "connected",
			generation: session.generation,
			stage: "verify",
			message: "Remote Runtime 已上传并验证",
		});
		return { installed: true };
	}

	async retryNetwork(id: string): Promise<void> {
		const profile = this.#profile(id);
		try {
			const probe = await probeRemote(profile, {}, this.#deps.userData);
			this.#store.update(id, { platform: probe.platform });
			const current = this.#statuses.get(id) ?? { id, state: "disconnected" as const, generation: 0 };
			this.#setStatus({
				...current,
				message: `远端可达：${probe.platform}/${probe.arch}`,
				platform: probe.platform,
				arch: probe.arch,
				networkMessage: probe.zetaPath
					? `${probe.binary ?? "zeta"}${probe.version ? ` ${probe.version}` : ""}: ${probe.zetaPath}`
					: "未找到远端 zetacode/zeta",
			});
		} catch (error) {
			const current = this.#statuses.get(id) ?? { id, state: "failed" as const, generation: 0 };
			this.#setStatus({ ...current, message: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}

	/** Tunnel origin for one connected target; undefined means "not connected". */
	baseUrl(id: string): string | undefined {
		const session = this.#sessions.get(id);
		if (!session || this.#statuses.get(id)?.state !== "connected") return undefined;
		return `http://127.0.0.1:${session.tunnel.localPort}`;
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.#sessions.keys()].map(id => this.disconnect(id)));
	}

	#profile(id: string): RemoteConnectionProfile {
		const profile = this.#store.snapshot().profiles.find(value => value.id === id);
		if (!profile) throw new Error("SSH connection not found");
		return profile;
	}

	#session(id: string): Session {
		const session = this.#sessions.get(id);
		if (!session) throw new Error(`${RESYNC_REQUIRED}: SSH 未连接；操作未发送，也不会回落到本机`);
		const status = this.#statuses.get(id);
		if (status?.state !== "connected" || status.generation !== session.generation) {
			throw new Error(`${RESYNC_REQUIRED}: SSH 连接已改变；请等待重新同步`);
		}
		return session;
	}

	#setStatus(status: RemoteConnectionStatus): void {
		this.#statuses.set(status.id, status);
		this.#changed();
	}

	#changed(): void {
		this.#deps.changed(this.inventory());
	}
}
