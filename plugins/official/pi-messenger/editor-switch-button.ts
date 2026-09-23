/**
 * Top-right rounded button that switches to the TTT editor.
 *
 * The button is a header widget (ExtensionUIContext.setHeader) rather than a
 * status-line segment: status-line segments come from a fixed preset list the
 * user configures (cost, model, context…), while this is a product affordance
 * that must always be present. Drawing it with the theme's rounded box
 * characters keeps it visually distinct from the status band.
 *
 * The widget owns no state beyond the label: every render re-reads the
 * installed state so an install triggered elsewhere shows up without a
 * rebuild.
 */

import { getSymbolTheme, theme } from "@linxiraos/pi-tui/theme";
import { findEditorBinary } from "./editor-binary.ts";

/** One-row rounded button; the caller right-aligns it via leading padding. */
class EditorSwitchButton {
	#label = "Editor";
	#installed = false;
	#onClick: () => void;

	constructor(onClick: () => void) {
		this.#onClick = onClick;
	}

	/** Refresh cached state; called at the top of every render. */
	#refresh(): void {
		this.#installed = findEditorBinary() !== null;
		this.#label = this.#installed ? "Editor" : "Editor (not installed)";
	}

	render(width: number): readonly string[] {
		this.#refresh();
		const box = getSymbolTheme().boxRound;
		const text = ` ${this.#label} `;
		const buttonWidth = Math.min(width, text.length + 2);
		const pad = Math.max(0, width - buttonWidth);
		const accent = this.#installed ? "accent" : "muted";
		const painted = theme.fg(accent, `${box.topLeft}${box.horizontal}${text}${box.horizontal}${box.topRight}`);
		return [`${" ".repeat(pad)}${painted}`];
	}

	/** The header row is a single line, so any routed click activates it. */
	handleMouse(_x: number, _y: number): boolean {
		this.#onClick();
		return true;
	}

	dispose(): void {
		// No timers, no subscriptions.
	}
}

/**
 * Header-widget factory for ExtensionUIContext.setHeader. `onSwitch` performs
 * the handoff + spawn; the widget only reports state and forwards clicks.
 * A fresh instance per factory call keeps a re-registered header from
 * inheriting a stale onClick.
 */
export function createEditorSwitchButton(onSwitch: () => void): () => EditorSwitchButton {
	return () => new EditorSwitchButton(onSwitch);
}
