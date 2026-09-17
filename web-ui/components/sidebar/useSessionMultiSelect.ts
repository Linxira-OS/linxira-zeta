/**
 * Multi-select state for the session sidebar (OpenCodeUI anchor+range model,
 * no external store dependency).
 *
 * `anchorId` is the last item clicked without Shift; Shift+click selects the
 * range from the anchor to the clicked item within the caller's currently
 * visible id list. Plain click (in edit mode) toggles a single item and moves
 * the anchor.
 */
import { useCallback, useMemo, useState } from "react";

export interface SessionMultiSelect {
	/** Edit mode toggle. */
	enabled: boolean;
	selectedIds: ReadonlySet<string>;
	anchorId: string | null;
	setEnabled: (next: boolean) => void;
	toggleItem: (id: string, opts?: { shift?: boolean; visibleIds?: readonly string[] }) => void;
	selectRange: (fromId: string, toId: string, visibleIds: readonly string[]) => void;
	selectAll: (visibleIds: readonly string[]) => void;
	clear: () => void;
	/** Drop ids that no longer exist (session deleted/archived). */
	prune: (existingIds: ReadonlySet<string>) => void;
}

export function useSessionMultiSelect(): SessionMultiSelect {
	const [enabled, setEnabled] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);

	const clear = useCallback(() => {
		setSelected(new Set());
		setAnchorId(null);
	}, []);

	const setEnabledAndReset = useCallback((next: boolean) => {
		setEnabled(next);
		if (!next) {
			setSelected(new Set());
			setAnchorId(null);
		}
	}, []);

	const selectRange = useCallback(
		(fromId: string, toId: string, visibleIds: readonly string[]) => {
			const start = visibleIds.indexOf(fromId);
			const end = visibleIds.indexOf(toId);
			if (start < 0 || end < 0) {
				setSelected((prev) => new Set(prev).add(toId));
				return;
			}
			const [lo, hi] = start <= end ? [start, end] : [end, start];
			setSelected((prev) => {
				const next = new Set(prev);
				for (let i = lo; i <= hi; i++) next.add(visibleIds[i]);
				return next;
			});
		},
		[],
	);

	const toggleItem = useCallback(
		(id: string, opts?: { shift?: boolean; visibleIds?: readonly string[] }) => {
			if (opts?.shift && anchorId && opts.visibleIds) {
				selectRange(anchorId, id, opts.visibleIds);
				return;
			}
			setSelected((prev) => {
				const next = new Set(prev);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			setAnchorId(id);
		},
		[anchorId, selectRange],
	);

	const selectAll = useCallback((visibleIds: readonly string[]) => {
		setSelected(new Set(visibleIds));
	}, []);

	const prune = useCallback((existingIds: ReadonlySet<string>) => {
		setSelected((prev) => {
			if (prev.size === 0) return prev;
			const next = new Set([...prev].filter(id => existingIds.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, []);

	return useMemo(
		() => ({
			enabled,
			selectedIds: selected,
			anchorId,
			setEnabled: setEnabledAndReset,
			toggleItem,
			selectRange,
			selectAll,
			clear,
			prune,
		}),
		[enabled, selected, anchorId, setEnabledAndReset, toggleItem, selectRange, selectAll, clear, prune],
	);
}
