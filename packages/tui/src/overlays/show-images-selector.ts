import { type SelectItem, SelectList, type SgrMouseEvent } from "../index";
import { tuiText } from "../i18n";
import { getSelectListTheme } from "../theme/theme";
import { OverlayPanel } from "../chrome/overlay-box";
import { routeSelectListMouseWithTopBorder } from "../chrome/select-list-mouse-routing";
import type { DescribeContext, NativeNode, NativeUiEvent } from "../native/node";
import { SelectListSheet } from "../native/picker";

/**
 * Component that renders a show images selector with borders
 */
export class ShowImagesSelectorComponent extends OverlayPanel {
	#selectList: SelectList;
	#sheet: SelectListSheet;

	constructor(currentValue: boolean, onSelect: (show: boolean) => void, onCancel: () => void) {
		super(tuiText("showImagesTitle", "Show Images"), "omp.overlay.show-images");

		const items: SelectItem[] = [
			{
				value: "yes",
				label: tuiText("ssConfirmYes", "Yes"),
				description: tuiText("showImagesYesDesc", "Show images inline in terminal"),
			},
			{
				value: "no",
				label: tuiText("ssConfirmNo", "No"),
				description: tuiText("showImagesNoDesc", "Show text placeholder instead"),
			},
		];

		// Create selector
		this.#selectList = new SelectList(items, 5, getSelectListTheme());

		// Preselect current value
		this.#selectList.setSelectedIndex(currentValue ? 0 : 1);

		this.#selectList.onSelect = item => {
			onSelect(item.value === "yes");
		};

		this.#selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.#selectList);
		this.#sheet = new SelectListSheet(this.#selectList, {
			title: "Show images",
			noun: "options",
			current: [currentValue ? "yes" : "no"],
		});
	}

	override describe(cx: DescribeContext): NativeNode | null {
		return cx.supports("picker") ? this.#sheet.describe() : super.describe(cx);
	}

	/** Picker pointer events drive the list exactly as its keys do. */
	handleNativeEvent(event: NativeUiEvent): void {
		this.#sheet.handle(event);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		routeSelectListMouseWithTopBorder(this.#selectList, event, line, col);
	}

	override render(width: number): readonly string[] {
		this.title = tuiText("showImagesTitle", "Show Images");
		return super.render(width);
	}
}
