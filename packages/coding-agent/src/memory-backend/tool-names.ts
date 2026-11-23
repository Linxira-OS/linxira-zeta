/** Built-in tools whose availability depends on the selected memory backend. */
export const MEMORY_BACKEND_TOOL_NAMES = ["retain", "recall", "reflect", "memory_edit", "learn"] as const;

/** Render memory tool names as `xd://` device refs when the device is mounted. */
export function memoryToolRefs(mountedDevices: readonly { name: string }[] = []): Record<string, string> {
	const mounted = new Set(mountedDevices.map(device => device.name));
	return Object.fromEntries(MEMORY_BACKEND_TOOL_NAMES.map(name => [name, mounted.has(name) ? `xd://${name}` : name]));
}
