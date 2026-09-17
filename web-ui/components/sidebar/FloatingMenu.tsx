/**
 * FloatingMenu — portal-rendered context menu (P2 interaction port).
 *
 * One primitive, three uses: session menu, project menu, zone menu. Opens at
 * either the pointer (right-click) or an anchor button ("…"), traps focus,
 * closes on scroll / outside click / Escape. Keyboard: ↑↓ move, Home/End
 * jump, Enter/Space activate, Esc close.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FloatingMenuItem {
	key: string;
	label: string;
	onSelect: () => void;
	danger?: boolean;
	disabled?: boolean;
	/** Menu checkbox row (sort visibility toggles etc.). */
	checked?: boolean;
	separatorBefore?: boolean;
}

interface FloatingMenuProps {
	open: boolean;
	onClose: (opts?: { restoreFocus?: boolean }) => void;
	items: FloatingMenuItem[];
	/** Viewport anchor: pointer coords take precedence over anchorRect. */
	point?: { x: number; y: number } | null;
	anchorRect?: DOMRect | null;
	label?: string;
}

const MENU_W = 190;

export function FloatingMenu({ open, onClose, items, point, anchorRect, label }: FloatingMenuProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
	const [active, setActive] = useState(0);

	useLayoutEffect(() => {
		if (!open) return;
		let x: number;
		let y: number;
		if (point) {
			x = point.x;
			y = point.y;
		} else if (anchorRect) {
			x = anchorRect.left;
			y = anchorRect.bottom + 4;
		} else {
			x = 40;
			y = 40;
		}
		const h = items.length * 28 + 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		x = Math.max(6, Math.min(x, vw - MENU_W - 6));
		y = y + h > vh - 6 ? Math.max(6, y - h - (anchorRect ? anchorRect.height + 8 : 0)) : y;
		setPos({ x, y });
		setActive(items.findIndex((i) => !i.disabled));
	}, [open, point, anchorRect, items]);

	useEffect(() => {
		if (!open) return;
		const el = ref.current;
		if (!el) return;
		const first = el.querySelector<HTMLElement>("[data-menuitem]:not([data-disabled])");
		first?.focus();

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose({ restoreFocus: true });
				return;
			}
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
			e.preventDefault();
			const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
			if (enabled.length === 0) return;
			let next: number;
			if (e.key === "Home") {
				next = enabled[0];
			} else if (e.key === "End") {
				next = enabled[enabled.length - 1];
			} else {
				const cur = enabled.indexOf(active);
				next =
					e.key === "ArrowDown"
						? enabled[(cur + 1) % enabled.length]
						: enabled[(cur - 1 + enabled.length) % enabled.length];
			}
			setActive(next);
			el.querySelector<HTMLElement>(`[data-menuitem][data-index="${next}"]`)?.focus();
		};
		const onScroll = () => onClose();
		const onMouseDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		document.addEventListener("mousedown", onMouseDown);
		return () => {
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll, true);
			document.removeEventListener("mousedown", onMouseDown);
		};
	}, [open, items, active, onClose]);

	if (!open || typeof document === "undefined") return null;

	const content = items.map((item, i) => (
		<MenuItem
			key={item.key}
			item={item}
			index={i}
			active={active === i}
			onFocus={() => setActive(i)}
			onSelect={() => {
				if (item.disabled) return;
				onClose();
				item.onSelect();
			}}
		/>
	));

	return createPortal(
		<div
			ref={ref}
			role="menu"
			aria-label={label}
			onMouseDown={(e) => e.stopPropagation()}
			style={{
				position: "fixed",
				left: pos?.x ?? -9999,
				top: pos?.y ?? -9999,
				visibility: pos ? "visible" : "hidden",
				zIndex: 300,
				minWidth: MENU_W,
				background: "var(--bg-elevated, var(--bg))",
				border: "1px solid var(--border)",
				borderRadius: 8,
				boxShadow: "var(--surface-shadow, 0 6px 20px rgba(0,0,0,0.18))",
				padding: 4,
				display: "flex",
				flexDirection: "column",
			}}
		>
			{content}
		</div>,
		document.body,
	);
}

function MenuItem({
	item,
	index,
	active,
	onFocus,
	onSelect,
}: {
	item: FloatingMenuItem;
	index: number;
	active: boolean;
	onFocus: () => void;
	onSelect: () => void;
}) {
	return (
		<>
			{item.separatorBefore && (
				<div role="separator" style={{ height: 1, background: "var(--border)", margin: "3px 4px" }} />
			)}
			<button
				data-menuitem
				data-index={index}
				data-disabled={item.disabled || undefined}
				role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
				aria-checked={item.checked}
				disabled={item.disabled}
				onMouseEnter={onFocus}
				onFocus={onFocus}
				onClick={onSelect}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					width: "100%",
					padding: "6px 8px",
					background: active ? "var(--bg-selected)" : "none",
					border: "none",
					borderRadius: 5,
					color: item.danger ? "var(--status-error)" : item.disabled ? "var(--text-dim)" : "var(--text)",
					cursor: item.disabled ? "default" : "pointer",
					fontSize: 11.5,
					textAlign: "left",
				}}
			>
				{item.checked !== undefined && (
					<span style={{ width: 12, flexShrink: 0, visibility: item.checked ? "visible" : "hidden" }}>✓</span>
				)}
				<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
			</button>
		</>
	);
}
