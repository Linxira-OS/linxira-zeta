import { type SlashNativeUi } from "../composer/commands";

const SLASH_UI_INTENT_KEY = "zeta.slashUiIntent";

export function setSlashUiIntent(ui: SlashNativeUi): void {
  window.dispatchEvent(new CustomEvent("zeta-studio-slash-ui", { detail: ui }));
  try {
    sessionStorage.setItem(SLASH_UI_INTENT_KEY, ui);
  } catch {
    /* sessionStorage may be blocked */
  }
}

export function takeSlashUiIntent(): SlashNativeUi | undefined {
  try {
    const raw = sessionStorage.getItem(SLASH_UI_INTENT_KEY);
    if (raw === null) return undefined;
    sessionStorage.removeItem(SLASH_UI_INTENT_KEY);
    return raw as SlashNativeUi;
  } catch {
    return undefined;
  }
}
