import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, powerMonitor, type WebContents } from "electron";
import { PerfProfileService } from "./perf-profile";
import { registerPerfProfileIpc } from "./perf-profile-ipc";
import { PERF_PROFILE_CHANNELS, type PerfProfileSender } from "./perf-profile-shared";

/** Initialize once before the first preload reads the cache. */
export async function installPerfProfiles(options: { root: string; trusted(sender: WebContents): boolean; log(message: string): void }): Promise<void> {
	const cache = join(options.root, "perf-profile.json");
	let settled = false;
	const trusted = (sender: PerfProfileSender): boolean => BrowserWindow.getAllWindows().some(window => window.webContents === sender && options.trusted(window.webContents));
	const service = new PerfProfileService({
		getGPUFeatureStatus: () => app.getGPUFeatureStatus() as unknown as Readonly<Record<string, string>>,
		async getGLRenderer() {
			const info = await app.getGPUInfo("complete") as { gpuDevice?: Array<{ glRenderer?: unknown }>; auxAttributes?: { glRenderer?: unknown } };
			const renderer = info.auxAttributes?.glRenderer ?? info.gpuDevice?.[0]?.glRenderer;
			return typeof renderer === "string" ? renderer : undefined;
		},
		cores: () => os.cpus().length,
		totalMemoryBytes: () => os.totalmem(),
		onBattery: () => powerMonitor.isOnBatteryPower(),
		now: () => new Date(),
		readCache: async () => JSON.parse(await fs.readFile(cache, "utf8")) as unknown,
		async writeCache(snapshot) {
			await fs.mkdir(options.root, { recursive: true });
			const temporary = `${cache}.tmp`;
			await fs.writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
			await fs.rename(temporary, cache);
		},
		log: (_level, event, detail) => options.log(`${event}: ${detail}`),
		onChanged(snapshot) {
			for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && options.trusted(window.webContents)) window.webContents.send(PERF_PROFILE_CHANNELS.changed, snapshot);
		},
		gpuStatusSettled: () => settled,
	});
	registerPerfProfileIpc({ ipcMain, isTrustedSender: trusted, service });
	await service.load();
	const refresh = () => { void service.refresh(true).catch(error => options.log(`GPU profile: ${String(error)}`)); };
	const settle = () => { settled = true; refresh(); };
	app.on("gpu-info-update", settle);
	powerMonitor.on("on-battery", refresh);
	powerMonitor.on("on-ac", refresh);
	const timer = setTimeout(() => { if (!settled) settle(); }, 2_000);
	timer.unref();
	refresh();
	app.once("will-quit", () => { clearTimeout(timer); app.removeListener("gpu-info-update", settle); powerMonitor.removeListener("on-battery", refresh); powerMonitor.removeListener("on-ac", refresh); });
}
