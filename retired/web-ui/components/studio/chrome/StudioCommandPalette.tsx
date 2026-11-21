"use client";

/**
 * StudioCommandPalette — ⌘K / Ctrl+K launcher.
 *
 * Ported from OMP Studio (`apps/renderer/src/CommandPalette.tsx`, MIT). The
 * component is callback-driven: it takes the session rows the shell already
 * holds and an action bag, and never touches a client. Search, keyboard
 * navigation and the visual shell are Studio's.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../primitives/icons";
import { useI18n } from "@/hooks/useI18n";
import type { StudioSessionSummary } from "../adapters/types";
import {
	buildPaletteGroups,
	flattenPaletteItems,
	runPaletteAction,
	type PaletteItem,
	type StudioPaletteActions,
} from "./palette-catalog";
import { isPrimaryModifier } from "./shortcuts";
import { studioPortalTarget } from "./portal";

export interface StudioCommandPaletteProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	/** Rows for the "recent sessions" group; the shell's own list. */
	sessions: readonly StudioSessionSummary[];
	actions: StudioPaletteActions;
}

export function StudioCommandPalette({ open, onOpenChange, sessions, actions }: StudioCommandPaletteProps) {
	const { t } = useI18n();
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);

	const groups = useMemo(
		() => buildPaletteGroups({ t, query, sessions, actions, untitledTitle: t("studio.chrome.palette.untitled") }),
		[t, query, sessions, actions],
	);
	const flat = useMemo(() => flattenPaletteItems(groups), [groups]);
	const selectedId = flat[selected]?.id;

	const close = () => onOpenChange(false);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelected(0);
		const id = window.requestAnimationFrame(() => inputRef.current?.focus());
		return () => window.cancelAnimationFrame(id);
	}, [open]);

	useEffect(() => {
		setSelected(0);
	}, [query]);

	useEffect(() => {
		if (selected >= flat.length) setSelected(0);
	}, [flat.length, selected]);

	useEffect(() => {
		if (!open || !selectedId || !listRef.current) return;
		const el = listRef.current.querySelector(`[data-cmdk-id="${CSS.escape(selectedId)}"]`);
		if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
	}, [open, selectedId]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onOpenChange(false);
				return;
			}
			if (event.isComposing) return;
			if (isPrimaryModifier(event) && /^[1-9]$/.test(event.key) && !event.shiftKey && !event.altKey) {
				const index = Number(event.key);
				const recent = flat.find(item => item.recentIndex === index);
				if (recent) {
					event.preventDefault();
					runPaletteAction(recent.action, actions);
					onOpenChange(false);
				}
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				if (!flat.length) return;
				setSelected(value => (value + 1) % flat.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				if (!flat.length) return;
				setSelected(value => (value - 1 + flat.length) % flat.length);
			} else if (event.key === "Home") {
				event.preventDefault();
				setSelected(0);
			} else if (event.key === "End") {
				event.preventDefault();
				if (flat.length) setSelected(flat.length - 1);
			} else if (event.key === "Enter") {
				event.preventDefault();
				const item = flat[selected];
				if (item) {
					runPaletteAction(item.action, actions);
					onOpenChange(false);
				}
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open, flat, selected, onOpenChange, actions]);

	if (!open) return null;

	const activeDescendant = selectedId ? `studioCmdkItem-${selectedId}` : undefined;

	return createPortal(
		<div
			className="cmdk-backdrop"
			role="presentation"
			onMouseDown={event => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div className="cmdk-shell">
				<div className="cmdk-glow" aria-hidden="true" />
				<div
					className="cmdk"
					role="dialog"
					aria-modal="true"
					aria-label={t("studio.chrome.palette.title")}
					onMouseDown={event => event.stopPropagation()}
				>
					<div className="cmdk-input">
						<Icon name="search" extra="sm" />
						<input
							ref={inputRef}
							type="text"
							role="combobox"
							aria-expanded="true"
							aria-controls="studioCmdkList"
							aria-autocomplete="list"
							aria-label={t("studio.chrome.palette.search")}
							{...(activeDescendant ? { "aria-activedescendant": activeDescendant } : {})}
							placeholder={t("studio.chrome.palette.placeholder")}
							value={query}
							onChange={event => setQuery(event.target.value)}
						/>
						<span className="kbd" aria-hidden="true">
							Esc
						</span>
					</div>
					<div className="cmdk-list" id="studioCmdkList" ref={listRef} role="listbox" aria-label={t("studio.chrome.palette.results")}>
						{flat.length === 0 ? (
							<div className="cmdk-empty">
								<Icon name="search" />
								{t("studio.chrome.palette.empty")}
							</div>
						) : (
							groups.map(group => (
								<div className="cmdk-group" key={group.id} role="group" aria-label={group.label}>
									<div className="cmdk-group-label">{group.label}</div>
									{group.items.map(item => (
										<PaletteRow
											key={item.id}
											item={item}
											selected={item.id === selectedId}
											onHover={() => {
												const index = flat.findIndex(entry => entry.id === item.id);
												if (index >= 0) setSelected(index);
											}}
											onRun={() => {
												runPaletteAction(item.action, actions);
												onOpenChange(false);
											}}
										/>
									))}
								</div>
							))
						)}
					</div>
					<div className="sr-only" role="status" aria-live="polite">
						{flat.length ? t("studio.chrome.palette.count", { count: flat.length }) : t("studio.chrome.palette.empty")}
					</div>
				</div>
			</div>
		</div>,
		studioPortalTarget(),
	);
}

function PaletteRow({
	item,
	selected,
	onHover,
	onRun,
}: {
	item: PaletteItem;
	selected: boolean;
	onHover(): void;
	onRun(): void;
}) {
	return (
		<button
			type="button"
			className={`cmdk-item${selected ? " sel" : ""}`}
			id={`studioCmdkItem-${item.id}`}
			data-cmdk-id={item.id}
			role="option"
			aria-selected={selected}
			onPointerEnter={onHover}
			onClick={onRun}
		>
			<Icon name={item.icon} extra="sm" />
			<span className="cmdk-item-label">{item.label}</span>
			{item.meta ? <span className="cmdk-item-meta">{item.meta}</span> : null}
			{item.hint ? <span className="kbd">{item.hint}</span> : null}
		</button>
	);
}
