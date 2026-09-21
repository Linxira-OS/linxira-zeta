import { type Component, Markdown, Text, type TUI } from "../index";
import { tuiText, tuiTextFmt } from "../i18n";
import { replaceTabs } from "../render/render-utils";
import { getMarkdownTheme, theme } from "../theme/theme";
import { OverlayPanel } from "../chrome/overlay-box";
import { StreamingPanelContent } from "../chrome/streaming-panel";

export type OmfgPanelState =
	| "generating"
	| "validating"
	| "confirming"
	| "saving"
	| "saved"
	| "rejected"
	| "aborted"
	| "error";

interface OmfgPanelComponentOptions {
	complaint: string;
	tui: TUI;
}

export class OmfgPanelComponent extends OverlayPanel {
	#tui: TUI;
	#state: OmfgPanelState = "generating";
	#status: string | undefined;
	#preview = "";
	#savedPath: string | undefined;
	#errorMessage: string | undefined;
	#closed = false;
	readonly #content: StreamingPanelContent;

	constructor(options: OmfgPanelComponentOptions) {
		super(`/omfg ${replaceTabs(options.complaint)}`);
		this.#tui = options.tui;
		this.#content = new StreamingPanelContent(() => ({
			sections: [
				new Text(
					theme.fg("muted", replaceTabs(this.#status ?? tuiText("omfgStatusGenerating", "Generating TTSR rule…"))),
					0,
					0,
				),
				this.#contentComponent(),
			],
			footer: this.#footerLine(),
		}));
		this.addChild(this.#content);
		this.#rebuild();
	}

	appendDraft(delta: string): void {
		if (!delta || this.#closed) return;
		this.#preview += delta;
		this.#rebuild();
	}

	setRule(text: string): void {
		if (this.#closed) return;
		this.#preview = text;
		this.#rebuild();
	}

	setStatus(state: OmfgPanelState, status: string): void {
		if (this.#closed) return;
		this.#state = state;
		this.#status = status;
		this.#errorMessage = undefined;
		this.#rebuild();
	}

	markSaved(path: string): void {
		if (this.#closed) return;
		this.#state = "saved";
		this.#savedPath = path;
		this.#status = undefined;
		this.#errorMessage = undefined;
		this.#rebuild();
	}

	markRejected(): void {
		if (this.#closed) return;
		this.#state = "rejected";
		this.#status = undefined;
		this.#errorMessage = undefined;
		this.#rebuild();
	}

	markAborted(): void {
		if (this.#closed) return;
		this.#state = "aborted";
		this.#status = undefined;
		this.#errorMessage = undefined;
		this.#rebuild();
	}

	markError(message: string): void {
		if (this.#closed) return;
		this.#state = "error";
		this.#status = undefined;
		this.#errorMessage = message;
		this.#rebuild();
	}

	close(): void {
		this.#closed = true;
	}

	#rebuild(): void {
		this.#content.refresh();
		this.#tui.requestRender();
	}

	#footerLine(): string {
		switch (this.#state) {
			case "generating":
			case "validating":
			case "confirming":
			case "saving":
				return theme.fg("muted", tuiText("omfgFooterCancel", "Esc cancel /omfg"));
			case "saved":
				return theme.fg(
					"success",
					tuiTextFmt(
						"omfgFooterSavedFmt",
						"Registered live · %s · Esc dismiss",
						replaceTabs(this.#savedPath ?? tuiText("omfgSavedPathFallback", "saved")),
					),
				);
			case "rejected":
				return theme.fg(
					"warning",
					`${theme.status.warning} ${tuiText("omfgFooterRejected", "Not saved · Esc dismiss")}`,
				);
			case "aborted":
				return theme.fg(
					"warning",
					`${theme.status.warning} ${tuiText("omfgFooterAborted", "Cancelled · Esc dismiss")}`,
				);
			case "error":
				return theme.fg("error", `${theme.status.error} ${tuiText("omfgFooterError", "Error · Esc dismiss")}`);
		}
	}

	#contentComponent(): Component {
		if (this.#state === "error") {
			return new Text(
				theme.fg("error", replaceTabs(this.#errorMessage ?? tuiText("overlayUnknownError", "Unknown error"))),
				0,
				0,
			);
		}
		const text = replaceTabs(this.#preview).trim();
		if (!text) {
			return new Text(
				theme.fg("dim", `${theme.status.pending} ${tuiText("omfgWaitingRule", "Waiting for candidate rule…")}`),
				0,
				0,
			);
		}
		return new Markdown(text, 0, 0, getMarkdownTheme());
	}
}
