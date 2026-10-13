"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampPanelWidth, PANEL_RESIZE_HIT_AREA } from "@/lib/panel-layout";

/**
 * Shell column resizer. Differs from a naive drag handler in three ways the
 * plan calls out explicitly (plan §2.2):
 *  - the pointer move handler is throttled to one update per animation frame
 *    (`requestAnimationFrame`), so a burst of pointermove events collapses to a
 *    single layout pass;
 *  - the drag owns a pointer capture on the handle, so the drag survives the
 *    pointer leaving the 8px hit area;
 *  - the handle only *touches* an 8px invisible hit area (see
 *    `PANEL_RESIZE_HIT_AREA`) rendered by the caller; the visual hairline is
 *    drawn with CSS.
 */

interface DragState {
	pointerId: number;
	startX: number;
	startWidth: number;
	target: HTMLDivElement;
	previousCursor: string;
	previousUserSelect: string;
}

export interface UseColumnResizeOptions {
	ariaLabel: string;
	cssVariable: `--${string}`;
	defaultWidth: number;
	getDefaultWidth?: () => number;
	getMaxWidth: () => number;
	growthDirection: "left" | "right";
	maxWidth: number;
	minWidth: number;
	storageKey: string;
	widthRef: React.MutableRefObject<number>;
}

