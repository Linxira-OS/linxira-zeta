/**
 * Host actions only the process that owns `zetacode serve` can perform.
 *
 * The gateway is the control surface every attached client reaches; the serve
 * command registers the handler once its listeners are bound. Keeping the
 * callback here (instead of importing the CLI from the gateway) preserves the
 * dependency direction: gateway → control plane, never gateway → command.
 */

export type ServeRestartHandler = () => void | Promise<void>;

/**
 * Delay between accepting the HTTP request and taking the listener down. The
 * response body must reach the client before `shutdown()` closes the socket;
 * a microtask runs before Bun flushes the response (observed as an empty 200).
 */
const RESTART_FLUSH_DELAY_MS = 100;

let restartHandler: ServeRestartHandler | null = null;

/** Install the current process's restart action (serve CLI). */
export function registerServeRestartHandler(handler: ServeRestartHandler | null): void {
	restartHandler = handler;
}

/** Whether this process can restart itself (false in tests/library embeds). */
export function canRestartServe(): boolean {
	return restartHandler !== null;
}

/**
 * Accept a restart request and run the handler in the background so the HTTP
 * response can flush before the listener goes down. The caller is expected to
 * reconnect; clients that see the socket close without a new identity record
 * should retry discovery.
 */
export function requestServeRestart(): { accepted: boolean; reason?: string } {
	const handler = restartHandler;
	if (!handler) return { accepted: false, reason: "this server was not started by `zetacode serve`" };
	const timer = setTimeout(() => {
		void Promise.resolve()
			.then(handler)
			.catch(() => {
				// The handler owns its failure reporting; a restart request must
				// never reject into the HTTP response after it was accepted.
			});
	}, RESTART_FLUSH_DELAY_MS);
	timer.unref?.();
	return { accepted: true };
}
