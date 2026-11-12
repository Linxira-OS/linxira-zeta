/**
 * The complete gateway settings catalog (`GET /api/settings`) as data.
 *
 * This is the old windowed settings surface's schema: gateway-provided tabs,
 * group headings and rows rather than a hand-coded subset. The renderer only
 * draws what the response contains; malformed envelopes fail loudly instead of
 * being replaced by an empty catalog.
 */

import { isRecord } from "../typeGuards";

export type SchemaSettingType =
  | "boolean"
  | "enum"
  | "submenu"
  | "text"
  | "providerLimits"
  | "modelRoles"
  | "multiselect";

export interface SchemaSettingOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface SchemaSettingEntry {
  readonly path: string;
  readonly type: SchemaSettingType;
  readonly label: string;
  readonly description?: string;
  readonly tab: string;
  readonly group?: string;
  readonly value: unknown;
  readonly default?: unknown;
  readonly secret?: boolean;
  readonly options?: ReadonlyArray<SchemaSettingOption>;
  readonly visible: boolean;
  readonly values?: ReadonlyArray<string>;
}

export interface SchemaSettingTab {
  readonly id: string;
  readonly label: string;
}

export interface SchemaSettingsCatalog {
  readonly tabs: ReadonlyArray<SchemaSettingTab>;
  readonly groups: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly settings: ReadonlyArray<SchemaSettingEntry>;
}

export interface SchemaSettingsGroup {
  readonly title?: string;
  readonly entries: ReadonlyArray<SchemaSettingEntry>;
}

const SETTING_TYPES: Readonly<Record<SchemaSettingType, true>> = {
  boolean: true,
  enum: true,
  submenu: true,
  text: true,
  providerLimits: true,
  modelRoles: true,
  multiselect: true,
};


function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) return undefined;
  return value as string[];
}

function optionList(value: unknown): SchemaSettingOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: SchemaSettingOption[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.value !== "string" || typeof item.label !== "string") return undefined;
    options.push({
      value: item.value,
      label: item.label,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
    });
  }
  return options;
}

function settingType(value: unknown): SchemaSettingType | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SETTING_TYPES, value)
    ? (value as SchemaSettingType)
    : undefined;
}

/** Validate the gateway envelope; every row must be usable before it is drawn. */
export function readSchemaSettingsCatalog(body: unknown): SchemaSettingsCatalog {
  if (!isRecord(body)) throw new Error("GET /api/settings returned a non-object document");
  if (!Array.isArray(body.tabs)) throw new Error("GET /api/settings returned malformed tabs");
  if (!isRecord(body.groups)) throw new Error("GET /api/settings returned malformed groups");
  if (!Array.isArray(body.settings)) throw new Error("GET /api/settings returned malformed settings");

  const tabs: SchemaSettingTab[] = [];
  for (const item of body.tabs) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string") {
      throw new Error("GET /api/settings returned a tab without id/label");
    }
    tabs.push({ id: item.id, label: item.label });
  }

  const groups: Record<string, ReadonlyArray<string>> = {};
  for (const [tab, value] of Object.entries(body.groups)) {
    const headings = stringArray(value);
    if (headings === undefined) throw new Error(`GET /api/settings returned malformed groups for "${tab}"`);
    groups[tab] = headings;
  }

  const settings: SchemaSettingEntry[] = [];
  for (const item of body.settings) {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.label !== "string" || typeof item.tab !== "string") {
      throw new Error("GET /api/settings returned a setting without path/label/tab");
    }
    const type = settingType(item.type);
    if (type === undefined) throw new Error(`GET /api/settings returned an unknown control type for ${item.path}`);
    if (typeof item.visible !== "boolean") throw new Error(`GET /api/settings returned no visible flag for ${item.path}`);
    const options = optionList(item.options);
    if (item.options !== undefined && options === undefined) {
      throw new Error(`GET /api/settings returned malformed options for ${item.path}`);
    }
    const values = stringArray(item.values);
    if (item.values !== undefined && values === undefined) {
      throw new Error(`GET /api/settings returned malformed values for ${item.path}`);
    }
    settings.push({
      path: item.path,
      type,
      label: item.label,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      tab: item.tab,
      ...(typeof item.group === "string" ? { group: item.group } : {}),
      value: item.value,
      ...(!Object.prototype.hasOwnProperty.call(item, "default") ? {} : { default: item.default }),
      ...(item.secret === true ? { secret: true } : {}),
      ...(options === undefined ? {} : { options }),
      visible: item.visible,
      ...(values === undefined ? {} : { values }),
    });
  }
  return { tabs, groups, settings };
}

