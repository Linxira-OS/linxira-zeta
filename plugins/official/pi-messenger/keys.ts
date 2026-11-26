/**
 * Key matching for the messenger's rows objects.
 *
 * `ctx.ui.custom` rows objects receive raw terminal input, not decoded key
 * events, so match a single key id by decoding the input with the host's own
 * decoder. This keeps the overlay's bindings on the same key ids as the rest
 * of the 19.2 UI (`shift+r`, `ctrl+c`, `escape`, …).
 */
import { decodeInput } from "@linxiraos/pi-tui/driver/input/decoder";

export function matchesKey(data: string, keyId: string): boolean {
	const events = decodeInput(data);
	return events.length === 1 && events[0]?.type === "key" && events[0].key.id === keyId;
}
