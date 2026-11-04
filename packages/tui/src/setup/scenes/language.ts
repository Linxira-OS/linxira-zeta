import { type SelectItem, SelectList } from "../../components/select-list";
import { Text } from "../../components/text";
import { WizardStep } from "../../components/wizard-step";
import { getSelectListTheme } from "../../theme/theme";
import { tuiText } from "../../i18n";
import { col, span, text } from "../../native/describe";
import type { NativeNode } from "../../native/node";
import { Memo } from "../../native/memo";
import type { SetupLanguage, SetupScene, SetupSceneController, SetupSceneHost } from "./types";

/** The two catalogues shipped by the coding agent. Values match `cfgLanguage`. */
const LANGUAGE_ITEMS: readonly SelectItem[] = [
	{ value: "en", label: "English", description: "English interface" },
	{ value: "zh", label: "简体中文", description: "Chinese interface" },
];

class LanguageSceneController implements SetupSceneController {
	get title(): string {
		return tuiText("setupLanguageTitle", "Choose language");
	}

	get subtitle(): string {
		return tuiText("setupLanguageSubtitle", "Choose the language for the CLI and settings.");
	}

	readonly #host: SetupSceneHost;
	readonly #selectList: SelectList;
	readonly #native = new Memo();
	#step: WizardStep | undefined;
	#committing = false;

	constructor(host: SetupSceneHost) {
		this.#host = host;
		this.#selectList = new SelectList(LANGUAGE_ITEMS, LANGUAGE_ITEMS.length, getSelectListTheme());
		const currentIndex = LANGUAGE_ITEMS.findIndex(item => item.value === host.ctx.language);
		this.#selectList.setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
		this.#selectList.onSelect = item => {
			void this.#commit(item.value as SetupLanguage);
		};
		this.#selectList.onCancel = () => host.finish("skipped");
	}

	invalidate(): void {
		this.#native.clear();
		if (this.#step) this.#step.invalidate();
		else this.#selectList.invalidate();
	}

	handleInput(data: string): void {
		if (this.#committing) return;
		if (this.#step) this.#step.handleInput(data);
		else this.#selectList.handleInput(data);
	}

	routeMouse(event: Parameters<SelectList["routeMouse"]>[0], line: number, col: number): void {
		if (this.#committing) return;
		this.#step?.routeMouse(event, line, col);
	}

	render(width: number, maxLines?: number): readonly string[] {
		if (!this.#step) {
			this.#step = new WizardStep({
				kind: "choice",
				intro: new Text(
					tuiText("setupLanguageHint", "The choice applies to the rest of onboarding immediately."),
					0,
					0,
				),
				content: this.#selectList,
				minContentLines: LANGUAGE_ITEMS.length,
				fitContent: () => {
					this.#selectList.setMaxVisible(LANGUAGE_ITEMS.length);
				},
			});
		}
		this.#step.setMaxHeight(maxLines);
		return this.#step.render(width);
	}

	describe(): NativeNode {
		return this.#native.get([this.#selectList], () =>
			col(
				[
					text([
						span(
							tuiText("setupLanguageHint", "The choice applies to the rest of onboarding immediately."),
							"muted",
						),
					]),
					this.#selectList,
				],
				{ gap: "sm", role: "zeta.setup.language" },
			),
		);
	}

	async #commit(language: SetupLanguage): Promise<void> {
		if (this.#committing) return;
		this.#committing = true;
		try {
			await this.#host.ctx.saveLanguage(language);
			this.#host.ctx.ui.invalidate();
			this.#host.requestRender();
			this.#host.finish("done");
		} catch (error) {
			this.#committing = false;
			this.#host.ctx.showError(`Could not save the language: ${error instanceof Error ? error.message : error}`);
			this.#host.requestRender();
		}
	}
}

/** Pick the UI and settings language before the provider/model scenes run. */
export const languageSetupScene: SetupScene = {
	id: "language",
	get title(): string {
		return tuiText("setupLanguageTitle", "Choose language");
	},
	step: "Language",
	minVersion: 3,
	mount: host => new LanguageSceneController(host),
};
