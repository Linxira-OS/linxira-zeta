/**
 * Web Gateway settings handlers.
 *
 * GET /api/settings — schema metadata + current values for the web-ui
 * settings panel. The payload mirrors the CLI `/settings` surface (driven by
 * `settings-schema.ts` + `modes/components/settings-defs.ts`) so the panel
 * shows exactly what the CLI shows: 10 tabs, TAB_GROUPS ordering, the same 6
 * control types, condition-gated visibility, and credential masking.
 *
 * PUT /api/settings — persist a single setting through the same channel the
 * CLI uses (`Settings.set()` + `flush()`), so the next CLI/desktop session
 * sees the change without a restart.
 *
 * Like the skills/plugins handlers, all mutations use an isolated Settings
 * instance so the gateway never touches the process-global settings singleton
 * owned by the CLI session.
 */

import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { Settings } from "../../config/settings";
import {
	getDefault,
	getEnumValues,
	getPathsForTab,
	getType,
	getUi,
	hasUi,
	isCredential,
	SETTING_TABS,
	SETTINGS_SCHEMA,
	type SettingPath,
	type SettingTab,
	type SubmenuOption,
	TAB_GROUPS,
	TAB_METADATA,
} from "../../config/settings-schema";
import { ZH_GROUP_LABELS, ZH_OPTION_TEXTS, ZH_SETTING_TEXTS, ZH_TAB_LABELS } from "../../config/settings-zh";
import { WebConfig } from "../../config/web-config";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/**
 * Every schema path, in declaration order — used for PUT path validation.
 * Computed lazily so the first PUT request pays for the scan once; the schema
 * module is fully evaluated by then regardless of import order.
 */
let knownPaths: SettingPath[] | null = null;

function isKnownSettingPath(value: unknown): value is SettingPath {
	if (typeof value !== "string") return false;
	const schema = SETTINGS_SCHEMA;
	knownPaths ??= Object.keys(schema) as SettingPath[];
	return knownPaths.includes(value as SettingPath);
}

// ═══════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════

export type SettingsControlType =
	| "boolean"
	| "enum"
	| "submenu"
	| "text"
	| "providerLimits"
	| "modelRoles"
	| "multiselect";

export interface SettingsTabDto {
	id: SettingTab;
	label: string;
}

export interface SettingsOptionDto {
	value: string;
	label: string;
	description?: string;
}

export interface SettingsEntryDto {
	path: SettingPath;
	type: SettingsControlType;
	label: string;
	description?: string;
	tab: SettingTab;
	group?: string;
	/** Current effective value; masked as "••••" for credentials. */
	value: unknown;
	default?: unknown;
	/** Only for credentials — the value is masked and must never be revealed. */
	secret?: boolean;
	/** Submenu/multiselect choices, localized. */
	options?: SettingsOptionDto[];
	/** Condition result; `false` hides the row in the panel. */
	visible: boolean;
	/** For `enum` controls: the raw value list. */
	values?: string[];
}

