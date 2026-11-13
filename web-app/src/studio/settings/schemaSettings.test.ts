import { describe, expect, test } from "bun:test";

import {
  formatSchemaSettingValue,
  groupedSchemaSettings,
  parseSchemaSettingValue,
  readSchemaSettingsCatalog,
  toggleSchemaMultiselect,
  visibleSchemaSettings,
  type SchemaSettingEntry,
} from "./schemaSettings";

const entry = (patch: Partial<SchemaSettingEntry> & Pick<SchemaSettingEntry, "path" | "type" | "label" | "tab">): SchemaSettingEntry => ({
  value: undefined,
  visible: true,
  ...patch,
});

const catalog = readSchemaSettingsCatalog({
  tabs: [{ id: "general", label: "General" }, { id: "model", label: "Model" }],
  groups: { general: ["Startup", "Editor"], model: ["Roles"] },
  settings: [
    entry({ path: "startup.quiet", type: "boolean", label: "Quiet startup", tab: "general", group: "Startup", value: true }),
    entry({ path: "theme.dark", type: "enum", label: "Dark theme", tab: "general", group: "Editor", value: "auto", values: ["auto", "off"] }),
    entry({ path: "editor.font", type: "text", label: "Editor font", tab: "general", group: "Editor", value: "Maple Mono" }),
    entry({ path: "retry.hidden", type: "text", label: "Hidden row", tab: "general", value: "x", visible: false }),
    entry({ path: "modelRoles", type: "modelRoles", label: "Model roles", tab: "model", group: "Roles", value: { default: "a/b" } }),
  ],
});

describe("gateway settings catalog", () => {
  test("reads tabs, groups and typed rows without inventing fields", () => {
    expect(catalog.tabs.map(tab => tab.id)).toEqual(["general", "model"]);
    expect(catalog.groups.model).toEqual(["Roles"]);
    expect(catalog.settings.find(item => item.path === "theme.dark")?.values).toEqual(["auto", "off"]);
  });

  test("rejects a malformed envelope instead of showing an empty panel", () => {
    expect(() => readSchemaSettingsCatalog({ tabs: [], groups: {}, settings: {} })).toThrow("malformed settings");
    expect(() => readSchemaSettingsCatalog({ tabs: [], groups: {}, settings: [{ path: "a", type: "nope", label: "A", tab: "x", visible: true }] })).toThrow("unknown control type");
  });

  test("filters by visible, tab and label/description/path", () => {
    expect(visibleSchemaSettings(catalog, "general").map(item => item.path)).toEqual([
      "startup.quiet",
      "theme.dark",
      "editor.font",
    ]);
    expect(visibleSchemaSettings(catalog, "general", "quiet").map(item => item.path)).toEqual(["startup.quiet"]);
    expect(visibleSchemaSettings(catalog, "general", "startup.").map(item => item.path)).toEqual(["startup.quiet"]);
    expect(visibleSchemaSettings(catalog, "model", "roles").map(item => item.path)).toEqual(["modelRoles"]);
  });

  test("groups ungrouped rows first and appends undeclared headings", () => {
    const groups = groupedSchemaSettings(catalog.settings, ["Startup"]);
    expect(groups[0]?.entries.map(item => item.path)).toContain("retry.hidden");
    expect(groups.map(group => group.title)).toEqual([undefined, "Startup", "Editor", "Roles"]);
  });

  test("formats object rows as JSON and rejects non-object values", () => {
    const roles = catalog.settings.find(item => item.path === "modelRoles")!;
    expect(JSON.parse(formatSchemaSettingValue(roles))).toEqual({ default: "a/b" });
    expect(parseSchemaSettingValue(roles, `{"default":"x/y"}`)).toEqual({ default: "x/y" });
    expect(() => parseSchemaSettingValue(roles, `["x"]`)).toThrow("must be a JSON object");
    expect(() => parseSchemaSettingValue(roles, "{")).toThrow();
  });

  test("keeps the current shape for text rows holding arrays", () => {
    const list = entry({ path: "enabledModels", type: "text", label: "Enabled models", tab: "general", value: ["a/b"] });
    expect(parseSchemaSettingValue(list, `["c/d"]`)).toEqual(["c/d"]);
    expect(() => parseSchemaSettingValue(list, `"c/d"`)).toThrow("must be a JSON array");
  });

  test("multiselect toggles in declared option order", () => {
    const multi = entry({
      path: "surfaces",
      type: "multiselect",
      label: "Surfaces",
      tab: "general",
      value: ["b"],
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
      ],
    });
    expect(toggleSchemaMultiselect(multi, ["b"], "a", true)).toEqual(["a", "b"]);
    expect(toggleSchemaMultiselect(multi, ["a", "b"], "b", false)).toEqual(["a"]);
    expect(toggleSchemaMultiselect(multi, ["a"], "a", true)).toEqual(["a"]);
  });
});
