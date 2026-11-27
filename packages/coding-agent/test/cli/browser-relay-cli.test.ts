// @ts-nocheck — merge checkpoint: test callsites lag the OMP 19.1 API migration
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { TempDir } from "@linxiraos/pi-utils";
import { VERSION } from "@linxiraos/pi-utils/dirs";
import { runBrowserRelayCommand } from "@linxiraos/zeta/cli/browser-relay-cli";
import { relayExtensionFiles } from "@linxiraos/zeta/tools/browser/relay/extension-files";
import { findFreeCdpPort } from "@linxiraos/zeta/tools/browser/attach";
import { relayExtensionNotice } from "@linxiraos/zeta/tools/browser/relay/probe";
import { type RelayServer, startRelayServer } from "@linxiraos/zeta/tools/browser/relay/server";

/**
 * Run an installed `background.js` as Chrome would, against the relay on `port`, with `manifest` as what
 * `chrome.runtime.getManifest()` returns. Returns a stop function that keeps the worker from dialing again.
 */
function runExtensionWorker(script: string, port: number, manifest: object): () => void {
	let stopped = false;
	const event = { addListener() {} };
	const extensionId = "a".repeat(32);
	const messageListeners: Array<(message: unknown) => void> = [];
	const disconnectListeners: Array<() => void> = [];
	let hostSocket: WebSocket | undefined;
	const nativePort = {
		onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
		onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
		postMessage(message: { t?: string; line?: string }) {
			if (stopped) return;
			if (message.t === "link") {
				const socket = new WebSocket(`ws://127.0.0.1:${port}/ext`, {
					headers: { Origin: `chrome-extension://${extensionId}` },
				});
				hostSocket = socket;
				socket.addEventListener("open", () => {
					if (!stopped) for (const listener of messageListeners) listener({ t: "linked" });
				});
				socket.addEventListener("message", received => {
					if (typeof received.data === "string" && !stopped) {
						for (const listener of messageListeners) listener({ t: "relay", line: received.data });
					}
				});
				socket.addEventListener("close", () => {
					if (!stopped) for (const listener of disconnectListeners) listener();
				});
				return;
			}
			if (message.t === "relay" && message.line !== undefined) hostSocket?.send(message.line);
		},
		disconnect() {
			hostSocket?.close();
		},
	};
	const chrome = {
		storage: {
			local: {
				get: (defaults: Record<string, unknown>) =>
					stopped ? Promise.withResolvers<never>().promise : Promise.resolve({ ...defaults, port }),
				set: () => Promise.resolve(),
				onChanged: event,
			},
			session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
			onChanged: event,
		},
		tabs: {
			query: () => Promise.resolve([]),
			get: (tabId: number) => Promise.resolve({ id: tabId, windowId: 1, groupId: -1 }),
			create: () => Promise.resolve({ id: 2, windowId: 1, groupId: -1 }),
			update: (tabId: number) => Promise.resolve({ id: tabId, windowId: 1 }),
			remove: () => Promise.resolve(),
			group: () => Promise.resolve(1),
			ungroup: () => Promise.resolve(),
			onCreated: event,
			onUpdated: event,
			onActivated: event,
			onRemoved: event,
		},
		tabGroups: { query: () => Promise.resolve([]), update: () => Promise.resolve({}) },
		debugger: {
			getTargets: () => Promise.resolve([]),
			attach: () => Promise.resolve(),
			detach: () => Promise.resolve(),
			sendCommand: () => Promise.resolve({}),
			onEvent: event,
			onDetach: event,
		},
		downloads: { search: () => Promise.resolve([]), onCreated: event, onChanged: event },
		alarms: { create() {}, getAll: () => Promise.resolve([]), onAlarm: event },
		action: {
			setBadgeText: () => Promise.resolve(),
			setBadgeBackgroundColor: () => Promise.resolve(),
			setTitle: () => Promise.resolve(),
			onClicked: event,
		},
		sidePanel: {
			open: () => Promise.resolve(),
			close: () => Promise.resolve(),
			setPanelBehavior: () => Promise.resolve(),
		},
		notifications: {
			create: () => Promise.resolve("notification"),
			clear: () => Promise.resolve(true),
			onClicked: event,
		},
		commands: { onCommand: event },
		windows: {
			update: () => Promise.resolve({ id: 1 }),
			getLastFocused: () => Promise.resolve({ id: 1 }),
		},
		scripting: { executeScript: () => Promise.resolve([]) },
		dom: { openOrClosedShadowRoot: () => null },
		runtime: {
			id: extensionId,
			getManifest: () => manifest,
			openOptionsPage: () => Promise.resolve(),
			reload: () => {},
			connectNative: () => nativePort,
			onMessage: event,
			onConnect: event,
			onInstalled: event,
			onStartup: event,
		},
	};
	new Function("chrome", "navigator", script)(chrome, { userAgent: "Mozilla/5.0 Chrome/154.0.0.0" });
	return () => {
		stopped = true;
		hostSocket?.close();
	};
}

describe("zetacode browser-relay install", () => {
	let dir: TempDir;
	let relay: RelayServer | undefined;
	let stopWorker: (() => void) | undefined;

	beforeEach(async () => {
		dir = await TempDir.create("@omp-relay-install-");
		spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		stopWorker?.();
		relay?.stop();
		stopWorker = undefined;
		relay = undefined;
		mock.restore();
		await dir.remove();
	});

	it("stamps the installing Zeta's version into the extension manifest", async () => {
		await runBrowserRelayCommand({ action: "install", port: 0, dir: dir.path() });
		const manifest = await Bun.file(dir.join("manifest.json")).json();
		expect(manifest.version_name).toBe(VERSION);
		expect(manifest.manifest_version).toBe(3);
	});

	it("reports the Zeta that installed the running script when Chrome restarts onto a newer manifest", async () => {
		// After reinstalling, a Chrome restart re-reads manifest.json but keeps running the old service worker.
		const port = await findFreeCdpPort();
		const settled = Promise.withResolvers<void>();
		relay = startRelayServer({
			port,
			group: false,
			installRegistryFile: dir.join("installs.json"),
			log: message => {
				// The relay hides an outdated extension's version while it checks whether it may rewrite its files;
				// this worker is no registered install, so the check ends with the update stopped.
				if (message === "extension update stopped") settled.resolve();
			},
		});
		const runningScript = (await relayExtensionFiles("1.3.0"))["background.js"]!;
		const manifestOnDisk = JSON.parse((await relayExtensionFiles(VERSION))["manifest.json"]!);
		stopWorker = runExtensionWorker(runningScript, port, manifestOnDisk);
		await settled.promise;
		expect(await relayExtensionNotice(`http://127.0.0.1:${port}`)).toContain(
			`installed by zetacode 1.3.0; this is zeta ${VERSION}`,
		);
	});
});