/** Rows for one tab, filtered by the old panel's substring search. */
export function visibleSchemaSettings(
  catalog: SchemaSettingsCatalog,
  tab: string,
  query = "",
): ReadonlyArray<SchemaSettingEntry> {
  const needle = query.trim().toLocaleLowerCase();
  return catalog.settings.filter((entry) => {
    if (entry.tab !== tab || !entry.visible) return false;
    if (needle === "") return true;
    return entry.label.toLocaleLowerCase().includes(needle)
      || (entry.description?.toLocaleLowerCase().includes(needle) ?? false)
      || entry.path.toLocaleLowerCase().includes(needle)
      || (entry.group?.toLocaleLowerCase().includes(needle) ?? false);
  });
}

/** Ungrouped rows first, then declared group order, then first-seen groups. */
export function groupedSchemaSettings(
  entries: ReadonlyArray<SchemaSettingEntry>,
  headings: ReadonlyArray<string>,
): ReadonlyArray<SchemaSettingsGroup> {
  const ungrouped = entries.filter(entry => entry.group === undefined);
  const seen = new Set<string>();
  const known: SchemaSettingsGroup[] = [];
  for (const heading of headings) {
    if (seen.has(heading)) continue;
    seen.add(heading);
    const items = entries.filter(entry => entry.group === heading);
    if (items.length > 0) known.push({ title: heading, entries: items });
  }
  for (const entry of entries) {
    if (entry.group === undefined || seen.has(entry.group)) continue;
    seen.add(entry.group);
    known.push({ title: entry.group, entries: entries.filter(item => item.group === entry.group) });
  }
  return [{ entries: ungrouped }, ...known];
}

/** What the editor shows: JSON for objects/arrays and rows with JSON editors. */
export function formatSchemaSettingValue(entry: SchemaSettingEntry): string {
  if (entry.type === "providerLimits" || entry.type === "modelRoles") {
    return JSON.stringify(entry.value ?? {}, null, 2);
  }
  if (typeof entry.value === "object" && entry.value !== null) {
    return JSON.stringify(entry.value, null, 2);
  }
  if (entry.value === undefined || entry.value === null) return "";
  return String(entry.value);
}

/**
 * Parse one edited value for `PUT /api/settings`.
 *
 * Object editors keep their shape: a value that is not a JSON object is
 * rejected instead of being coerced to text. Text rows that currently hold an
 * object/array also parse as JSON so a fallback chain stays a list.
 */
export function parseSchemaSettingValue(entry: SchemaSettingEntry, text: string): unknown {
  if (entry.type === "providerLimits" || entry.type === "modelRoles") {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Invalid JSON");
    }
    if (!isRecord(value)) throw new Error("Value must be a JSON object");
    return value;
  }
  if (typeof entry.value === "object" && entry.value !== null) {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Invalid JSON");
    }
    if (Array.isArray(entry.value) && !Array.isArray(value)) throw new Error("Value must be a JSON array");
    if (isRecord(entry.value) && !isRecord(value)) throw new Error("Value must be a JSON object");
    return value;
  }
  return text;
}

/** Toggle one checkbox in a multiselect row, preserving option order. */
export function toggleSchemaMultiselect(
  entry: SchemaSettingEntry,
  current: ReadonlyArray<string>,
  option: string,
  checked: boolean,
): string[] {
  const present = current.includes(option);
  if (checked === present) return [...current];
  const declared = entry.options?.map(item => item.value) ?? [...current, option];
  const selected = checked ? [...current, option] : current.filter(item => item !== option);
  return declared.filter(item => selected.includes(item));
}
