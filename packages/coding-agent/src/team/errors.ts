/** A user-facing team layout / registration failure. */
export class TeamError extends Error {
	override name = "TeamError";

	constructor(message: string) {
		super(message);
	}
}

/** Narrow an unknown thrown value into a message for the CLI. */
export function formatTeamError(error: unknown): string {
	if (error instanceof TeamError) return error.message;
	if (error instanceof Error) return error.message;
	return String(error);
}
