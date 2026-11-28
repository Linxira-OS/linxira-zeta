/**
 * A one-shot request from a slash command to the settings window.
 *
 * `/2fa`, `/channels` and `/im` ask for their page before calling the same
 * `showSettingsSelector()` every settings entry uses; the selector consumes
 * the request synchronously when it claims a settings menu, so a failed or
 * already-open invocation cannot leak the page into a later `/settings`.
 */
export type SettingsPageRequest = "identity" | "im";

/** The settings page id that hosts the runtime subpages. */
export const RUNTIME_SETTINGS_PAGE_ID = "runtime";

let pending: SettingsPageRequest | undefined;

/** Ask the next settings window to open on `page`. */
export function requestSettingsPage(page: SettingsPageRequest): void {
	pending = page;
}

/** Consume the pending request, if one was made. */
export function takeSettingsPageRequest(): SettingsPageRequest | undefined {
	const page = pending;
	pending = undefined;
	return page;
}

/** Drop a request (for example a plain `/settings` invocation). */
export function clearSettingsPageRequest(): void {
	pending = undefined;
}
