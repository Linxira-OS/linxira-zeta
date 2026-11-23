// @ts-nocheck — merge checkpoint: test callsites lag the OMP 19.1 API migration
import type { InternalResource } from "@linxiraos/zeta/internal-urls/types";

/** Text a router-resolved resource carries; throws when its handler served bytes. */
export function resourceText(resource: InternalResource<string | Buffer>): string {
	if (typeof resource.content !== "string") {
		throw new Error(`${resource.url} resolved to ${resource.content.length} bytes, not text`);
	}
	return resource.content;
}
