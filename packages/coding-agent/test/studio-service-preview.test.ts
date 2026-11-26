// @ts-nocheck — drives the OMP 19.2 per-user daemon that replaced the project launch broker for named services
import { describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "../src/config/settings";
import { closeDaemonClient, daemonClient } from "../src/daemon/client";
import { daemonDbPath } from "../src/daemon/paths";
import {
	DAEMON_DIR_ENV,
	DAEMON_IDLE_EXIT_GRACE_ENV,
	DAEMON_TCP_ENV,
	type DaemonClient,
	type UnitSnapshot,
} from "../src/daemon/protocol";
import { readStoredUnits } from "../src/daemon/store";
import { listServices, requestService, startService } from "../src/launch/services";
import { projectService } from "../src/server/studio-host/services/project-services";
import type { ToolSession } from "../src/tools";
import { BashTool } from "../src/tools/bash";
import { TestDaemon } from "./fixtures/daemon-proc-harness";
import { waitFor } from "./fixtures/daemon-harness";

async function withDaemon(run: (session: ToolSession, client: DaemonClient) => Promise<void>): Promise<void> {
	const scratch = path.resolve(import.meta.dir, "../../../temp");
	await fs.mkdir(scratch, { recursive: true });
	using temp = TempDir.createSync(path.join(scratch, "zeta-studio-service-preview-"));
	const projectDir = path.join(temp.path(), "project");
	await fs.mkdir(projectDir);
	// The harness owns a real daemon process (a 10 s client-start deadline is
	// too tight for a cold start here); point the shared client at it instead of
	// letting `daemonClient()` spawn a racing second one. A longer idle grace
	// keeps the daemon up while the first named-pipe connection is established.
	const { daemon } = await TestDaemon.start({ env: { [DAEMON_IDLE_EXIT_GRACE_ENV]: "60000" } });
	const previousDir = process.env[DAEMON_DIR_ENV];
	const previousTcp = process.env[DAEMON_TCP_ENV];
	await closeDaemonClient();
	process.env[DAEMON_DIR_ENV] = daemon.dir;
	delete process.env[DAEMON_TCP_ENV];
	const disposers: Array<() => void> = [];
	const session: ToolSession = {
		cwd: projectDir,
		hasUI: false,
		settings: Settings.isolated(),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getSessionId: () => "main-session-42",
		getAgentId: () => "Main",
		registerDisposeCallback: callback => {
			disposers.push(callback);
		},
	};
	try {
		await run(session, await daemonClient());
	} finally {
		for (const dispose of disposers.splice(0)) dispose();
		vi.restoreAllMocks();
		await closeDaemonClient();
		if (previousDir === undefined) delete process.env[DAEMON_DIR_ENV];
		else process.env[DAEMON_DIR_ENV] = previousDir;
		if (previousTcp === undefined) delete process.env[DAEMON_TCP_ENV];
		else process.env[DAEMON_TCP_ENV] = previousTcp;
		await daemon.dispose();
	}
}

const command = "echo studio-ready; read answer";
const ready = { log: "studio-ready", timeout: 30 };

function unitRef(unit: UnitSnapshot): { kind: string; scope: UnitSnapshot["scope"]; key: string } {
	return { kind: "proc", scope: unit.scope, key: unit.key };
}

function expectPreview(daemon: UnitSnapshot, previewUrl: string): void {
	expect(daemon.previewUrl).toBe(previewUrl);
	expect(daemon.owner).toBe("main-session-42");
	expect(projectService(daemon)).toMatchObject({
		previewUrl,
		ownerId: "main-session-42",
		ownerAgentId: "main-session-42",
	});
}

describe("Studio Agent-created service previews", () => {
	it("carries bash preview metadata through daemon reads, restart, and persisted state", async () => {
		await withDaemon(async session => {
			const shell = session.settings.getShellConfig();
			vi.spyOn(session.settings, "getShellConfig").mockReturnValue({
				...shell,
				env: { ...shell.env, STUDIO_TEST_SERVICE_SECRET: "never-publish-env" },
			});
			const previewUrl = "http://localhost:4100/?view=main";
			const tool = await new BashTool(session).execute("main-start-dev", {
				command: `${command} # never-publish-command`,
				name: "web-dev",
				previewUrl: "HTTP://LOCALHOST:4100/app/../?view=main",
				pty: false,
				ready,
			});
			expect(tool.details?.service).toMatchObject({ name: "web-dev", ready: true, timedOut: false });
			const listed = (await listServices(session))[0]!;
			expectPreview(listed, previewUrl);
			expect(listed.pids[0]).toBeGreaterThan(0);
			const row = projectService(listed);
			expect(row.pid).toBe(listed.pids[0]);
			for (const field of ["env", "command", "args", "application", "spec"]) expect(row).not.toHaveProperty(field);
			expect(JSON.stringify(row)).not.toContain("never-publish");
			const described = await requestService(session, { op: "describe", unit: unitRef(listed) });
			expectPreview(described.unit, previewUrl);
			expect(described.proc?.previewUrl).toBe(previewUrl);
			expect(projectService(described.unit).instanceId).toBe(row.instanceId);
			const stored = await waitFor(
				() => readStoredUnits(daemonDbPath()).find(unit => unit.key === "web-dev" && unit.proc?.previewUrl),
				"the started service to persist its preview",
			);
			expect(stored.proc.previewUrl).toBe(previewUrl);
			expect(stored.snapshot.previewUrl).toBe(previewUrl);
			expect(stored.owner).toBe("main-session-42");
			const restarted = await requestService(session, { op: "restart", unit: unitRef(listed) });
			expectPreview(restarted.unit, previewUrl);
			await waitFor(
				() => restarted.unit.pids[0] ?? readStoredUnits(daemonDbPath()).find(unit => unit.key === "web-dev")?.pid,
				"the restarted service to get a pid",
			);
			const nextId = projectService(restarted.unit).instanceId;
			expect(nextId).not.toBe(row.instanceId);
			const waited = await requestService(session, {
				op: "wait",
				unit: unitRef(listed),
				for: "ready",
				timeoutMs: 30_000,
			});
			expect(waited.matched).toBe(true);
			expectPreview(waited.unit, previewUrl);
			const recovered = await waitFor(
				() =>
					readStoredUnits(daemonDbPath()).find(
						unit => unit.key === "web-dev" && unit.snapshot.startedAt === restarted.unit.startedAt,
					),
				"the restarted service generation to persist",
			);
			expect(recovered.snapshot.previewUrl).toBe(previewUrl);
			expect(recovered.proc.previewUrl).toBe(previewUrl);
			expect(projectService((await listServices(session))[0]!).instanceId).toBe(nextId);
			const https = await startService(session, {
				name: "web-dev",
				command,
				ready,
				pty: false,
				previewUrl: "HTTPS://LOCALHOST:4443",
			});
			expectPreview(https.daemon, "https://localhost:4443/");
		});
	}, 120000);

	it("leaves non-web previews absent and preserves legacy or missing owners without guessing", async () => {
		await withDaemon(async session => {
			// A URL in a name, command, or readiness output is not preview metadata.
			const tool = await new BashTool(session).execute("main-start-worker", {
				command: "echo http://localhost:4200; read answer",
				name: "localhost-4200",
				pty: false,
				ready: { log: "http://localhost:4200", timeout: 30 },
			});
			expect(tool.details?.service?.ready).toBe(true);
			const listed = (await listServices(session))[0]!;
			expect(listed).not.toHaveProperty("previewUrl");
			expect(projectService(listed)).not.toHaveProperty("previewUrl");
			const described = await requestService(session, { op: "describe", unit: unitRef(listed) });
			expect(described.proc).not.toHaveProperty("previewUrl");
			expect(described.unit).not.toHaveProperty("previewUrl");
			const legacy = await startService(
				{ ...session, getSessionId: () => null },
				{
					name: "legacy-worker",
					command,
					ready,
					pty: false,
				},
			);
			expect(projectService(legacy.daemon)).toMatchObject({ ownerId: "Main", ownerAgentId: "Main" });
			const unowned = await startService(
				{ ...session, getSessionId: undefined, getAgentId: undefined },
				{
					name: "unowned-worker",
					command,
					ready,
					pty: false,
				},
			);
			expect(projectService(unowned.daemon)).not.toHaveProperty("ownerId");
			expect(projectService(unowned.daemon)).not.toHaveProperty("ownerAgentId");
		});
	}, 120000);

	it("refuses preview starts against a resident old daemon without replacing its services", async () => {
		await withDaemon(async (session, client) => {
			const existing = await startService(session, { name: "server", command, ready, pty: false });
			const instanceId = projectService(existing.daemon).instanceId;
			const request = client.request.bind(client);
			// Model an older daemon that still speaks the same protocol, but would
			// silently discard previewUrl if the new Agent sent it an open request.
			vi.spyOn(client, "request").mockImplementation(async (operation, signal) => {
				if (operation.op === "ping") return { pid: process.pid, build: client.welcome.daemon.build };
				return request(operation, signal);
			});
			for (const name of ["new-server", "server"]) {
				await expect(
					new BashTool(session).execute("old-daemon-preview", {
						command,
						name,
						previewUrl: "http://localhost:4100",
						pty: false,
					}),
				).rejects.toThrow("This project broker does not support preview URLs");
			}
			const listed = await listServices(session);
			expect(listed).toHaveLength(1);
			expect(projectService(listed[0]!).instanceId).toBe(instanceId);
			expect(listed[0]!.state).toBe("ready");
			// Services without preview metadata remain compatible with older daemons.
			const ordinary = await startService(session, { name: "worker", command, ready, pty: false });
			expect(ordinary.daemon.state).toBe("ready");
			expect(ordinary.daemon).not.toHaveProperty("previewUrl");
		});
	}, 120000);

	it("rejects invalid preview URLs before launching or replacing an existing service", async () => {
		await withDaemon(async session => {
			const existing = await startService(session, { name: "server", command, ready, pty: false });
			const instanceId = projectService(existing.daemon).instanceId;
			for (const previewUrl of [
				"not a URL",
				"/relative",
				"file:///tmp/index.html",
				"http://user:secret@localhost:4100",
				"",
			]) {
				const attempt = new BashTool(session).execute("invalid-preview", {
					command,
					name: "server",
					previewUrl,
					pty: false,
				});
				await expect(attempt).rejects.toThrow(
					"previewUrl must be an absolute HTTP(S) URL without embedded credentials",
				);
			}
			const listed = await listServices(session);
			expect(listed).toHaveLength(1);
			expect(projectService(listed[0]!).instanceId).toBe(instanceId);
			expect(listed[0]!.state).toBe("ready");
		});
	}, 120000);
});
