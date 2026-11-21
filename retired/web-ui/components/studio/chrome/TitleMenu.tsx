"use client";

/**
 * Titlebar dropdown menu.
 *
 * Ported from OMP Studio (`apps/renderer/src/App.tsx` → `TitleMenu`, MIT). The
 * only changes are mechanical: the popover portals into `.studio-root` instead
 * of `document.body` (see `portal.ts` — the ported sheets are scoped there),
 * and one open menu closes another through `TitleMenuScope` instead of a
 * `openId` prop threaded from the app root.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { studioPortalTarget } from "./portal";

interface TitleMenuScopeValue {
	readonly openId: string | null;
	setOpenId(id: string | null): void;
}

const TitleMenuContext = createContext<TitleMenuScopeValue | null>(null);

/**
 * Container that keeps at most one titlebar menu open. Wrap the `menus` node
 * passed to `StudioTitlebar`; a lone `TitleMenu` works without it.
 */
export function TitleMenuScope({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);
	return <TitleMenuContext.Provider value={{ openId, setOpenId }}>{children}</TitleMenuContext.Provider>;
}

export function TitleMenu({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	const scope = useContext(TitleMenuContext);
	const [localOpen, setLocalOpen] = useState<string | null>(null);
	const openId = scope ? scope.openId : localOpen;
	const setOpenId = scope ? scope.setOpenId : setLocalOpen;
	const open = openId === id;

	const wrapRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	const [anchor, setAnchor] = useState({ top: 0, left: 0 });
	const menuId = useId();

	useLayoutEffect(() => {
		if (!open || !buttonRef.current) return;
		const rect = buttonRef.current.getBoundingClientRect();
		setAnchor({ top: rect.bottom + 2, left: rect.left });
	}, [open]);

	// Close on Escape, on an outside press, and when the window moves under the
	// popover — a fixed-position menu left anchored to a scrolled page lies.
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setOpenId(null);
			buttonRef.current?.focus();
		};
		const onPress = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (wrapRef.current?.contains(target)) return;
			if (popRef.current?.contains(target)) return;
			setOpenId(null);
		};
		const onMove = () => setOpenId(null);
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("mousedown", onPress, true);
		window.addEventListener("resize", onMove);
		window.addEventListener("scroll", onMove, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("mousedown", onPress, true);
			window.removeEventListener("resize", onMove);
			window.removeEventListener("scroll", onMove, true);
		};
	}, [open, setOpenId]);

	return (
		<div ref={wrapRef} className={`title-menu${open ? " open" : ""}`}>
			<button
				ref={buttonRef}
				type="button"
				className="title-menu-btn"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpenId(open ? null : id)}
			>
				{label}
			</button>
			{open
				? createPortal(
						<div
							ref={popRef}
							id={menuId}
							className="menu title-menu-popover"
							role="menu"
							aria-label={label}
							style={{ top: anchor.top, left: anchor.left }}
							onMouseDown={event => {
								event.preventDefault();
								event.stopPropagation();
							}}
							onClick={event => {
								// Native menus close when a row is chosen; the row's own
								// handler runs first, this bubbles back up.
								if ((event.target as HTMLElement).closest(".menu-item")) setOpenId(null);
							}}
						>
							{children}
						</div>,
						studioPortalTarget(),
					)
				: null}
		</div>
	);
}
