/**
 * Ambient declarations for the vendored Studio renderer.
 *
 * Studio is a Vite app; this build runs it under Next (webpack). Only the
 * bundle-time surface that the ported sources actually reference is declared
 * here — no Vite client types are installed.
 */

interface ImportMeta {
	/** Vite HMR teardown hook; undefined under Next, so the call is a no-op. */
	readonly hot?: { dispose(callback: () => void): void };
	readonly env?: Record<string, string | boolean | undefined>;
}

/** Shape of the desktop updater payload (`@omp-studio/runtime-installer`, not vendored). */
interface UnifiedUpdateSnapshot {
	readonly app?: { readonly version: string; readonly available: boolean };
	readonly runtime?: { readonly version: string; readonly available: boolean };
	readonly [key: string]: unknown;
}
