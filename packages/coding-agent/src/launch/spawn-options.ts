/** Platform-specific options for the launch broker and its non-PTY children. */
export interface DaemonSpawnOptions {
	detached: boolean;
	windowsHide?: boolean;
}

/**
 * Keep launch processes headless without discarding an inheritable Windows
 * console. `detached: true` on every platform so the broker (and its daemon
 * children) outlive the process that spawned them: with `detached: false` on
 * Windows, Bun joins the child to the parent's job, and the broker dies with
 * the first consumer that started it — killing every daemon it owns mid-flight
 * (browser relay lease test). `windowsHide` still applies on win32 so a
 * headless host never flashes a console window.
 */
export function resolveDaemonSpawnOptions(opts: {
	platform: NodeJS.Platform;
	hostHasInheritableConsole: boolean;
}): DaemonSpawnOptions {
	return {
		detached: true,
		...(opts.platform === "win32" ? { windowsHide: !opts.hostHasInheritableConsole } : {}),
	};
}
