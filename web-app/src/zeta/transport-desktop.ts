/**
 * Desktop transport stand-in.
 *
 * Studio's own build would build a transport from the Electron preload bridge
 * here. Zeta injects a client on `globalThis.OMP_STUDIO_CLIENT` instead, so
 * this module only exists to satisfy the renderer's static import. It never
 * runs when a client is injected, and throws rather than inventing one.
 */
import type { ClientTransport } from "../protocol/contract/index";

export function createDesktopTransport(_host?: unknown): ClientTransport {
	throw new Error(
		"Zeta injects StudioClient on globalThis.OMP_STUDIO_CLIENT; the desktop transport is not available in this build.",
	);
}
