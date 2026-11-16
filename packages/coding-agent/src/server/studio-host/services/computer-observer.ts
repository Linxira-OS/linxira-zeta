import { createDesktopSession } from "@linxiraos/pi-natives/desktop";
import type {
	DesktopCapabilities,
	DesktopCapture,
	DesktopDisplay,
	DesktopWindow,
	DesktopScreenState,
	DesktopObservation,
	AxSnapshotOptions,
} from "@linxiraos/pi-natives";
import type { ComputerStructureNode } from "../protocol/contracts/computer-workspace.js";

/** Positive passive ABI gate: a stale binding never starts an input-enabled fallback. */
export interface ComputerObserver {
	readonly observationOnly?: boolean;
	readonly capabilities: DesktopCapabilities;
	readonly screenState: DesktopScreenState;
	listDisplays(): Promise<DesktopDisplay[]>;
	listWindows(): Promise<DesktopWindow[]>;
	capture(target: string, caps?: { maxWidth?: number; maxHeight?: number }): Promise<DesktopCapture>;
	observe(
		target: string,
		caps?: { maxWidth?: number; maxHeight?: number },
		options?: AxSnapshotOptions,
	): Promise<DesktopObservation & { nodes?: ComputerStructureNode[] | null; coordinateSpace?: string | null }>;
	cancel(): void;
	close(): Promise<void>;
}
export function createComputerObserver(): ComputerObserver {
	const options = { display: "all", observationOnly: true };
	const observer = createDesktopSession(options);
	if (observer.observationOnly !== true) {
		observer.cancel();
		void observer.close().catch(() => {});
		throw new Error("The native addon cannot provide passive observation");
	}
	return observer;
}
