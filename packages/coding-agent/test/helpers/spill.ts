import type { ArtifactAllocator } from "@linxiraos/pi-tui/tools/streaming-output";

/** Allocator that hands an `OutputSink` the fixed file `path` as spill `id`. */
export function spillTo(path: string, id: string): ArtifactAllocator {
	return async () => ({ id, path });
}
