/**
 * Read/write the global-only `backend.autostart` decision.
 *
 * The effective value of a registry setting merges project, overlay and
 * runtime layers. Autostart must not: a project checkout cannot decide that
 * this machine starts a background service. These helpers therefore read the
 * raw global layer (`~/.zeta/agent/config.yml`) directly, and writes go
 * through {@link cfgBackendAutostart}`, whose `set()` always persists to that
 * same global layer.
 */
import { Settings } from "../config/settings";
import { cfgBackendAutostart } from "./settings";

interface GlobalBackendLayer {
	backend?: { autostart?: unknown };
}

async function settingsForRead(settings: Settings | undefined): Promise<Settings> {
	if (settings) return settings;
	return (await Settings.current) ?? (await Settings.loadReadOnly());
}

async function settingsForWrite(settings: Settings | undefined): Promise<Settings> {
	if (settings) return settings;
	return (await Settings.current) ?? (await Settings.loadIsolated());
}

/** Global user config only; a project or overlay value is deliberately ignored. */
export async function readBackendAutostartSetting(options: { settings?: Settings } = {}): Promise<boolean> {
	const settings = await settingsForRead(options.settings);
	const global = settings.getGlobalSettings() as GlobalBackendLayer;
	return global.backend?.autostart === true;
}

/** Persist the decision to the global user config and flush it. */
export async function writeBackendAutostartSetting(
	value: boolean,
	options: { settings?: Settings } = {},
): Promise<void> {
	const settings = await settingsForWrite(options.settings);
	cfgBackendAutostart.set(settings, value);
	await settings.flush();
}
