/**
 * Map the Host configured inventory onto the existing drawer / capabilities
 * card shapes. Does not invent loaded/session facts.
 */

import type { ExtensibilityReadModel, PluginRecord, SkillRecord } from "@linxiraos/studio-contract";

import type { DrawerItem, PluginPreview, SkillPreview } from "./skillsPreview";

/** Runtime source labels may still carry the upstream product name. */
function productLabel(value: string): string {
  return value.replace(/\bOMP\b/g, "Zeta").replace(/\bomp\b/g, "Zeta");
}

export function skillToPreview(skill: SkillRecord): SkillPreview {
  return {
    kind: "skill",
    name: skill.name,
    desc: skill.desc,
    src: productLabel(skill.sourceLabel),
    scope: skill.scope,
    path: "",
    enabled: skill.enabled,
    loaded: false,
    session: false,
    ...(skill.error === undefined ? {} : { error: skill.error }),
  };
}

export function pluginToPreview(plugin: PluginRecord): PluginPreview {
  return {
    kind: "plugin",
    name: plugin.name,
    title: plugin.title,
    scope: plugin.scope,
    src: productLabel(plugin.srcLabel),
    status: plugin.status === "error" ? "error" : "loaded",
    tools: plugin.tools,
    commands: plugin.commands,
    hooks: plugin.hooks,
    ui: plugin.ui,
    err: plugin.err ?? null,
    enabled: plugin.enabled,
    toolItems: [...plugin.toolItems],
    commandItems: [...plugin.commandItems],
    hookItems: [...plugin.hookItems],
    uiItems: [...plugin.uiItems],
    panels: plugin.panels.map((panel) => ({ ...panel })),
  };
}

export function toDrawerItems(model: ExtensibilityReadModel): DrawerItem[] {
  return [...model.skills.map(skillToPreview), ...model.plugins.map(pluginToPreview)];
}
