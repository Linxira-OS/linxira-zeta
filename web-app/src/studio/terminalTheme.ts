import type { ITheme, Terminal } from "@xterm/xterm";

export function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
}

/** Work Studio accent sets the cursor/selection; the ANSI ramp stays readable. */
const DARK_ANSI = {
  black: "#20242e",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#d7dae0",
  brightBlack: "#5c6370",
  brightRed: "#ff7b86",
  brightGreen: "#b5e890",
  brightYellow: "#ffd68a",
  brightBlue: "#82c4ff",
  brightMagenta: "#e2a6ff",
  brightCyan: "#7fd4de",
  brightWhite: "#ffffff",
} as const;

const LIGHT_ANSI = {
  black: "#24292f",
  red: "#b31d28",
  green: "#116329",
  yellow: "#7a5c00",
  blue: "#0b4f9c",
  magenta: "#8250df",
  cyan: "#0f6f7a",
  white: "#d0d7de",
  brightBlack: "#57606a",
  brightRed: "#cf222e",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightBlue: "#0550ae",
  brightMagenta: "#a475f9",
  brightCyan: "#1b7c83",
  brightWhite: "#ffffff",
} as const;

function isDarkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function readXtermTheme(): ITheme {
  const dark = isDarkTheme();
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI;
  return {
    background: readCssVar("--surface", dark ? "#1a1b1f" : "#ffffff"),
    foreground: readCssVar("--text", dark ? "#e7e8eb" : "#1d2129"),
    cursor: readCssVar("--accent", dark ? "#60a5fa" : "#2563eb"),
    cursorAccent: readCssVar("--surface", dark ? "#1a1b1f" : "#ffffff"),
    selectionBackground: readCssVar(
      "--accent-soft",
      dark ? "rgba(96, 165, 250, 0.28)" : "rgba(37, 99, 235, 0.18)",
    ),
    selectionForeground: readCssVar("--text", dark ? "#e7e8eb" : "#1d2129"),
    ...ansi,
  };
}

export function readTerminalTypography(): { fontFamily: string; fontSize: number } {
  return {
    fontFamily: readCssVar("--font-terminal", "Menlo, Consolas, monospace"),
    fontSize: Number.parseFloat(readCssVar("--terminal-font-size", "12px")),
  };
}

export function applyTheme(term: Terminal): void {
  term.options.theme = readXtermTheme();
  const typography = readTerminalTypography();
  term.options.fontFamily = typography.fontFamily;
  term.options.fontSize = typography.fontSize;
}
