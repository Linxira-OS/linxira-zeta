import type { Theme } from "./types";

const STYLE_ID = "zeta-theme-variables";

function declaration(name: string, value: string | undefined): string | null {
  return value ? `  ${name}: ${value};` : null;
}

function declarations(entries: Array<[string, string | undefined]>): string[] {
  return entries.flatMap(([name, value]) => {
    const entry = declaration(name, value);
    return entry ? [entry] : [];
  });
}

export class CSSVariableGenerator {
  generate(theme: Theme): string {
    const { colors } = theme;
    const values = declarations([
      ["--background", colors.surface.background],
      ["--foreground", colors.surface.foreground],
      ["--primary", colors.primary.base],
      ["--primary-base", colors.primary.base],
      ["--primary-hover", colors.primary.hover],
      ["--primary-active", colors.primary.active],
      ["--primary-foreground", colors.primary.foreground],
      ["--primary-muted", colors.primary.muted],
      ["--surface-background", colors.surface.background],
      ["--surface-foreground", colors.surface.foreground],
      ["--surface-muted", colors.surface.muted],
      ["--surface-muted-foreground", colors.surface.mutedForeground],
      ["--surface-elevated", colors.surface.elevated],
      ["--surface-elevated-foreground", colors.surface.elevatedForeground],
      ["--surface-overlay", colors.surface.overlay],
      ["--surface-subtle", colors.surface.subtle],
      ["--surface-shadow", colors.surface.overlay],
      ["--interactive-border", colors.interactive.border],
      ["--interactive-border-hover", colors.interactive.borderHover],
      ["--interactive-border-focus", colors.interactive.borderFocus],
      ["--interactive-selection", colors.interactive.selection],
      ["--interactive-selection-foreground", colors.interactive.selectionForeground],
      ["--interactive-focus", colors.interactive.focus],
      ["--interactive-focus-ring", colors.interactive.focusRing],
      ["--interactive-cursor", colors.interactive.cursor],
      ["--interactive-hover", colors.interactive.hover],
      ["--interactive-active", colors.interactive.active],
      ["--card", colors.surface.elevated],
      ["--card-foreground", colors.surface.elevatedForeground],
      ["--popover", colors.surface.elevated],
      ["--popover-foreground", colors.surface.elevatedForeground],
      ["--secondary", colors.surface.muted],
      ["--secondary-foreground", colors.surface.mutedForeground],
      ["--muted", colors.surface.muted],
      ["--muted-foreground", colors.surface.mutedForeground],
      ["--destructive", colors.status.error],
      ["--destructive-foreground", colors.status.errorForeground],
      ["--input", colors.interactive.border],
      ["--ring", colors.interactive.focusRing],
      ["--sidebar", colors.surface.muted],
      ["--sidebar-foreground", colors.surface.mutedForeground],
      ["--sidebar-primary", colors.primary.base],
      ["--sidebar-primary-foreground", colors.primary.foreground],
      ["--sidebar-accent", colors.interactive.hover],
      ["--sidebar-accent-foreground", colors.surface.foreground],
      ["--sidebar-border", colors.interactive.border],
      ["--sidebar-ring", colors.interactive.focusRing],
      ["--status-error", colors.status.error],
      ["--status-error-foreground", colors.status.errorForeground],
      ["--status-error-background", colors.status.errorBackground],
      ["--status-error-border", colors.status.errorBorder],
      ["--status-warning", colors.status.warning],
      ["--status-warning-foreground", colors.status.warningForeground],
      ["--status-warning-background", colors.status.warningBackground],
      ["--status-warning-border", colors.status.warningBorder],
      ["--status-success", colors.status.success],
      ["--status-success-foreground", colors.status.successForeground],
      ["--status-success-background", colors.status.successBackground],
      ["--status-success-border", colors.status.successBorder],
      ["--status-info", colors.status.info],
      ["--status-info-foreground", colors.status.infoForeground],
      ["--status-info-background", colors.status.infoBackground],
      ["--status-info-border", colors.status.infoBorder],
      ["--syntax-background", colors.syntax.background],
      ["--syntax-foreground", colors.syntax.foreground],
      ["--syntax-comment", colors.syntax.comment],
      ["--syntax-keyword", colors.syntax.keyword],
      ["--syntax-string", colors.syntax.string],
      ["--syntax-number", colors.syntax.number],
      ["--syntax-function", colors.syntax.function],
      ["--syntax-variable", colors.syntax.variable],
      ["--syntax-type", colors.syntax.type],
      ["--syntax-operator", colors.syntax.operator],
      ["--syntax-property", colors.syntax.property],
      ["--syntax-header", colors.syntax.header],
      ["--syntax-line-number", colors.syntax.lineNumber],
      ["--md-syntax-foreground", colors.syntax.foreground],
      ["--md-syntax-comment", colors.syntax.comment],
      ["--md-syntax-keyword", colors.syntax.keyword],
      ["--md-syntax-string", colors.syntax.string],
      ["--md-syntax-number", colors.syntax.number],
      ["--md-syntax-function", colors.syntax.function],
      ["--md-syntax-variable", colors.syntax.variable],
      ["--md-syntax-type", colors.syntax.type],
      ["--md-syntax-operator", colors.syntax.operator],
      ["--md-syntax-property", colors.syntax.property],
      ["--md-syntax-inserted", colors.status.success],
      ["--md-syntax-deleted", colors.status.error],
      ["--chat-user-background", colors.chat.userBackground],
      ["--chat-user-border", colors.chat.userBorder],
      ["--chat-assistant-background", colors.chat.assistantBackground],
      ["--chat-tool-background", colors.chat.toolBackground],
      ["--chat-tool-border", colors.chat.toolBorder],
      ...this.generateLegacyAliases(theme),
    ]);

    for (const [index, color] of colors.chart.entries()) {
      values.push(`  --chart-${index + 1}: ${color};`);
    }
    if (theme.config?.fonts?.display) values.push(`  --font-display: ${theme.config.fonts.display};`);
    if (theme.config?.fonts?.mono) values.push(`  --font-mono: ${theme.config.fonts.mono};`);
    return values.join("\n");
  }

