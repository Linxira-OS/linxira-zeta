/**
 * Public conversation-compaction shapes. The native session module owns the
 * primitive values and parsing rules; this protocol file only re-exports them,
 * so native maintenance and the Studio host can never diverge.
 */
export type {
	SessionCompactionRead,
	SessionCompactionState,
	SessionCompactionThreshold,
} from "../../../../session/session-compaction-types.js";
export {
	formatSessionCompactionInput,
	parseSessionCompactionInput,
	readSessionCompactionThreshold,
	SESSION_COMPACTION_ENTRY,
} from "../../../../session/session-compaction-types.js";