export interface SettingsResponseDto {
	tabs: SettingsTabDto[];
	/** Localized group headings per tab, in TAB_GROUPS order. */
	groups: Record<SettingTab, string[]>;
	settings: SettingsEntryDto[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Condition Predicates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Visibility predicates ported from `modes/components/settings-defs.ts`.
 * They read effective values off the isolated Settings instance, so the web
 * panel and the CLI agree on what is shown.
 *
 * `hasImageProtocol` is terminal-only and can never be true in the web
 * gateway, mirroring `!!TERMINAL.imageProtocol` in a process with no TUI.
 *
 * A `ui.condition` name missing from this map resolves to always-visible —
 * the same fallback the CLI defs layer applies for unknown names.
 */
type SettingsCondition = (settings: Settings) => boolean;

const CONDITIONS: Record<string, SettingsCondition> = {
	hasImageProtocol: () => false,
	advisorEnabled: settings => settings.get("advisor.enabled") === true,
	hindsightActive: settings => settings.get("memory.backend") === "hindsight",
	mnemopiActive: settings => settings.get("memory.backend") === "mnemopi",
	autolearnActive: settings => settings.get("autolearn.enabled") === true,
	autoThinkingActive: settings => settings.get("defaultThinkingLevel") === "auto",
	usageAwareFallbackEnabled: settings => settings.get("retry.usageAwareFallback") === true,
	planModeEnabled: settings => settings.get("plan.enabled"),
};

// ═══════════════════════════════════════════════════════════════════════════
// Schema to DTO Conversion
// ═══════════════════════════════════════════════════════════════════════════

function localizedOptions(path: SettingPath, options: ReadonlyArray<SubmenuOption>, zh: boolean): SettingsOptionDto[] {
	return options.map(option => {
		const texts = zh ? ZH_OPTION_TEXTS[`${path}::${option.value}`] : undefined;
		return {
			value: option.value,
			label: texts?.label ?? option.label,
			description: texts?.description ?? option.description,
		};
	});
}

interface EntryBase {
	path: SettingPath;
	label: string;
	description: string;
	tab: SettingTab;
	group?: string;
	visible: boolean;
}

/**
 * Map one schema entry to a panel DTO. Mirrors `pathToSettingDef` in
 * `modes/components/settings-defs.ts`: number/array settings without
 * `ui.options` have no control representation and are skipped, records map to
 * `providerLimits` only for `providers.maxInFlightRequests` (other records
 * render as plain text, exactly like the CLI's text editor row).
 */
function pathToEntry(path: SettingPath, settings: Settings, zh: boolean): SettingsEntryDto | null {
	const ui = getUi(path);
	if (!ui) return null;

	const texts = zh ? ZH_SETTING_TEXTS[path] : undefined;
	const base: EntryBase = {
		path,
		label: texts?.label ?? ui.label,
		description: texts?.description ?? ui.description,
		tab: ui.tab,
		group: zh && ui.group ? (ZH_GROUP_LABELS[ui.group] ?? ui.group) : ui.group,
		visible: ui.condition ? (CONDITIONS[ui.condition]?.(settings) ?? true) : true,
	};

	const schemaType = getType(path);

	if (schemaType === "boolean") {
		return { ...base, type: "boolean", value: settings.get(path), default: getDefault(path) };
	}

	const options = ui.options;

	if (schemaType === "enum") {
		if (options === undefined) {
			return {
				...base,
				type: "enum",
				values: [...(getEnumValues(path) ?? [])],
				value: settings.get(path),
				default: getDefault(path),
			};
		}
		// "runtime" is not a valid sentinel for enums — schema types prevent
		// this, but treat defensively as an empty submenu.
		return {
			...base,
			type: "submenu",
			options: options === "runtime" ? [] : localizedOptions(path, options, zh),
			value: settings.get(path),
			default: getDefault(path),
		};
	}

	if (schemaType === "number") {
		// Numbers without options are intentionally hidden from the UI.
		if (!options || options === "runtime") return null;
		return {
			...base,
			type: "submenu",
			options: localizedOptions(path, options, zh),
			value: settings.get(path),
			default: getDefault(path),
		};
	}

	if (schemaType === "string") {
		if (options === "runtime") {
			// Choice list is populated by the runtime layer (theme registry, …);
			// the panel renders an empty submenu like the CLI does.
			return { ...base, type: "submenu", options: [], value: settings.get(path), default: getDefault(path) };
		}
		if (options) {
			return {
				...base,
				type: "submenu",
				options: localizedOptions(path, options, zh),
				value: settings.get(path),
				default: getDefault(path),
			};
		}
		// One classification drives both surfaces: a credential masks here too,
		// so the panel cannot display a value only the CLI knows to redact.
		const secret = isCredential(path);
		return {
			...base,
			type: "text",
			secret,
			value: secret ? "••••" : settings.get(path),
			default: getDefault(path),
		};
	}

	if (schemaType === "array") {
		// Arrays without declared options stay config-file only.
		if (!options || options === "runtime") return null;
		return {
			...base,
			type: "multiselect",
			options: localizedOptions(path, options, zh),
			value: settings.get(path),
			default: getDefault(path),
		};
	}

	if (path === "providers.maxInFlightRequests") {
		return { ...base, type: "providerLimits", value: settings.get(path), default: getDefault(path) };
	}

	if (path === "modelRoles") {
		return { ...base, type: "modelRoles", value: settings.get(path), default: getDefault(path) };
	}

	return { ...base, type: "text", secret: false, value: settings.get(path), default: getDefault(path) };
}

/** Group rank for TAB_GROUPS ordering; ungrouped settings sort first. */
function groupRank(entry: SettingsEntryDto, order: readonly string[]): number {
	const rawGroup = getUi(entry.path)?.group;
	if (!rawGroup) return -1;
	const index = order.indexOf(rawGroup);
	return index >= 0 ? index : order.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/settings — full panel payload. `?lang=zh` (or an `Accept-Language`
 * header starting "zh") localizes tab/group/label/description/option text via
 * the zh overlay maps; any key missing from the overlay falls back to the
 * schema English text.
 */
export async function handleSettingsGet(req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const lang = url.searchParams.get("lang");
		const acceptLanguage = req.headers.get("accept-language") ?? "";
		const zh = lang === "zh" || (lang === null && acceptLanguage.toLowerCase().startsWith("zh"));

		const cwd = req.headers.get("x-zeta-cwd") ?? process.cwd();
		const agentDir = getAgentDir();
		const settings = await Settings.loadIsolated({ cwd, agentDir });

		const tabs: SettingsTabDto[] = SETTING_TABS.map(tab => ({
			id: tab,
			label: zh ? (ZH_TAB_LABELS[tab] ?? TAB_METADATA[tab].label) : TAB_METADATA[tab].label,
		}));

		const groups = Object.fromEntries(
			SETTING_TABS.map(tab => [tab, TAB_GROUPS[tab].map(group => (zh ? (ZH_GROUP_LABELS[group] ?? group) : group))]),
		) as Record<SettingTab, string[]>;

		const settingsList: SettingsEntryDto[] = [];
		for (const tab of SETTING_TABS) {
			const order = TAB_GROUPS[tab];
			const entries = getPathsForTab(tab)
				.map(path => pathToEntry(path, settings, zh))
				.filter((entry): entry is SettingsEntryDto => entry !== null)
				.sort((a, b) => groupRank(a, order) - groupRank(b, order));
			settingsList.push(...entries);
		}

		return json({ tabs, groups, settings: settingsList });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

/**
 * PUT /api/settings — body `{ path, value }`. Persists the setting through the
 * same `Settings.set()` + `flush()` channel the CLI uses. Unknown paths or
 * paths without a `ui:` block are rejected with 400; persistence failures are
 * 500 with the error message.
 */
export async function handleSettingsPut(req: Request): Promise<Response> {
	try {
		const body = (await req.json()) as { path?: unknown; value?: unknown };
		const path = body.path;
		if (!isKnownSettingPath(path)) {
			return json({ error: `Unknown setting path: ${String(path)}` }, 400);
		}
		const settingPath = path;
		if (!hasUi(settingPath)) {
			return json({ error: `Setting has no UI metadata: ${settingPath}` }, 400);
		}

		const cwd = req.headers.get("x-zeta-cwd") ?? process.cwd();
		const agentDir = getAgentDir();
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		settings.set(settingPath, body.value as never);
		await settings.flush();
		return json({ ok: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}

/**
 * POST /api/settings/reload — force a fresh disk read of both the CLI
 * settings layer and web.yml. The gateway handlers already load isolated
 * instances per request, so this exists for the Settings panel's "reload"
 * button: it re-reads the files and the client re-fetches /api/settings and
 * /api/web-config afterwards.
 */
export async function handleSettingsReload(req: Request): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	try {
		const cwd = req.headers.get("x-zeta-cwd") ?? process.cwd();
		const agentDir = getAgentDir();
		await Settings.loadIsolated({ cwd, agentDir });
		const webConfig = await WebConfig.load();
		await webConfig.reload();
		return json({ ok: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
}
