import type { OpenChamberTheme, Theme, ThemeVariant } from "./types";
import { presetThemeResources, zetaThemeResources } from "./themes/index";

export const DEFAULT_LIGHT_THEME_ID = "zeta-light";
export const DEFAULT_DARK_THEME_ID = "zeta-dark";
export const THEME_MODE_STORAGE_KEY = "zeta-theme-mode";
export const LIGHT_THEME_STORAGE_KEY = "zeta-light-theme";
export const DARK_THEME_STORAGE_KEY = "zeta-dark-theme";

const ALIASES: Record<string, string> = {
  light: DEFAULT_LIGHT_THEME_ID,
  dark: DEFAULT_DARK_THEME_ID,
  starfield: "zeta-starfield",
  "vitesse-light-light": "vitesse-light",
  "vitesse-dark-dark": "vitesse-dark",
};

function presetToTheme(resource: OpenChamberTheme): Theme {
  const { colors } = resource;
  const { base, tokens, highlights } = colors.syntax;
  const chart = [
    colors.primary.base,
    colors.status.error,
    colors.status.warning,
    colors.status.success,
    colors.status.info,
    base.function,
    base.type,
    base.string,
  ];

  return {
    metadata: {
      id: resource.metadata.id,
      name: resource.metadata.name,
      description: resource.metadata.description,
      variant: resource.metadata.variant,
      tags: resource.metadata.tags,
    },
    colors: {
      primary: {
        base: colors.primary.base,
        hover: colors.primary.hover,
        active: colors.primary.active,
        foreground: colors.primary.foreground,
        muted: colors.primary.muted,
      },
      surface: colors.surface,
      interactive: colors.interactive,
      status: colors.status,
      syntax: {
        background: base.background,
        foreground: base.foreground,
        comment: base.comment,
        keyword: base.keyword,
        string: base.string,
        number: base.number,
        function: base.function,
        variable: base.variable,
        type: base.type,
        operator: base.operator,
        property: tokens.variableProperty ?? base.variable,
        header: colors.surface.elevated,
        lineNumber: highlights.lineNumber ?? colors.surface.mutedForeground,
      },
      chart,
      chat: {
        userBackground: colors.chat.userMessageBackground,
        userBorder: colors.chat.divider,
        assistantBackground: colors.chat.assistantMessageBackground,
        toolBackground: colors.tools.background,
        toolBorder: colors.chat.divider,
      },
    },
    config: resource.config?.fonts
      ? {
          fonts: {
            display: resource.config.fonts.heading ?? resource.config.fonts.sans,
            mono: resource.config.fonts.mono,
          },
        }
      : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined || value === null) {
    throw new Error(`Theme registry contains an empty value at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => assertNoUndefined(item, `${path}.${key}`));
  }
}

export function validateThemeRegistry(registry: readonly Theme[]): Theme[] {
  const ids = new Set<string>();
  for (const theme of registry) {
    const id = theme.metadata.id;
    if (!id || ids.has(id)) {
      throw new Error(`Theme registry contains duplicate or empty id: ${id}`);
    }
    ids.add(id);
    if (theme.metadata.variant !== "light" && theme.metadata.variant !== "dark") {
      throw new Error(`Theme ${id} has invalid variant: ${theme.metadata.variant}`);
    }
    if (theme.colors.chart.length !== 8) {
      throw new Error(`Theme ${id} must define exactly 8 chart colors`);
    }
    assertNoUndefined(theme, `themes.${id}`);
  }
  return [...registry];
}

export const themes = validateThemeRegistry([
  ...zetaThemeResources,
  ...presetThemeResources.map(presetToTheme),
]);

export function getThemeById(id: string): Theme | undefined {
  return themes.find((theme) => theme.metadata.id === (ALIASES[id] ?? id));
}

export function getDefaultTheme(variant: ThemeVariant): Theme {
  const defaultId = variant === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  return getThemeById(defaultId) ?? themes[0]!;
}
