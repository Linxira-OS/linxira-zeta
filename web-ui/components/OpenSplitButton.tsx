"use client";

import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
	getDesktopOpenTargets,
	hasDesktopOpenBridge,
	openDesktopTarget,
	type DesktopOpenTarget,
	type GatewayOpenPath,
} from "@/lib/pi-desktop";
import type { TranslationParams } from "@/lib/i18n/types";

/**
 * Top-bar Open split button (spec D15): the left half opens the current
 * workspace with the remembered default target in one click, the right half
 * drops the full target menu. The default target persists in localStorage
 * (`zeta-open-default-target`); opening any target re-records it.
 */

/** localStorage key for the remembered default open target (spec D15). */
export const OPEN_DEFAULT_TARGET_KEY = "zeta-open-default-target";

/** GET /api/open/options target entry. */
export interface GatewayOpenTarget {
	type: "terminal" | "explorer" | "editor" | "terminal-ide" | "terminal-editor";
	label: string;
	available: boolean;
	default?: boolean;
	editor?: string;
	detail?: string;
}

/** One selectable row of the open menu (gateway and desktop-host entries merged). */
export interface OpenMenuEntry {
	/** POST-facing target id: "terminal" | "explorer" | "editor:<id>" | "terminal-ide" | "terminal-editor". */
	id: string;
	type: GatewayOpenTarget["type"];
	/** Gateway label: product name, resolved shell name, or host label. */
	label: string;
	/** Resolved absolute executable reported by the gateway probe. */
	detail?: string;
	available: boolean;
}

function clientTargetIdForOption(option: GatewayOpenTarget): string {
	return option.type === "editor" ? `editor:${option.editor ?? ""}` : option.type;
}

/** Host bridge id ("file-manager"/"editor:<id>") → client id, or null for unknown ids. */
function hostTargetToClientId(id: string): { id: string; type: OpenMenuEntry["type"] } | null {
	if (id === "file-manager") return { id: "explorer", type: "explorer" };
	if (id.startsWith("editor:")) return { id, type: "editor" };
	return null;
}

/**
 * Merges gateway options with desktop-host targets. In desktop mode the
 * gateway hides explorer/editors (the host executes those), so host entries
 * override the grayed gateway ones by id — no duplicates, no conflicts.
 */
export function buildOpenMenuEntries(
	gatewayTargets: GatewayOpenTarget[],
	desktopTargets: DesktopOpenTarget[] = [],
): OpenMenuEntry[] {
	const entries = new Map<string, OpenMenuEntry>();
	for (const option of gatewayTargets) {
		const id = clientTargetIdForOption(option);
		entries.set(id, { id, type: option.type, label: option.label, detail: option.detail, available: option.available });
	}
	for (const hostTarget of desktopTargets) {
		const client = hostTargetToClientId(hostTarget.id);
		if (!client) continue;
		entries.set(client.id, { id: client.id, type: client.type, label: hostTarget.label, available: true });
	}
	return [...entries.values()];
}

/** Active default target: stored choice → gateway suggestion → first available. */
export function resolveDefaultTargetId(
	entries: OpenMenuEntry[],
	storedId: string | null,
	gatewayDefaultId: string | null = null,
): string | null {
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	if (storedId && byId.get(storedId)?.available) return storedId;
	if (gatewayDefaultId && byId.get(gatewayDefaultId)?.available) return gatewayDefaultId;
	return entries.find(entry => entry.available)?.id ?? null;
}

/** POST /api/open body for a client target id at the given workspace path. */
export function buildOpenRequestBody(
	id: string,
	targetPath: string | null,
): { target: string; editor?: string; path?: string } {
	const body: { target: string; editor?: string; path?: string } = {
		target: id.startsWith("editor:") ? "editor" : id,
	};
	if (id.startsWith("editor:")) body.editor = id.slice("editor:".length);
	if (targetPath) body.path = targetPath;
	return body;
}

/** Desktop host id that executes this client target, or null for gateway-direct targets. */
export function desktopTargetIdFor(id: string): string | null {
	if (id === "explorer") return "file-manager";
	if (id.startsWith("editor:")) return id;
	return null;
}

function storage(): Storage | null {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		return null;
	}
}

export function readStoredDefaultTarget(store: Storage | null = storage()): string | null {
	try {
		return store?.getItem(OPEN_DEFAULT_TARGET_KEY) ?? null;
	} catch {
		return null;
	}
}

export function writeStoredDefaultTarget(id: string, store: Storage | null = storage()): void {
	try {
		store?.setItem(OPEN_DEFAULT_TARGET_KEY, id);
	} catch {
		// storage unavailable — the default just won't persist
	}
}

// --- icons (inline stroke SVGs, sized like the neighboring top-bar icons) ---

const iconProps = {
	width: 12,
	height: 12,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round",
	flexShrink: 0,
} as const;