function readStoredWidth(storageKey: string): number | null {
	try {
		const stored = window.localStorage.getItem(storageKey);
		if (stored === null) return null;
		const parsed = Number.parseInt(stored, 10);
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function writeStoredWidth(storageKey: string, width: number): void {
	try {
		window.localStorage.setItem(storageKey, String(width));
	} catch {
		// Resizing stays usable when storage is unavailable.
	}
}

export function useColumnResize(options: UseColumnResizeOptions) {
	const {
		ariaLabel,
		cssVariable,
		defaultWidth,
		getDefaultWidth,
		getMaxWidth,
		growthDirection,
		maxWidth,
		minWidth,
		storageKey,
		widthRef,
	} = options;

	const panelRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const frameRef = useRef<number | null>(null);
	const pendingXRef = useRef(0);
	const restoredRef = useRef(false);
	const [width, setWidth] = useState(defaultWidth);
	const [isResizing, setIsResizing] = useState(false);

	const clampWidth = useCallback(
		(candidate: number) => clampPanelWidth(candidate, minWidth, Math.min(maxWidth, Math.max(minWidth, getMaxWidth()))),
		[getMaxWidth, maxWidth, minWidth],
	);

	const applyWidth = useCallback(
		(nextWidth: number) => {
			widthRef.current = nextWidth;
			panelRef.current?.style.setProperty(cssVariable, `${nextWidth}px`);
			setWidth(nextWidth);
		},
		[cssVariable, widthRef],
	);

	const commitWidth = useCallback(
		(candidate: number, persist: boolean) => {
			const nextWidth = clampWidth(candidate);
			const changed = nextWidth !== widthRef.current;
			applyWidth(nextWidth);
			if (persist && changed) writeStoredWidth(storageKey, nextWidth);
			return nextWidth;
		},
		[applyWidth, clampWidth, storageKey, widthRef],
	);

	const cancelFrame = useCallback(() => {
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
	}, []);

	const restoreBodyState = useCallback((drag: DragState) => {
		document.body.style.cursor = drag.previousCursor;
		document.body.style.userSelect = drag.previousUserSelect;
	}, []);

	const finishResize = useCallback(
		(pointerId: number) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== pointerId) return;
			cancelFrame();
			dragRef.current = null;
			restoreBodyState(drag);
			setIsResizing(false);
			commitWidth(widthRef.current, true);
			try {
				if (drag.target.hasPointerCapture(pointerId)) drag.target.releasePointerCapture(pointerId);
			} catch {
				// Capture may already be gone after a pointer cancel.
			}
		},
		[cancelFrame, commitWidth, restoreBodyState, widthRef],
	);

	const applyPendingMove = useCallback(() => {
		frameRef.current = null;
		const drag = dragRef.current;
		if (!drag) return;
		const direction = growthDirection === "right" ? 1 : -1;
		const nextWidth = clampWidth(drag.startWidth + (pendingXRef.current - drag.startX) * direction);
		applyWidth(nextWidth);
		const handle = drag.target;
		handle.setAttribute("aria-valuenow", String(nextWidth));
		handle.setAttribute("aria-valuetext", `${nextWidth} px`);
	}, [applyWidth, clampWidth, growthDirection]);

	const onPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.pointerType === "mouse" && event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();

			const activeDrag = dragRef.current;
			if (activeDrag) finishResize(activeDrag.pointerId);

			const target = event.currentTarget;
			target.focus({ preventScroll: true });
			target.setPointerCapture(event.pointerId);
			pendingXRef.current = event.clientX;
			dragRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startWidth: widthRef.current,
				target,
				previousCursor: document.body.style.cursor,
				previousUserSelect: document.body.style.userSelect,
			};
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			setIsResizing(true);
		},
		[finishResize, widthRef],
	);

	const onPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			if (event.pointerType === "mouse" && event.buttons === 0) {
				finishResize(event.pointerId);
				return;
			}
			event.preventDefault();
			pendingXRef.current = event.clientX;
			// rAF throttle: at most one width write per animation frame.
			if (frameRef.current === null) {
				frameRef.current = requestAnimationFrame(applyPendingMove);
			}
		},
		[applyPendingMove, finishResize],
	);

	const onPointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			finishResize(event.pointerId);
		},
		[finishResize],
	);

	const onPointerCancel = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			finishResize(event.pointerId);
		},
		[finishResize],
	);

	const onLostPointerCapture = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			finishResize(event.pointerId);
		},
		[finishResize],
	);

	const resetWidth = useCallback(() => {
		commitWidth(getDefaultWidth?.() ?? defaultWidth, true);
	}, [commitWidth, defaultWidth, getDefaultWidth]);

	const reclampWidth = useCallback(() => {
		commitWidth(widthRef.current, false);
	}, [commitWidth, widthRef]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const step = event.shiftKey ? 32 : 12;
			const growKey = growthDirection === "right" ? "ArrowRight" : "ArrowLeft";
			const shrinkKey = growthDirection === "right" ? "ArrowLeft" : "ArrowRight";

			if (event.key === growKey) {
				event.preventDefault();
				commitWidth(widthRef.current + step, true);
			} else if (event.key === shrinkKey) {
				event.preventDefault();
				commitWidth(widthRef.current - step, true);
			} else if (event.key === "Home") {
				event.preventDefault();
				commitWidth(minWidth, true);
			} else if (event.key === "End") {
				event.preventDefault();
				commitWidth(Math.min(maxWidth, Math.max(minWidth, getMaxWidth())), true);
			} else if (event.key === "Enter") {
				event.preventDefault();
				resetWidth();
			}
		},
		[commitWidth, getMaxWidth, growthDirection, maxWidth, minWidth, resetWidth, widthRef],
	);

	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;
		const storedWidth = readStoredWidth(storageKey);
		const candidate = storedWidth ?? getDefaultWidth?.() ?? defaultWidth;
		const restoredWidth = commitWidth(candidate, false);
		if (storedWidth !== null && storedWidth !== restoredWidth) writeStoredWidth(storageKey, restoredWidth);
	}, [commitWidth, defaultWidth, getDefaultWidth, storageKey]);

	useEffect(() => {
		if (!restoredRef.current) return;
		commitWidth(widthRef.current, false);
		const onResize = () => commitWidth(widthRef.current, false);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [commitWidth, widthRef]);

	useEffect(() => {
		if (!isResizing) return;
		const onBlur = () => {
			const drag = dragRef.current;
			if (drag) finishResize(drag.pointerId);
		};
		window.addEventListener("blur", onBlur);
		return () => window.removeEventListener("blur", onBlur);
	}, [finishResize, isResizing]);

	const separatorProps = {
		role: "separator" as const,
		tabIndex: 0,
		"aria-label": ariaLabel,
		"aria-orientation": "vertical" as const,
		"aria-valuemin": minWidth,
		"aria-valuemax": maxWidth,
		"aria-valuenow": width,
		"aria-valuetext": `${width} px`,
		style: { ["--resize-hit-area" as string]: `${PANEL_RESIZE_HIT_AREA}px` },
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onLostPointerCapture,
		onKeyDown,
	};

	return { panelRef, width, isResizing, reclampWidth, resetWidth, separatorProps };
}
