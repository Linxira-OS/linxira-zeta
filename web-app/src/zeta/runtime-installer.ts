/** Type surface for Studio's updater payload; Zeta serves no updater, so it is type-only. */
export interface UnifiedUpdateSnapshot {
	readonly app?: { readonly version: string; readonly available: boolean };
	readonly runtime?: { readonly version: string; readonly available: boolean };
	readonly [key: string]: unknown;
}
