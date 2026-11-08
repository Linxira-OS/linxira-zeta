import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";

/**
 * Window caption controls for the frameless desktop shell.
 *
 * `desktop/` creates its BrowserWindow with `frame: false` on every platform,
 * so the OS draws no caption buttons and the renderer must own
 * minimize / maximize-restore / close. The preload bridge (`window.piDesktop`)
 * carries the IPC and pushes maximize state back, so this module only renders
 * buttons when that bridge exists: a plain browser tab (no preload) never gets
 * fake desktop chrome and keeps its native window controls.
 *
 * macOS is frameless in this shell too, so the same custom buttons are correct
 * there — there are no native traffic lights to duplicate.
 */
export interface DesktopWindowControlBridge {
	minimize(): Promise<void>;
	maximize(): Promise<void>;
	close(): Promise<void>;
	isMaximized?(): Promise<boolean>;
	onWindowState?(listener: (state: { maximized: boolean }) => void): () => void;
}

interface DesktopWindowControlSource {
	readonly piDesktop?: Partial<DesktopWindowControlBridge>;
}

/**
 * The shell's window-control bridge, or `undefined` outside the desktop app.
 * All three action IPC methods must exist: a partial bridge means this is not
 * the frameless Electron shell and the renderer must not draw caption buttons.
 */
export function desktopWindowBridge(
	target: DesktopWindowControlSource = globalThis as unknown as DesktopWindowControlSource,
): DesktopWindowControlBridge | undefined {
	const api = target.piDesktop;
	if (api === undefined) return undefined;
	if (typeof api.minimize !== "function" || typeof api.maximize !== "function" || typeof api.close !== "function") {
		return undefined;
	}
	return api as DesktopWindowControlBridge;
}

/**
 * Track the OS maximize state through the preload bridge. The initial query
 * covers a window restored as maximized; the subscription covers everything
 * after that (caption button, double-click on the drag region, snap, …).
 * Returns an unsubscribe function.
 */
export function subscribeWindowMaximized(
	bridge: DesktopWindowControlBridge,
	onChange: (maximized: boolean) => void,
): () => void {
	let disposed = false;
	const initial = bridge.isMaximized?.();
	if (initial !== undefined) {
		void initial
			.then(maximized => {
				if (!disposed) onChange(maximized);
			})
			.catch(() => {
				// The bridge is gone (window closing); keep the last known state.
			});
	}
	const unsubscribe = bridge.onWindowState?.(state => {
		if (!disposed) onChange(state.maximized);
	});
	return () => {
		disposed = true;
		unsubscribe?.();
	};
}

function CaptionGlyph({ children }: { children: ReactNode }) {
	return (
		<svg className="icon window-control-icon" viewBox="0 0 16 16" aria-hidden="true">
			{children}
		</svg>
	);
}

/**
 * Minimize / maximize-restore / close, rendered at the trailing edge of the
 * existing titlebar. Renders nothing outside the desktop shell.
 */
export function WindowControls() {
	const { t } = useI18n();
	const bridge = desktopWindowBridge();
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		if (bridge === undefined) return;
		return subscribeWindowMaximized(bridge, setMaximized);
	}, [bridge]);

	if (bridge === undefined) return null;
	const run = (action: () => Promise<void>) => {
		void action().catch(() => {
			// The window may already be gone; the OS is the source of truth.
		});
	};
	return (
		<div className="window-controls">
			<button
				type="button"
				className="window-control"
				data-tip={t("shell.minimize")}
				aria-label={t("shell.minimize")}
				onClick={() => run(() => bridge.minimize())}
			>
				<CaptionGlyph>
					<path d="M4 8h8" />
				</CaptionGlyph>
			</button>
			<button
				type="button"
				className="window-control"
				data-tip={maximized ? t("shell.restore") : t("shell.maximize")}
				aria-label={maximized ? t("shell.restore") : t("shell.maximize")}
				onClick={() => run(() => bridge.maximize())}
			>
				{maximized ? (
					<CaptionGlyph>
						<rect x="3.5" y="5.5" width="7" height="7" rx="0.5" />
						<path d="M5.5 5.5V4.5A1 1 0 0 1 6.5 3.5h6A1 1 0 0 1 13.5 4.5v6A1 1 0 0 1 12.5 11.5h-1" />
					</CaptionGlyph>
				) : (
					<CaptionGlyph>
						<rect x="4.5" y="4.5" width="7" height="7" rx="0.5" />
					</CaptionGlyph>
				)}
			</button>
			<button
				type="button"
				className="window-control close"
				data-tip={t("shell.closeWindow")}
				aria-label={t("shell.closeWindow")}
				onClick={() => run(() => bridge.close())}
			>
				<CaptionGlyph>
					<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
				</CaptionGlyph>
			</button>
		</div>
	);
}
