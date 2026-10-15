"use client";

import {
	Children,
	isValidElement,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
} from "react";
import {
	DOCK_RAIL_WIDTH,
	getDefaultRightPanelWidth,
	getRightPanelMaxWidth,
	getSidebarMaxWidth,
	resolveShellTracks,
	RIGHT_PANEL_FALLBACK_WIDTH,
	RIGHT_PANEL_MAX_WIDTH,
	RIGHT_PANEL_MIN_WIDTH,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import { useI18n } from "@/hooks/useI18n";
import {
	DEFAULT_SHELL_MODE,
	SHELL_MODE_ATTRIBUTE,
	SHELL_REGION_ATTRIBUTE,
	type ShellMode,
} from "@/lib/shell-mode";
import { useColumnResize } from "./useColumnResize";

export type ShellSlotName = "sidebar" | "topbar" | "tabs" | "center" | "rail" | "dockWindow";

export interface ShellSlotProps {
	name: ShellSlotName;
	children?: ReactNode;
}

/**
 * Named slot inside <ShellLayout>. ShellLayout owns the actual column
 * containers (and their resize wiring); callers only supply the inner content,
 * so no column markup is duplicated between the shell and its callers.
 */
export function ShellSlot({ children }: ShellSlotProps) {
	return <>{children}</>;
}

export interface ShellLayoutProps {
	/**
	 * Which regions the shell owns. `embed` renders the center column only (the
	 * conversation + composer) and skips every chrome column, handle and inset;
	 * `full` renders the three-column desktop shell. Defaults to `full`.
	 */
	mode?: ShellMode;
	sidebarOpen: boolean;
	sidebarCollapsed: boolean;
	detailOpen: boolean;
	isMobile: boolean;
	/** Frameless-desktop titlebar inset (px) applied as top padding. */
	desktopChromeInset: number;
	children?: ReactNode;
}

function useViewportWidth(): number {
	const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
	useEffect(() => {
		const onResize = () => setWidth(window.innerWidth);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return width;
}

/**
 * Three-column shell (plan §2.2). The outer element is a CSS grid whose tracks
 * are explicit pixels resolved by the pure `resolveShellTracks` yield chain;
 * the middle track is always `minmax(0, 1fr)` so the chat never collapses. The
 * two drag handles sit on 8px invisible hit areas, use pointer capture + rAF
 * throttling, and suppress the track transition while dragging (and under
 * reduced motion).
 */
export function ShellLayout({
	mode = DEFAULT_SHELL_MODE,
	sidebarOpen,
	sidebarCollapsed,
	detailOpen,
	isMobile,
	desktopChromeInset,
	children,
}: ShellLayoutProps) {
	const { t } = useI18n();
	const viewportWidth = useViewportWidth();
	const embed = mode === "embed";

	const elements = Children.toArray(children).filter(
		(child): child is ReactElement<ShellSlotProps> => isValidElement(child) && child.type === ShellSlot,
	);
	const slotOf = (name: ShellSlotName): ReactNode =>
		elements.find(element => element.props.name === name)?.props.children ?? null;

	const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
	const detailWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
	const sidebarRail = sidebarCollapsed && !isMobile;

	const sidebarResizer = useColumnResize({
		ariaLabel: t("layout.resizeSidebar"),
		cssVariable: "--sidebar-width",
		defaultWidth: SIDEBAR_DEFAULT_WIDTH,
		getMaxWidth: () =>
			getSidebarMaxWidth({
				viewportWidth,
				rightPanelOpen: detailOpen,
				rightPanelWidth: detailWidthRef.current,
			}),
		growthDirection: "right",
		maxWidth: SIDEBAR_MAX_WIDTH,
		minWidth: SIDEBAR_MIN_WIDTH,
		storageKey: "zeta-sidebar-width",
		widthRef: sidebarWidthRef,
	});

	const detailResizer = useColumnResize({
		ariaLabel: t("layout.resizeFilePanel"),
		cssVariable: "--right-panel-width",
		defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
		getDefaultWidth: () => getDefaultRightPanelWidth(viewportWidth),
		getMaxWidth: () =>
			getRightPanelMaxWidth({
				viewportWidth,
				sidebarOpen,
				sidebarWidth: sidebarWidthRef.current,
			}),
		growthDirection: "left",
		maxWidth: RIGHT_PANEL_MAX_WIDTH,
		minWidth: RIGHT_PANEL_MIN_WIDTH,
		storageKey: "zeta-right-panel-width",
		widthRef: detailWidthRef,
	});

	const reclampSidebar = sidebarResizer.reclampWidth;
	const reclampDetail = detailResizer.reclampWidth;
	useEffect(() => {
		if (!detailOpen) return;
		reclampSidebar();
		reclampDetail();
	}, [detailOpen, reclampDetail, reclampSidebar]);

	const tracks = resolveShellTracks({
		viewportWidth,
		sidebarOpen,
		sidebarCollapsed: sidebarRail,
		detailOpen,
		sidebarWidth: sidebarResizer.width,
		detailWidth: detailResizer.width,
	});

	const resizing = sidebarResizer.isResizing || detailResizer.isResizing;
	const dockWindowWidth = Math.max(0, tracks.details - DOCK_RAIL_WIDTH);
	// In-flow: the dock window fills the grid track minus the rail. Overlay
	// (compact/mobile): the track holds only the rail, so the fixed-position
	// window keeps its own resolved width.
	const dockWidthVar = tracks.detailOverlay ? detailResizer.width : dockWindowWidth;

	const sidebarClasses = [
		"sidebar-container",
		sidebarRail && "sidebar-collapsed",
		sidebarOpen ? "sidebar-open" : "sidebar-closed",
		sidebarResizer.isResizing && "sidebar-resizing",
	]
		.filter(Boolean)
		.join(" ");

	const detailClasses = [
		"right-panel-container",
		detailOpen ? "right-panel-open" : "right-panel-closed",
		detailResizer.isResizing && "right-panel-resizing",
	]
		.filter(Boolean)
		.join(" ");

	const gridStyle: CSSProperties = {
		gridTemplateColumns: embed
			? "minmax(0, 1fr)"
			: `${tracks.sidebar}px minmax(0, 1fr) ${tracks.details}px`,
		// Embed is mounted inside a host surface: no desktop titlebar inset.
		paddingTop: embed ? 0 : desktopChromeInset,
	};

	return (
		<>
			<style>{`
        .shell-grid {
          display: grid;
          width: 100%;
          height: var(--app-viewport-height, 100dvh);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
          overflow: hidden;
          background: var(--zeta-alias-bg);
          box-sizing: border-box;
          transition: grid-template-columns 0.2s ease;
        }
        /* Embed: the conversation column is the whole surface — the host owns
           the frame, so no safe-area padding and no track transition. */
        .shell-grid--embed {
          padding-left: 0;
          padding-right: 0;
          transition: none;
        }
        .shell-grid.is-resizing {
          transition: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .shell-grid {
            transition: none !important;
          }
        }
        .shell-col {
          display: flex;
          min-width: 0;
          min-height: 0;
        }
        .shell-col--sidebar {
          position: relative;
          flex-direction: column;
          z-index: 200;
        }
        .shell-col--center {
          flex-direction: column;
          overflow: hidden;
        }
        .shell-col--details {
          flex-direction: row;
          align-items: stretch;
        }
        /* Region wrappers carry the data-shell-region contract only: they must
           never introduce a box (the slot payload stays a direct child of its
           column, exactly as before the wrappers existed). */
        .shell-chrome {
          display: contents;
        }
        .shell-handle {
          position: relative;
          z-index: 220;
          flex: 0 0 var(--resize-hit-area, 8px);
          width: var(--resize-hit-area, 8px);
          margin: 0 calc(var(--resize-hit-area, 8px) / -2);
          cursor: col-resize;
          touch-action: none;
          outline: none;
          align-self: stretch;
        }
        .shell-handle--sidebar {
          position: absolute;
          top: 0;
          bottom: 0;
          right: calc(var(--resize-hit-area, 8px) / -2);
          margin: 0;
          flex: none;
        }
        .shell-handle::after {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: calc(50% - 1px);
          width: 2px;
          pointer-events: none;
          background: transparent;
          transition: background 0.12s ease;
        }
        .shell-handle:hover::after,
        .shell-handle:focus-visible::after,
        .shell-handle.is-resizing::after {
          background: color-mix(in srgb, var(--zeta-alias-text-muted) 70%, var(--zeta-alias-border));
        }
      `}</style>
			<div
				className={`shell-grid${resizing ? " is-resizing" : ""}${embed ? " shell-grid--embed" : ""}`}
				style={gridStyle}
				{...{ [SHELL_MODE_ATTRIBUTE]: mode }}
			>
				{!embed && (
					<div className="shell-col shell-col--sidebar" {...{ [SHELL_REGION_ATTRIBUTE]: "sidebar" }}>
						<div
							ref={sidebarResizer.panelRef}
							id="session-sidebar"
							className={sidebarClasses}
							style={
								{
									"--sidebar-width": `${tracks.sidebar}px`,
									background: "var(--zeta-alias-bg-panel)",
									borderRight: "1px solid var(--zeta-alias-border)",
									display: "flex",
									flexDirection: "column",
									flexShrink: 0,
									paddingTop: "env(safe-area-inset-top)",
									paddingBottom: "env(safe-area-inset-bottom)",
									zIndex: 200,
								} as CSSProperties
							}
						>
							{slotOf("sidebar")}
						</div>
						{sidebarOpen && !sidebarRail && (
							<div
								{...sidebarResizer.separatorProps}
								aria-controls="session-sidebar"
								className={`panel-resize-handle shell-handle shell-handle--sidebar${sidebarResizer.isResizing ? " is-resizing" : ""}`}
								data-resize-handle="sidebar"
								title={`${t("layout.resizeSidebar")}: ${t("layout.resizeHint")}`}
							/>
						)}
					</div>
				)}

				<div className="shell-col shell-col--center" {...{ [SHELL_REGION_ATTRIBUTE]: "center" }}>
					{!embed && (
						<div className="shell-chrome shell-chrome--topbar" {...{ [SHELL_REGION_ATTRIBUTE]: "topbar" }}>
							{slotOf("topbar")}
						</div>
					)}
					{slotOf("center")}
					{!embed && (
						<div className="shell-chrome shell-chrome--tabs" {...{ [SHELL_REGION_ATTRIBUTE]: "tabs" }}>
							{slotOf("tabs")}
						</div>
					)}
				</div>

				{!embed && (
					<div className="shell-col shell-col--details" {...{ [SHELL_REGION_ATTRIBUTE]: "details" }}>
						<div className="shell-chrome shell-chrome--rail" {...{ [SHELL_REGION_ATTRIBUTE]: "rail" }}>
							{slotOf("rail")}
						</div>
						<div
							{...detailResizer.separatorProps}
							aria-controls="right-tool-dock"
							className={`panel-resize-handle shell-handle right-panel-resize-handle${detailResizer.isResizing ? " is-resizing" : ""}`}
							data-resize-handle="right-panel"
							title={`${t("layout.resizeFilePanel")}: ${t("layout.resizeHint")}`}
							style={{ ...detailResizer.separatorProps.style, display: detailOpen ? undefined : "none" }}
						/>
						<div
							ref={detailResizer.panelRef}
							id="right-tool-dock"
							className={detailClasses}
							{...{ [SHELL_REGION_ATTRIBUTE]: "dockWindow" }}
							style={
								{
									"--right-panel-width": `${dockWidthVar}px`,
									display: "flex",
									flexDirection: "column",
									borderLeft: "1px solid var(--zeta-alias-border)",
									background: "var(--zeta-alias-bg)",
								} as CSSProperties
							}
						>
							{slotOf("dockWindow")}
						</div>
					</div>
				)}
			</div>
		</>
	);
}
