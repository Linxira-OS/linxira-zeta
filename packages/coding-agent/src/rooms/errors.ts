/** A user-facing local room failure. */
export class RoomError extends Error {
	override name = "RoomError";

	constructor(message: string) {
		super(message);
	}
}

export function formatRoomError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
