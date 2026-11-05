/**
 * Origin guards shared by every browser-facing surface of `zeta serve`
 * (`/api/*` REST, the RPC and terminal WebSockets, and the Studio host).
 *
 * They live in their own module so a surface can import the guard without
 * importing the whole gateway dispatcher — the Studio host is mounted by the
 * gateway and would otherwise form an import cycle.
 */

/**
 * CSRF guard for browser clients: cross-site requests carry an `Origin`
 * header (even on simple POSTs), so reject any Origin that is not a local
 * loopback origin. Non-browser clients (curl, the desktop shell, the IM
 * channels) send no Origin and are unaffected. Only enforced for
 * unauthenticated loopback callers — a valid remote token already
 * authenticates the request (see the gateway's access gate).
 */
export function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return true;
	try {
		const url = new URL(origin);
		const host = url.hostname;
		return host === "127.0.0.1" || host === "localhost" || host === "::1";
	} catch {
		return false;
	}
}

/** Whether the request originates from a loopback socket address (local UI /
 *  desktop shell). Uses the SOCKET peer address — never the client-controlled
 *  `Host` header, which a remote attacker can spoof to pose as loopback. */
export function hostIsLoopback(_req: Request, remoteAddr?: string): boolean {
	const addr = (remoteAddr ?? "").replace(/^\[|\]$/g, "").toLowerCase();
	if (addr === "") return false;
	return addr === "127.0.0.1" || addr === "::1" || addr === "localhost";
}
