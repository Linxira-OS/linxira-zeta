import { setTuiTextSource } from "@linxiraos/pi-tui";
import { M } from "./messages";

type TextLookup = Record<string, string | ((...args: never[]) => string)>;

/**
 * Bridge @linxiraos/pi-tui user-facing strings to the localised Messages
 * catalogue. `M` is a live proxy over the active language, so /language
 * switches apply on the next render. Unknown keys resolve to undefined and
 * the tui component keeps its inline English fallback. Called once from the
 * interactive CLI boot path; headless surfaces never register a source.
 */
export function wireTuiTexts(): void {
	setTuiTextSource(key => (M as unknown as TextLookup)[key] as string | undefined);
}
