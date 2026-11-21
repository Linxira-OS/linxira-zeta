/**
 * Keyboard helpers the deck needs, ported from OMP Studio (MIT)
 * `keyboard/shortcuts.ts`. The deck only needs the primary-modifier test, so
 * the shortcut table stays in the chat/composer module that renders hints.
 */

import { PLATFORM, type RendererPlatform } from "../primitives/platform";

export function isPrimaryModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
	platform: RendererPlatform = PLATFORM,
): boolean {
	return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey || event.metaKey;
}
