import { DARK_THEME_STORAGE_KEY, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, LIGHT_THEME_STORAGE_KEY, THEME_MODE_STORAGE_KEY, themes } from "./themes";
import type { Theme, ThemeVariant } from "./types";

interface BootstrapTheme {
  variant: ThemeVariant;
  background: string;
  panel: string;
  elevated: string;
  hover: string;
  selection: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  userBackground: string;
  toolBackground: string;
}

function toBootstrapTheme(theme: Theme): BootstrapTheme {
  return {
    variant: theme.metadata.variant,
    background: theme.colors.surface.background,
    panel: theme.colors.surface.muted,
    elevated: theme.colors.surface.elevated,
    hover: theme.colors.interactive.hover,
    selection: theme.colors.interactive.selection,
    border: theme.colors.interactive.border,
    text: theme.colors.surface.foreground,
    muted: theme.colors.surface.mutedForeground,
    accent: theme.colors.primary.base,
    userBackground: theme.colors.chat.userBackground,
    toolBackground: theme.colors.chat.toolBackground,
  };
}

const BOOTSTRAP_THEMES = Object.fromEntries(themes.map((theme) => [theme.metadata.id, toBootstrapTheme(theme)]));

function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function getThemeBootstrapScript(): string {
  const themesJson = scriptValue(BOOTSTRAP_THEMES);
  const defaultsJson = scriptValue({ light: DEFAULT_LIGHT_THEME_ID, dark: DEFAULT_DARK_THEME_ID });
  const keysJson = scriptValue({ mode: THEME_MODE_STORAGE_KEY, light: LIGHT_THEME_STORAGE_KEY, dark: DARK_THEME_STORAGE_KEY });

  return `(function(){try{
var themes=${themesJson};
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
var vars={"--bg":theme.background,"--bg-panel":theme.panel,"--bg-elevated":theme.elevated,"--bg-hover":theme.hover,"--bg-selected":theme.selection,"--border":theme.border,"--text":theme.text,"--text-muted":theme.muted,"--text-dim":theme.muted,"--accent":theme.accent,"--primary-base":theme.accent,"--user-bg":theme.userBackground,"--tool-bg":theme.toolBackground,"--surface-background":theme.background,"--surface-muted":theme.panel,"--surface-elevated":theme.elevated,"--surface-foreground":theme.text,"--surface-muted-foreground":theme.muted};
var css=":root{";for(var name in vars) css+=name+":"+vars[name]+";";css+="}";
var style=document.getElementById("zeta-theme-bootstrap");if(!style){style=document.createElement("style");style.id="zeta-theme-bootstrap";document.head.appendChild(style);}style.textContent=css;
var meta=document.querySelector('meta[name="theme-color"]');if(meta) meta.setAttribute("content",theme.background);
}catch(_){}})();`;
}

export const themeBootstrapThemes = BOOTSTRAP_THEMES;
