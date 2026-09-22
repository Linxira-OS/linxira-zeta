"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useThemeSystem } from "@/contexts/useThemeSystem";
import type { ThemeMode } from "@/contexts/theme-system-context";
import { SERIF_UI_FONT_STACK, type DensityPreference, type RadiusPreference } from "@/lib/theme/appearance";
import { inputStyle, SettingsHighlight, SettingsTabBody, useSettingsData, useWebConfigState } from "../SettingsPanel";

/**
 * Windowed settings shell: large fixed-inset window with a title bar, an
 * in-page search box, and a left group nav. The data layer and per-tab
 * rendering are reused from SettingsPanel (`useSettingsData`,
 * `useWebConfigState`, `SettingsTabBody`) — only the chrome differs.
 *
 * The "appearance" nav entry is a web-local group backed by
 * ThemeSystemContext (localStorage, no gateway round-trip); it replaces the
 * gateway's CLI-only appearance tab in the navigation.
 */
export interface SettingsWindowProps {
	open: boolean;
	onClose: () => void;
	onOpenModelsConfig: () => void;
}

interface NavEntry {
	id: string;
	label: string;
	/** Searchable label/description pairs behind this entry. */
	items: Array<{ label: string; description?: string }>;
}

interface MatchedNavEntry {
	entry: NavEntry;
	titleMatch: boolean;
	matchedItems: number;
}

/** Searchable strings of the web-local appearance group. */
const APPEARANCE_SEARCH_KEYS: Array<[labelKey: string, descriptionKey?: string]> = [
	["settings.appearance.mode", "settings.appearance.mode-desc"],
	["settings.appearance.light-theme", "settings.appearance.light-theme-desc"],
	["settings.appearance.dark-theme", "settings.appearance.dark-theme-desc"],
	["settings.appearance.density", "settings.appearance.density-desc"],
	["settings.appearance.radius", "settings.appearance.radius-desc"],
	["settings.appearance.ui-font", "settings.appearance.font-desc"],
	["settings.appearance.mono-font", "settings.appearance.font-desc"],
	["code-syntax-theme", "settings.appearance.code-theme-desc"],
];

/** Searchable label keys of the web/bot config tab. */
const WEB_SEARCH_KEYS = [
	"web-display",
	"web-sidebar",
	"web-tray",
	"web-minimize-to-tray",
	"web-minimize-to-tray-desc",
	"web-autostart",
	"web-autostart-desc",
	"web-remote",
	"web-remote-host",
	"web-remote-token",
	"web-remote-token-desc",
	"web-show-bot-sessions",
	"web-show-bot-sessions-desc",
	"web-channels",
	"web-channel-wechat",
	"web-channel-feishu",
	"web-channel-telegram",
];

const selectStyle = { ...inputStyle, width: "auto", minWidth: 180 };

