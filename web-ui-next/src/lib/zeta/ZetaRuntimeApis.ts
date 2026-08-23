import type { RuntimeAPIs } from "@/lib/api/types";
import { NotImplementedError } from "./ZetaGatewayService";

/**
 * Phase-1 RuntimeAPIs adapter for zeta.
 *
 * `runtime` is authoritative (the zeta gateway is a web backend). Small
 * surfaces get explicit benign implementations; the large file/git/terminal
 * surfaces are auto-rejecting stubs until their phases port them onto zeta
 * gateway endpoints (see `./README.md`).
 */

function rejectingApi<T>(name: string): T {
	return new Proxy(
		{},
		{
			get(_target, prop) {
				// Never present as thenable.
				if (prop === "then") return undefined;
				const operation = `${name}.${String(prop)}`;
				return () => Promise.reject(new NotImplementedError(operation));
			},
		},
	) as T;
}

const settingsStore = new Map<string, unknown>();

export function createZetaRuntimeApis(): RuntimeAPIs {
	return {
		runtime: {
			platform: "web",
			isDesktop: false,
			isVSCode: false,
			label: "zeta-gateway",
		},
		terminal: rejectingApi("terminal"),
		git: rejectingApi("git"),
		files: rejectingApi("files"),
		settings: {
			async load() {
				return { settings: Object.fromEntries(settingsStore) as never, source: "web" };
			},
			async save(changes) {
				for (const [key, value] of Object.entries(changes)) {
					settingsStore.set(key, value);
				}
				return { ...Object.fromEntries(settingsStore), ...changes } as never;
			},
		},
		permissions: {
			async requestDirectoryAccess() {
				return { success: true };
			},
			async startAccessingDirectory() {
				return { success: true };
			},
			async stopAccessingDirectory() {
				return { success: true };
			},
		},
		notifications: {
			async notifyAgentCompletion() {
				return false;
			},
			canNotify: () => false,
		},
		tools: {
			async getAvailableTools() {
				return [];
			},
		},
	};
}
