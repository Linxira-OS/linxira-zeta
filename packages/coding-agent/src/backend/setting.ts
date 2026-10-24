/**
 * Global-only read/write helpers for the backend mode switch.
 *
 * The effective value of a normal setting merges project, overlay and runtime
 * layers. Backend mode must not: a checkout cannot enable a machine-wide
 * service. These helpers read and write only the global user layer.
 */
import { Settings } from "../config/settings";
import { cfgBackendEnabled, cfgBackendWorkspace } from "./settings";

interface GlobalBackendLayer {
	backend?: { enabled?: unknown; workspace?: unknown };
}

async function settingsForRead(settings: Settings | undefined): Promise<Settings> {
	if (settings) return settings;
	return (await Settings.current) ?? (await Settings.loadReadOnly());
}

async function settingsForWrite(settings: Settings | undefined): Promise<Settings> {
	if (settings) return settings;
	return (await Settings.current) ?? (await Settings.loadIsolated());
}

export async function readBackendEnabledSetting(options: { settings?: Settings } = {}): Promise<boolean> {
	const settings = await settingsForRead(options.settings);
	const global = settings.getGlobalSettings() as GlobalBackendLayer;
	return global.backend?.enabled === true;
}

export async function writeBackendEnabledSetting(value: boolean, options: { settings?: Settings } = {}): Promise<void> {
	const settings = await settingsForWrite(options.settings);
	cfgBackendEnabled.set(settings, value);
	await settings.flush();
}

export async function readBackendWorkspaceSetting(options: { settings?: Settings } = {}): Promise<string> {
	const settings = await settingsForRead(options.settings);
	const global = settings.getGlobalSettings() as GlobalBackendLayer;
	const value = global.backend?.workspace;
	return typeof value === "string" ? value.trim() : "";
}

export async function writeBackendWorkspaceSetting(
	value: string,
	options: { settings?: Settings } = {},
): Promise<void> {
	const settings = await settingsForWrite(options.settings);
	cfgBackendWorkspace.set(settings, value);
	await settings.flush();
}