export function SettingsWindow({ open, onClose, onOpenModelsConfig }: SettingsWindowProps) {
	const isMobile = useIsMobile();
	const { t } = useI18n();
	const settings = useSettingsData(open);
	const web = useWebConfigState(open);
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();

	// Escape closes the window, unless the user is typing in a field.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"))
				return;
			onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const navEntries: NavEntry[] = [
		{
			id: "appearance",
			label: t("settings.appearance"),
			items: APPEARANCE_SEARCH_KEYS.map(([labelKey, descriptionKey]) => ({
				label: t(labelKey),
				description: descriptionKey ? t(descriptionKey) : undefined,
			})),
		},
		...(settings.data?.tabs ?? [])
			.filter(tab => tab.id !== "appearance")
			.map(tab => ({
				id: tab.id,
				label: tab.label,
				items: settings.entriesFor(tab.id).map(e => ({ label: e.label, description: e.description })),
			})),
		{ id: "web", label: t("web-bot"), items: WEB_SEARCH_KEYS.map(key => ({ label: t(key) })) },
		{ id: "docs", label: t("web-docs"), items: [] },
	];

	const matchedNav: MatchedNavEntry[] = navEntries
		.map(entry => {
			const titleMatch = q !== "" && entry.label.toLowerCase().includes(q);
			const matchedItems =
				q === ""
					? entry.items.length
					: entry.items.filter(
							i => i.label.toLowerCase().includes(q) || (i.description?.toLowerCase().includes(q) ?? false),
						).length;
			return { entry, titleMatch, matchedItems };
		})
		.filter(({ titleMatch, matchedItems }) => q === "" || titleMatch || matchedItems > 0);

	// A query that filters the active group out of the nav jumps to the first
	// remaining group, so the content area always shows a match.
	useEffect(() => {
		if (q === "" || matchedNav.length === 0) return;
		if (!matchedNav.some(({ entry }) => entry.id === settings.activeTab)) {
			settings.setActiveTab(matchedNav[0].entry.id);
		}
	});

	if (!open) return null;

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 950,
				background: "rgba(0,0,0,0.35)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 16,
			}}
			onClick={e => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-label={t("settings")}
				style={{
					width: isMobile ? "100%" : "min(1080px, 100%)",
					height: isMobile ? "100%" : "min(860px, 100%)",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: "var(--radius-unit, 12px)",
					display: "flex",
					flexDirection: "column",
					boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
					overflow: "hidden",
				}}
			>
				{/* Title bar: title, config file, in-page search, close */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						padding: "12px 18px",
						borderBottom: "1px solid var(--border)",
						flexShrink: 0,
					}}
				>
					<div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
						<span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("settings")}</span>
						<code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
							~/.zeta/agent/config.yml
						</code>
					</div>
					<input
						type="text"
						value={query}
						onChange={e => setQuery(e.target.value)}
						placeholder={t("settings.search-placeholder")}
						aria-label={t("settings.search-placeholder")}
						style={{ ...inputStyle, flex: 1, maxWidth: 340, marginLeft: "auto" }}
					/>
					<button
						onClick={onClose}
						aria-label="Close settings"
						style={{
							background: "none",
							border: "none",
							color: "var(--text-muted)",
							cursor: "pointer",
							fontSize: 20,
							lineHeight: 1,
							padding: "2px 6px",
							flexShrink: 0,
						}}
					>
						×
					</button>
				</div>

				{/* Group nav + content */}
				<div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: isMobile ? "column" : "row" }}>
					<nav
						aria-label={t("settings.nav-label")}
						style={
							isMobile
								? {
										display: "flex",
										gap: 4,
										padding: "8px 10px",
										borderBottom: "1px solid var(--border)",
										background: "var(--bg-panel)",
										overflowX: "auto",
										flexShrink: 0,
									}
								: {
										display: "flex",
										flexDirection: "column",
										gap: 2,
										width: 208,
										flexShrink: 0,
										padding: "10px 8px",
										borderRight: "1px solid var(--border)",
										background: "var(--bg-panel)",
										overflowY: "auto",
									}
						}
					>
						{matchedNav.map(({ entry, titleMatch, matchedItems }) => {
							const active = settings.activeTab === entry.id;
							return (
								<button
									key={entry.id}
									type="button"
									onClick={() => settings.setActiveTab(entry.id)}
									aria-pressed={active}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "calc(6px * var(--padding-scale, 1)) 10px",
										border: "none",
										borderRadius: "var(--radius-unit, 8px)",
										cursor: "pointer",
										fontSize: 12,
										whiteSpace: "nowrap",
										textAlign: "left",
										flexShrink: 0,
										background: active ? "var(--bg-selected)" : "transparent",
										color: active ? "var(--text)" : "var(--text-muted)",
									}}
								>
									<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
										<SettingsHighlight text={entry.label} query={query} />
									</span>
									{q !== "" && (titleMatch ? entry.items.length : matchedItems) > 0 && (
										<span
											style={{
												marginLeft: "auto",
												fontSize: 10,
												color: titleMatch ? "var(--text-dim)" : "var(--accent)",
												background: titleMatch ? "transparent" : "var(--accent-muted)",
												borderRadius: 8,
												padding: "1px 6px",
												flexShrink: 0,
											}}
										>
											{titleMatch ? entry.items.length : matchedItems}
										</span>
									)}
								</button>
							);
						})}
					</nav>
					<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
						{matchedNav.length === 0 ? (
							<div
								style={{
									flex: 1,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: 24,
									fontSize: 12.5,
									color: "var(--text-muted)",
								}}
							>
								{t("settings.search-no-results", { query })}
							</div>
						) : settings.activeTab === "appearance" ? (
							<AppearanceSection query={q} />
						) : (
							<SettingsTabBody
								activeTab={settings.activeTab}
								data={settings.data}
								loadError={settings.loadError}
								reload={settings.reload}
								web={web}
								renderRow={settings.renderRow}
								onOpenModelsConfig={onOpenModelsConfig}
								query={q}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

type FontMode = "system" | "serif" | "custom";
type MonoFontMode = "system" | "custom";

/**
 * Web-local appearance group: theme mode, light/dark presets, density,
 * corner radius, fonts, and code-block coloring — all read/written through
 * ThemeSystemContext (localStorage) and applied immediately as root CSS
 * custom properties by ThemeSystemProvider.
 */
function AppearanceSection({ query }: { query: string }) {
	const { t } = useI18n();
	const {
		availableThemes,
		currentTheme,
		darkThemeId,
		lightThemeId,
		monoFont,
		radius,
		themeMode,
		uiFont,
		density,
		setDarkThemePreference,
		setDensity,
		setLightThemePreference,
		setMonoFont,
		setRadius,
		setTheme,
		setThemeMode,
		setUiFont,
	} = useThemeSystem();
	const [uiFontDraft, setUiFontDraft] = useState<string | undefined>(undefined);
	const [monoFontDraft, setMonoFontDraft] = useState<string | undefined>(undefined);
	// Explicit mode override while the user is choosing; cleared when a value
	// commits so the mode re-derives from the stored value.
	const [uiFontMode, setUiFontMode] = useState<FontMode | null>(null);
	const [monoFontMode, setMonoFontMode] = useState<MonoFontMode | null>(null);

	const lightThemes = availableThemes.filter(theme => theme.metadata.variant === "light");
	const darkThemes = availableThemes.filter(theme => theme.metadata.variant === "dark");
	// zeta-* presets come first in the registry order — keep that ordering.
	const activeVariantThemes = currentTheme.metadata.variant === "dark" ? darkThemes : lightThemes;

	const effectiveUiFontMode: FontMode =
		uiFontMode ?? (uiFont === "" ? "system" : uiFont === SERIF_UI_FONT_STACK ? "serif" : "custom");
	const effectiveMonoFontMode: MonoFontMode = monoFontMode ?? (monoFont === "" ? "system" : "custom");

	// Once a value commits (or syncs from another tab), re-derive the mode.
	useEffect(() => setUiFontMode(null), [uiFont]);
	useEffect(() => setMonoFontMode(null), [monoFont]);

	const row = (key: string, label: string, description: string, control: ReactNode) => ({
		key,
		label,
		description,
		control,
	});
	const rows = [
		row(
			"mode",
			t("settings.appearance.mode"),
			t("settings.appearance.mode-desc"),
			<select
				value={themeMode}
				onChange={e => setThemeMode(e.target.value as ThemeMode)}
				style={selectStyle}
				aria-label={t("settings.appearance.mode")}
			>
				<option value="system">{t("settings.appearance.mode-system")}</option>
				<option value="light">{t("settings.appearance.mode-light")}</option>
				<option value="dark">{t("settings.appearance.mode-dark")}</option>
			</select>,
		),
		row(
			"light-theme",
			t("settings.appearance.light-theme"),
			t("settings.appearance.light-theme-desc"),
			<select
				value={lightThemeId}
				onChange={e => setLightThemePreference(e.target.value)}
				style={selectStyle}
				aria-label={t("settings.appearance.light-theme")}
			>
				{lightThemes.map(theme => (
					<option key={theme.metadata.id} value={theme.metadata.id}>
						{theme.metadata.name}
					</option>
				))}
			</select>,
		),
		row(
			"dark-theme",
			t("settings.appearance.dark-theme"),
			t("settings.appearance.dark-theme-desc"),
			<select
				value={darkThemeId}
				onChange={e => setDarkThemePreference(e.target.value)}
				style={selectStyle}
				aria-label={t("settings.appearance.dark-theme")}
			>
				{darkThemes.map(theme => (
					<option key={theme.metadata.id} value={theme.metadata.id}>
						{theme.metadata.name}
					</option>
				))}
			</select>,
		),
		row(
			"density",
			t("settings.appearance.density"),
			t("settings.appearance.density-desc"),
			<select
				value={density}
				onChange={e => setDensity(e.target.value as DensityPreference)}
				style={selectStyle}
				aria-label={t("settings.appearance.density")}
			>
				<option value="compact">{t("settings.appearance.density-compact")}</option>
				<option value="standard">{t("settings.appearance.density-standard")}</option>
				<option value="relaxed">{t("settings.appearance.density-relaxed")}</option>
			</select>,
		),
		row(
			"radius",
			t("settings.appearance.radius"),
			t("settings.appearance.radius-desc"),
			<select
				value={radius}
				onChange={e => setRadius(e.target.value as RadiusPreference)}
				style={selectStyle}
				aria-label={t("settings.appearance.radius")}
			>
				<option value="none">{t("settings.appearance.radius-none")}</option>
				<option value="small">{t("settings.appearance.radius-small")}</option>
				<option value="medium">{t("settings.appearance.radius-medium")}</option>
				<option value="large">{t("settings.appearance.radius-large")}</option>
			</select>,
		),
		row(
			"ui-font",
			t("settings.appearance.ui-font"),
			t("settings.appearance.font-desc"),
			<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
				<select
					value={effectiveUiFontMode}
					onChange={e => {
						const mode = e.target.value as FontMode;
						setUiFontMode(mode);
						if (mode === "system") setUiFont("");
						else if (mode === "serif") setUiFont(SERIF_UI_FONT_STACK);
					}}
					style={selectStyle}
					aria-label={t("settings.appearance.ui-font")}
				>
					<option value="system">{t("settings.appearance.font-system")}</option>
					<option value="serif">{t("settings.appearance.font-serif")}</option>
					<option value="custom">{t("custom")}</option>
				</select>
				{effectiveUiFontMode === "custom" && (
					<input
						type="text"
						value={uiFontDraft ?? uiFont}
						placeholder={t("settings.appearance.font-custom-placeholder")}
						aria-label={t("settings.appearance.ui-font")}
						onChange={e => setUiFontDraft(e.target.value)}
						onBlur={e => {
							setUiFontDraft(undefined);
							if (e.target.value.trim() !== uiFont) setUiFont(e.target.value);
						}}
						onKeyDown={e => {
							if (e.key === "Enter") e.currentTarget.blur();
						}}
						style={{ ...inputStyle, width: 300, fontFamily: "var(--font-mono)" }}
					/>
				)}
			</div>,
		),
		row(
			"mono-font",
			t("settings.appearance.mono-font"),
			t("settings.appearance.font-desc"),
			<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
				<select
					value={effectiveMonoFontMode}
					onChange={e => {
						const mode = e.target.value as MonoFontMode;
						setMonoFontMode(mode);
						if (mode === "system") setMonoFont("");
					}}
					style={selectStyle}
					aria-label={t("settings.appearance.mono-font")}
				>
					<option value="system">{t("settings.appearance.font-system")}</option>
					<option value="custom">{t("custom")}</option>
				</select>
				{effectiveMonoFontMode === "custom" && (
					<input
						type="text"
						value={monoFontDraft ?? monoFont}
						placeholder={t("settings.appearance.font-custom-placeholder")}
						aria-label={t("settings.appearance.mono-font")}
						onChange={e => setMonoFontDraft(e.target.value)}
						onBlur={e => {
							setMonoFontDraft(undefined);
							if (e.target.value.trim() !== monoFont) setMonoFont(e.target.value);
						}}
						onKeyDown={e => {
							if (e.key === "Enter") e.currentTarget.blur();
						}}
						style={{ ...inputStyle, width: 300, fontFamily: "var(--font-mono)" }}
					/>
				)}
			</div>,
		),
		row(
			"code-theme",
			t("code-syntax-theme"),
			t("settings.appearance.code-theme-desc"),
			<select
				value={currentTheme.metadata.id}
				onChange={e => setTheme(e.target.value)}
				style={selectStyle}
				aria-label={t("code-syntax-theme")}
			>
				{activeVariantThemes.map(theme => (
					<option key={theme.metadata.id} value={theme.metadata.id}>
						{theme.metadata.name}
					</option>
				))}
			</select>,
		),
	];

	const visible =
		query === ""
			? rows
			: rows.filter(r => r.label.toLowerCase().includes(query) || r.description.toLowerCase().includes(query));

	return (
		<div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
			{visible.map(({ key, label, description, control }) => (
				<div
					key={key}
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 6,
						padding: "calc(10px * var(--padding-scale, 1)) 16px",
						borderBottom: "1px solid var(--border)",
					}}
				>
					<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
						<span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
							<SettingsHighlight text={label} query={query} />
						</span>
						{control}
					</div>
					<div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
						<SettingsHighlight text={description} query={query} />
					</div>
				</div>
			))}
			{visible.length === 0 && (
				<div style={{ padding: 24, fontSize: 12.5, color: "var(--text-muted)" }}>
					{t("settings.search-no-results", { query })}
				</div>
			)}
		</div>
	);
}
