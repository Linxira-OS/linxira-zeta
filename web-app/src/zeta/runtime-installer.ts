/**
 * Type surface for Studio's updater payload; Zeta serves no updater, so it is type-only.
 *
 * The desktop chrome pushes one snapshot per update check. Both targets (`app`
 * and `runtime`) are always present in a snapshot — the desktop fills the
 * untouched one with its last known component state — so the renderer may read
 * `app.version` / `runtime.version` without guarding.
 */

/** Progress of one update target (the app bundle or the runtime bundle). */
export type UnifiedUpdatePhase =
	| "idle"
	| "checking"
	| "downloading"
	| "verifying"
	| "extracting"
	| "installing"
	| "applying"
	| "ready"
	| "failed"
	| "cancelled";

/** Where an update failure happened, mapped onto the desktop's recovery flow. */
export type UnifiedUpdateErrorStage = "check" | "prepare" | "apply" | "recovery";

/** How the desktop intends to deliver a new version. */
export type UnifiedUpdateMethod = "full" | "differential" | "reuse";

/** State of one update target inside a {@link UnifiedUpdateSnapshot}. */
export interface UnifiedUpdateComponent {
	readonly version: string;
	readonly available: boolean;
	readonly component?: "app" | "runtime" | undefined;
	readonly phase?: UnifiedUpdatePhase | undefined;
	readonly method?: UnifiedUpdateMethod | undefined;
	readonly currentVersion?: string | undefined;
	readonly blockedReason?: string | undefined;
	readonly message?: string | undefined;
	readonly errorStage?: UnifiedUpdateErrorStage | undefined;
	readonly receivedBytes?: number | undefined;
	readonly totalBytes?: number | undefined;
}

export interface UnifiedUpdateSnapshot {
	readonly app: UnifiedUpdateComponent;
	readonly runtime: UnifiedUpdateComponent;
	readonly checking: boolean;
	readonly error?: string | undefined;
	readonly errorStage?: UnifiedUpdateErrorStage | undefined;
	readonly rollbackAppVersion?: string | undefined;
	readonly rollbackAppPending?: boolean | undefined;
	readonly releaseNotesUrl?: string | undefined;
}
