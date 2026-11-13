/**
 * Small, dependency-free operation errors.
 *
 * Kept out of `gateway.ts` so an ops family can raise an invalid/unavailable
 * error without importing the gateway module, which pulls the web gateway and
 * the Studio host registry (an import cycle through `ops/index.ts`).
 */
import type { ClientErrorCode } from "./contract/index.js";

export class StudioOpError extends Error {
	readonly code: ClientErrorCode | "unsupported";

	constructor(code: ClientErrorCode | "unsupported", message: string) {
		super(message);
		this.name = "StudioOpError";
		this.code = code;
	}
}

export function invalid(message: string): StudioOpError {
	return new StudioOpError("INVALID_ARGUMENT", message);
}

export function unavailable(message: string): StudioOpError {
	return new StudioOpError("UNAVAILABLE", message);
}
