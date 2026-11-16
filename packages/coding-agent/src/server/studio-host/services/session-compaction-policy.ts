/**
 * Conversation compaction policy shared by native maintenance/context usage and
 * the Studio service surface. The native session module owns the resolution so
 * a persisted override can never affect only a renderer preview.
 */
export {
	resolveSessionCompactionSettings,
	readSessionCompactionState,
	sessionCompactionThreshold,
} from "../../../session/session-compaction.js";
