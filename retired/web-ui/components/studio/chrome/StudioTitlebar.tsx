"use client";

/**
 * StudioTitlebar — the window chrome row.
 *
 * Ported from OMP Studio (`apps/renderer/src/App.tsx` → `Titlebar`, MIT). What
 * changed:
 *
 * - Back / forward are driven by the `route` prop alone: the bar keeps its own
 *   visit trail, so the shell does not have to (Studio kept exactly this trail
 *   in `App.tsx`). A route change from outside the bar appends; the bar's own
 *   back/forward moves the cursor and then calls `onRoute`.
 * - The window controls (minimize / maximize / close) render only when the
 *   platform says the shell owns a frameless window
 *   (`capabilities.windowControls`) and go through `lib/pi-desktop`, which is a
 *   no-op in a browser tab. Studio called `ompStudioChrome`.
 * - The preview-mode switch is gone (a Studio development affordance). The
 *   `children` slot takes its place on the right.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PlatformCapabilities, StudioRoute } from "../adapters/types";
import { Icon } from "../primitives/icons";
import {
	closeWindow,
	isWindowMaximized,
	maximizeWindow,
	minimizeWindow,
	subscribeWindowState,
} from "@/lib/pi-desktop";
import { useI18n } from "@/hooks/useI18n";

export interface StudioTitlebarProps {
	capabilities: PlatformCapabilities;
	/** The route the shell is showing; also the trail's current entry. */
	route: StudioRoute;
	onRoute(route: StudioRoute): void;
	/** Title menus (`TitleMenu` items); rendered inside `.title-menus`. */
	menus?: ReactNode;
	/** Right-hand slot (status chip, update button, …). */
	children?: ReactNode;
	onToggleSidebar?: () => void;
	sidebarCollapsed?: boolean;
}

interface Trail {
	readonly stack: readonly StudioRoute[];
	readonly at: number;
}

export function StudioTitlebar({
	capabilities,
	route,
	onRoute,
	menus,
	children,
	onToggleSidebar,
	sidebarCollapsed,
}: StudioTitlebarProps) {
	const { t } = useI18n();
	const [trail, setTrail] = useState<Trail>({ stack: [route], at: 0 });
	const lastRoute = useRef(route);
	/** Set by the bar's own back/forward so the prop change is not re-appended. */
	const expected = useRef<StudioRoute | null>(null);

	// Adjusting state while rendering on a prop change (the React-documented
	// pattern) keeps the trail consistent in the same commit as `route`.
	if (lastRoute.current !== route) {
		lastRoute.current = route;
		if (expected.current === route) {
			expected.current = null;
		} else if (trail.stack[trail.at] !== route) {
			const stack = [...trail.stack.slice(0, trail.at + 1), route];
			setTrail({ stack, at: stack.length - 1 });
		}
	}

	const go = useCallback(
		(index: number) => {
			const target = trail.stack[index];
			if (target === undefined) return;
			expected.current = target;
			setTrail({ stack: trail.stack, at: index });
			onRoute(target);
		},
		[trail, onRoute],
	);

	const canBack = trail.at > 0;
	const canForward = trail.at < trail.stack.length - 1;

	return (
		<header
			className="app-titlebar"
			data-route={route}
			data-native-titlebar={capabilities.nativeTitlebar ? "true" : undefined}
		>
			{onToggleSidebar ? (
				<button
					type="button"
					className="icon-btn"
					data-tip={sidebarCollapsed ? t("studio.action.expand") : t("studio.action.collapse")}
					aria-label={sidebarCollapsed ? t("layout.expandSidebar") : t("studio.action.collapse")}
					aria-controls="studioSidebar"
					aria-expanded={sidebarCollapsed === false}
					onClick={onToggleSidebar}
				>
					<Icon name="layout" />
				</button>
			) : null}
			<button
				type="button"
				className="icon-btn"
				data-tip={t("studio.chrome.titlebar.back")}
				aria-label={t("studio.chrome.titlebar.back")}
				disabled={!canBack}
				onClick={() => go(trail.at - 1)}
			>
				<Icon name="arrow-l" />
			</button>
			<button
				type="button"
				className="icon-btn"
				data-tip={t("studio.chrome.titlebar.forward")}
				aria-label={t("studio.chrome.titlebar.forward")}
				disabled={!canForward}
				onClick={() => go(trail.at + 1)}
			>
				<Icon name="arrow-r" />
			</button>
			<nav className="title-menus" aria-label={t("studio.chrome.menu.label")}>
				{menus}
			</nav>
			<div className="titlebar-end">{children}</div>
			{capabilities.windowControls ? <WindowControls /> : null}
		</header>
	);
}

/** Native caption buttons for the frameless desktop window. */
function WindowControls() {
	const { t } = useI18n();
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void isWindowMaximized().then(value => {
			if (!cancelled) setMaximized(value);
		});
		const off = subscribeWindowState(state => setMaximized(state.maximized));
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	return (
		<div className="titlebar-window-controls">
			<button
				type="button"
				className="wc-btn"
				aria-label={t("studio.chrome.titlebar.minimize")}
				data-tip={t("studio.chrome.titlebar.minimize")}
				onClick={() => void minimizeWindow()}
			>
				<Icon name="minimize" extra="sm" />
			</button>
			<button
				type="button"
				className="wc-btn"
				aria-label={t(maximized ? "studio.chrome.titlebar.restore" : "studio.chrome.titlebar.maximize")}
				data-tip={t(maximized ? "studio.chrome.titlebar.restore" : "studio.chrome.titlebar.maximize")}
				onClick={() => void maximizeWindow()}
			>
				<Icon name={maximized ? "restore" : "maximize"} extra="sm" />
			</button>
			<button
				type="button"
				className="wc-btn wc-btn-close"
				aria-label={t("studio.chrome.titlebar.close")}
				data-tip={t("studio.chrome.titlebar.close")}
				onClick={() => void closeWindow()}
			>
				<Icon name="x" extra="sm" />
			</button>
		</div>
	);
}