  generateLegacyAliases(theme: Theme): Array<[string, string]> {
    const { colors } = theme;
    return [
      ["--bg", colors.surface.background], ["--bg-panel", colors.surface.muted], ["--bg-elevated", colors.surface.elevated],
      ["--bg-hover", colors.interactive.hover], ["--bg-selected", colors.interactive.selection], ["--bg-subtle", colors.surface.subtle],
      ["--border", colors.interactive.border], ["--text", colors.surface.foreground], ["--text-muted", colors.surface.mutedForeground],
      ["--text-dim", colors.syntax.lineNumber], ["--accent", colors.primary.base], ["--accent-hover", colors.primary.hover],
      ["--accent-active", colors.primary.active], ["--accent-muted", colors.primary.muted], ["--accent-dim", colors.primary.muted],
      ["--accent-foreground", colors.primary.foreground], ["--user-bg", colors.chat.userBackground],
      ["--assistant-bg", colors.chat.assistantBackground], ["--tool-bg", colors.chat.toolBackground],
      ["--color-bg", colors.surface.background], ["--color-bg-panel", colors.surface.muted], ["--color-bg-hover", colors.interactive.hover],
      ["--color-bg-selected", colors.interactive.selection], ["--color-border", colors.interactive.border], ["--color-text", colors.surface.foreground],
      ["--color-text-muted", colors.surface.mutedForeground], ["--color-text-dim", colors.syntax.lineNumber], ["--color-accent", colors.primary.base],
      ["--color-accent-hover", colors.primary.hover], ["--color-user-bg", colors.chat.userBackground],
      ["--color-assistant-bg", colors.chat.assistantBackground], ["--color-tool-bg", colors.chat.toolBackground], ["--color-bg-subtle", colors.surface.subtle],
    ];
  }

  apply(theme: Theme): void {
    const style = document.getElementById(STYLE_ID) ?? document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `:root {\n${this.generate(theme)}\n}`;
    if (!style.parentElement) document.head.appendChild(style);
    const root = document.documentElement;
    root.dataset.theme = theme.metadata.variant;
    root.dataset.themeId = theme.metadata.id;
    root.classList.toggle("dark", theme.metadata.variant === "dark");
    root.classList.toggle("light", theme.metadata.variant === "light");
    root.classList.toggle("starfield", theme.metadata.id === "zeta-starfield");
    document.getElementById("zeta-theme-bootstrap")?.remove();
  }
}
