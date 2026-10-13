import { DARK_THEME_STORAGE_KEY, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, LIGHT_THEME_STORAGE_KEY, THEME_MODE_STORAGE_KEY, themes } from "./themes";
import type { Theme, ThemeVariant } from "./types";

/**
 * Pre-hydration theme paint.
 *
 * The inline script runs while `<head>` is still parsing, so it must be small:
 * it publishes the L1 `--zeta-static-*` values of the selected preset for the
 * handful of roles that decide the first frame, plus their L2 aliases and the
 * L3 bridge names. The full three layers for the default light/dark themes
 * already come from the generated sheet (`styles/themes/zeta-static.css`).
 *
 * `[staticToken, aliasToken]` — the alias is the short semantic name the
 * pre-hydration stylesheet consumers use; identity pairs cover the names that
 * `ThemeSystemProvider` also republishes after hydration.
 */
const BOOTSTRAP_ROLES: ReadonlyArray<readonly [string, string]> = [
  ["surface-background", "bg"],
  ["surface-background", "surface-background"],
  ["surface-muted", "bg-panel"],
  ["surface-muted", "surface-muted"],
  ["surface-elevated", "bg-elevated"],
  ["surface-elevated", "surface-elevated"],
  ["interactive-hover", "bg-hover"],
  ["interactive-selection", "bg-selected"],
  ["interactive-border", "border"],
  ["surface-foreground", "text"],
  ["surface-foreground", "surface-foreground"],
  ["surface-muted-foreground", "text-muted"],
  ["surface-muted-foreground", "text-dim"],
  ["surface-muted-foreground", "surface-muted-foreground"],
  ["primary-base", "accent"],
  ["primary-base", "primary-base"],
  ["chat-user-background", "user-bg"],
  ["chat-tool-background", "tool-bg"],
];

interface BootstrapTheme {
  variant: ThemeVariant;
  staticValues: Record<string, string>;
}

function toBootstrapTheme(theme: Theme): BootstrapTheme {
  return {
    variant: theme.metadata.variant,
    staticValues: {
      "surface-background": theme.colors.surface.background,
      "surface-muted": theme.colors.surface.muted,
      "surface-elevated": theme.colors.surface.elevated,
      "surface-foreground": theme.colors.surface.foreground,
      "surface-muted-foreground": theme.colors.surface.mutedForeground,
      "interactive-hover": theme.colors.interactive.hover,
      "interactive-selection": theme.colors.interactive.selection,
      "interactive-border": theme.colors.interactive.border,
      "primary-base": theme.colors.primary.base,
      "chat-user-background": theme.colors.chat.userBackground,
      "chat-tool-background": theme.colors.chat.toolBackground,
    },
  };
}

const BOOTSTRAP_THEMES = Object.fromEntries(themes.map((theme) => [theme.metadata.id, toBootstrapTheme(theme)]));

function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function getThemeBootstrapScript(): string {
  const themesJson = scriptValue(BOOTSTRAP_THEMES);
  const rolesJson = scriptValue(BOOTSTRAP_ROLES);
  const defaultsJson = scriptValue({ light: DEFAULT_LIGHT_THEME_ID, dark: DEFAULT_DARK_THEME_ID });
  const keysJson = scriptValue({ mode: THEME_MODE_STORAGE_KEY, light: LIGHT_THEME_STORAGE_KEY, dark: DARK_THEME_STORAGE_KEY });

  return `(function(){try{
var themes=${themesJson};
var roles=${rolesJson};
var defaults=${defaultsJson};
var keys=${keysJson};
var legacy=localStorage.getItem("zeta-theme");
var mode=localStorage.getItem(keys.mode);
if(mode!=="system"&&mode!=="light"&&mode!=="dark") mode=legacy==="light"?"light":"dark";
var lightId=localStorage.getItem(keys.light)||defaults.light;
var darkId=localStorage.getItem(keys.dark)||(legacy==="starfield"?"zeta-starfield":defaults.dark);
var systemDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
var variant=mode==="system"?(systemDark?"dark":"light"):mode;
var id=variant==="dark"?darkId:lightId;
var theme=themes[id]&&themes[id].variant===variant?themes[id]:themes[variant==="dark"?defaults.dark:defaults.light];
if(!theme) return;
var root=document.documentElement;
root.dataset.theme=theme.variant;
root.dataset.themeId=id;
root.classList.toggle("dark",theme.variant==="dark");
root.classList.toggle("light",theme.variant==="light");
root.classList.toggle("starfield",id==="zeta-starfield");
var values=theme.staticValues;
var css=":root{";
for(var i=0;i<roles.length;i++) css+="--zeta-static-"+roles[i][0]+":"+values[roles[i][0]]+";";
for(var j=0;j<roles.length;j++) css+="--zeta-alias-"+roles[j][1]+":var(--zeta-static-"+roles[j][0]+");";
for(var k=0;k<roles.length;k++) css+="--"+roles[k][1]+":var(--zeta-alias-"+roles[k][1]+");";
css+="}";
var style=document.getElementById("zeta-theme-bootstrap");if(!style){style=document.createElement("style");style.id="zeta-theme-bootstrap";document.head.appendChild(style);}style.textContent=css;
var meta=document.querySelector('meta[name="theme-color"]');if(meta) meta.setAttribute("content",theme.staticValues["surface-background"]);
}catch(_){}})();`;
}