function TargetIcon({ type }: { type: OpenMenuEntry["type"] }) {
	switch (type) {
		case "terminal":
			return (
				<svg {...iconProps} aria-hidden="true">
					<polyline points="4 17 10 11 4 5" />
					<line x1="12" y1="19" x2="20" y2="19" />
				</svg>
			);
		case "explorer":
			return (
				<svg {...iconProps} aria-hidden="true">
					<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
				</svg>
			);
		case "editor":
			return (
				<svg {...iconProps} aria-hidden="true">
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
			);
		case "terminal-ide":
			return (
				<svg {...iconProps} aria-hidden="true">
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<polyline points="7 9 10 12 7 15" />
					<line x1="12" y1="15" x2="17" y2="15" />
				</svg>
			);
		case "terminal-editor":
			return (
				<svg {...iconProps} aria-hidden="true">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
					<line x1="16" y1="13" x2="8" y2="13" />
					<line x1="16" y1="17" x2="8" y2="17" />
				</svg>
			);
	}
}

/** Menu label: i18n text for the platform types, the brand name for editors. */
function displayLabelForEntry(entry: OpenMenuEntry, t: (key: string, params?: TranslationParams) => string): string {
	switch (entry.type) {
		case "terminal":
			return t("open.terminal");
		case "explorer":
			return t("open.explorer");
		case "terminal-ide":
			return t("open.terminalIde");
		case "terminal-editor":
			return t("open.terminalEditor");
		case "editor":
			return entry.label;
	}
}

function CheckIcon() {
	return (
		<svg {...iconProps} aria-hidden="true">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

/**
 * The open-target dropdown body. Unavailable targets render grayed with a
 * not-found hint; the active default carries the "(default)" suffix + check.
 */
export function OpenTargetMenu({
	entries,
	defaultId,
	onSelect,
}: {
	entries: OpenMenuEntry[];
	defaultId: string | null;
	onSelect: (id: string) => void;
}) {
	const { t } = useI18n();
	if (entries.length === 0) {
		return <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "6px 10px" }}>{t("no-apps-found")}</div>;
	}
	return (
		<>
			{entries.map(entry => {
				const disabled = !entry.available;
				const isDefault = entry.id === defaultId;
				const label = displayLabelForEntry(entry, t);
				return (
					<button
						key={entry.id}
						disabled={disabled}
						onClick={() => onSelect(entry.id)}
						onMouseEnter={e => {
							if (disabled) return;
							e.currentTarget.style.background = "var(--bg-hover)";
						}}
						onMouseLeave={e => {
							e.currentTarget.style.background = "none";
						}}
						title={disabled ? t("open.unavailableFmt", { name: label }) : entry.detail ?? label}
						role="menuitem"
						style={{
							alignItems: "center",
							background: "none",
							border: "none",
							borderRadius: 6,
							color: disabled ? "var(--text-dim)" : "var(--text)",
							cursor: disabled ? "default" : "pointer",
							display: "flex",
							fontSize: 12,
							gap: 8,
							opacity: disabled ? 0.55 : 1,
							padding: "6px 10px",
							textAlign: "left",
							width: "100%",
						}}
					>
						<TargetIcon type={entry.type} />
						<span style={{ alignItems: "center", display: "flex", flex: 1, gap: 6, minWidth: 0 }}>
							{label}
							{entry.type === "terminal" && entry.label !== label && (
								<span style={{ color: "var(--text-dim)" }}>· {entry.label}</span>
							)}
						</span>
						{isDefault && (
							<span style={{ alignItems: "center", color: "var(--text-dim)", display: "flex", gap: 4 }}>
								{t("open.defaultSuffix")}
								<CheckIcon />
							</span>
						)}
					</button>
				);
			})}
		</>
	);
}

const splitButtonBaseStyle: React.CSSProperties = {
	alignItems: "center",
	background: "none",
	border: "none",
	borderTop: "2px solid transparent",
	borderBottom: "2px solid transparent",
	color: "var(--text-muted)",
	cursor: "pointer",
	display: "flex",
	fontSize: 11,
	gap: 6,
	height: "100%",
	padding: "0 10px",
	whiteSpace: "nowrap",
};

/** Top-bar Open split button: one-click default open + full target dropdown. */
export function OpenSplitButton({ activeCwd }: { activeCwd: string | null }) {
	const { t } = useI18n();
	const isMobile = useIsMobile();
	const [menuOpen, setMenuOpen] = useState(false);
	const [entries, setEntries] = useState<OpenMenuEntry[] | null>(null);
	const [gatewayDefaultId, setGatewayDefaultId] = useState<string | null>(null);
	const [desktopMode, setDesktopMode] = useState(false);
	const [storedId, setStoredId] = useState<string | null>(null);

	const loadOptions = useCallback(async (): Promise<OpenMenuEntry[]> => {
		try {
			const [response, hostTargets] = await Promise.all([
				fetch("/api/open/options"),
				hasDesktopOpenBridge() ? getDesktopOpenTargets() : Promise.resolve([]),
			]);
			if (!response.ok) {
				setEntries([]);
				return [];
			}
			const body = (await response.json()) as { desktop?: boolean; targets?: GatewayOpenTarget[] };
			const gatewayTargets = body.targets ?? [];
			const merged = buildOpenMenuEntries(gatewayTargets, body.desktop ? hostTargets : []);
			const gatewayDefault = gatewayTargets.find(option => option.default);
			setEntries(merged);
			setGatewayDefaultId(gatewayDefault ? clientTargetIdForOption(gatewayDefault) : null);
			setDesktopMode(Boolean(body.desktop));
			return merged;
		} catch {
			setEntries([]);
			return [];
		}
	}, []);

	const toggleMenu = useCallback(() => {
		if (menuOpen) {
			setMenuOpen(false);
			return;
		}
		setStoredId(readStoredDefaultTarget());
		if (entries === null) void loadOptions();
		setMenuOpen(true);
	}, [menuOpen, entries, loadOptions]);

	const defaultId = useMemo(
		() => (entries ? resolveDefaultTargetId(entries, storedId, gatewayDefaultId) : null),
		[entries, storedId, gatewayDefaultId],
	);

	const openTarget = useCallback(
		async (id: string, currentEntries: OpenMenuEntry[], desktop: boolean) => {
			const entry = currentEntries.find(candidate => candidate.id === id);
			if (!entry?.available) return;
			setMenuOpen(false);
			try {
				const body = JSON.stringify(buildOpenRequestBody(id, activeCwd));
				const hostId = desktop ? desktopTargetIdFor(id) : null;
				if (hostId && hasDesktopOpenBridge()) {
					const response = await fetch("/api/open", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body,
					});
					if (!response.ok) return;
					await openDesktopTarget(hostId, (await response.json()) as GatewayOpenPath);
				} else {
					await fetch("/api/open", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body,
					});
				}
				writeStoredDefaultTarget(id);
				setStoredId(id);
			} catch {
				// Non-fatal: the app simply does not open.
			}
		},
		[activeCwd],
	);

	const openDefault = useCallback(async () => {
		const current = entries ?? (await loadOptions());
		const id = resolveDefaultTargetId(current, storedId ?? readStoredDefaultTarget(), gatewayDefaultId);
		if (!id) {
			// Nothing available: surface the grayed-out menu instead of a silent no-op.
			setMenuOpen(true);
			return;
		}
		await openTarget(id, current, desktopMode);
	}, [entries, storedId, gatewayDefaultId, desktopMode, loadOptions, openTarget]);

	const noDefaultAvailable = entries !== null && defaultId === null;

	return (
		<div style={{ display: "flex", alignItems: "stretch", height: "100%", position: "relative", flexShrink: 0 }}>
			<button
				onClick={() => void openDefault()}
				disabled={noDefaultAvailable}
				title={t("open.openWithDefault")}
				style={{
					...splitButtonBaseStyle,
					borderRight: "1px solid var(--border)",
					cursor: noDefaultAvailable ? "default" : "pointer",
					opacity: noDefaultAvailable ? 0.45 : 1,
				}}
			>
				<svg {...iconProps} aria-hidden="true">
					<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
					<polyline points="15 3 21 3 21 9" />
					<line x1="10" y1="14" x2="21" y2="3" />
				</svg>
				{!isMobile && <span>{t("topbar.open")}</span>}
			</button>
			<button
				onClick={toggleMenu}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				title={t("open.pickTarget")}
				style={{
					...splitButtonBaseStyle,
					borderLeft: "1px solid var(--border)",
					borderRight: "1px solid var(--border)",
					background: menuOpen ? "var(--bg-selected)" : "none",
					borderTopColor: menuOpen ? "var(--accent)" : "transparent",
					color: menuOpen ? "var(--text)" : "var(--text-muted)",
					padding: "0 6px",
				}}
			>
				<svg {...iconProps} aria-hidden="true">
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>
			{menuOpen && (
				<>
					<div
						aria-hidden="true"
						onClick={() => setMenuOpen(false)}
						style={{ inset: 0, position: "fixed", zIndex: 8999 }}
					/>
					<div
						role="menu"
						aria-label={t("topbar.openInApp")}
						style={{
							background: "var(--bg-panel)",
							border: "1px solid var(--border)",
							borderRadius: 8,
							boxShadow: "0 10px 32px rgb(0 0 0 / 0.28)",
							display: "flex",
							flexDirection: "column",
							minWidth: 220,
							padding: 6,
							position: "absolute",
							right: 0,
							top: "calc(100% + 4px)",
							zIndex: 9000,
						}}
					>
						<OpenTargetMenu
							entries={entries ?? []}
							defaultId={defaultId}
							onSelect={id => void openTarget(id, entries ?? [], desktopMode)}
						/>
					</div>
				</>
			)}
		</div>
	);
}
