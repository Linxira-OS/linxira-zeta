/** Additive settings surface for Runtime 18.10; the published settings payload stays unchanged. */
export const FEATURE_SETTING_KEYS = [
	"task.agentAccountPools",
	"compaction.modelThresholds",
	"retry.fallbackOn",
	"contextFiles.extra",
	"task.structured",
	"bash.gitGuard",
	"worktree.onStart",
	"worktree.onExit",
	"composer.predictions",
	"speech.speed",
	"tts.localSpeed",
	"gc.compress",
	"gc.compressAfterDays",
	"prewalk.auto",
	"prewalk.autoTarget",
	"async.widgets",
	"computer.backgroundFallback",
	"tools.restrictedFolders",
	"extensionHandlers.modeControl",
	"recap.enabled",
	"recap.idleSeconds",
	"compaction.idleEnabled",
	"compaction.idleThresholdTokens",
	"compaction.idleTimeoutSeconds",
	"gc.autoCompress",
	"session.worktreeScope",
	"stt.enabled",
	"stt.language",
] as const;
export type FeatureSettingKey = (typeof FEATURE_SETTING_KEYS)[number];
export type FeatureSettingValue =
	| null
	| boolean
	| number
	| string
	| FeatureSettingValue[]
	| { [key: string]: FeatureSettingValue };
export interface FeatureSettingRow {
	key: FeatureSettingKey;
	value: FeatureSettingValue;
	source: "env" | "runtime" | "overlay" | "project" | "global" | "default";
}
export interface PoolAccountOption {
	provider: string;
	identityKey: string;
	label: string;
}
export interface CompactionPreview {
	valid: boolean;
	summary?: string;
	window?: number;
	trigger?: number;
	extended: boolean;
}
export type FeatureSettingsOperation =
	| { kind: "preferences.features.get"; sessionId: string }
	| {
			kind: "preferences.features.set";
			sessionId: string;
			key: FeatureSettingKey;
			value: FeatureSettingValue;
			scope: "session" | "global";
	  }
	| { kind: "preferences.features.clearOverride"; sessionId: string; key: FeatureSettingKey }
	| { kind: "accounts.pool.options"; sessionId: string }
	| { kind: "models.compaction.preview"; sessionId: string; selector: string; input: string }
	| { kind: "models.compaction.set"; sessionId: string; selector: string; input: string; confirmed?: boolean };
export interface FeatureSettingsResultMap {
	"preferences.features.get": { settings: FeatureSettingRow[] };
	"preferences.features.set": FeatureSettingRow;
	"preferences.features.clearOverride": FeatureSettingRow;
	"accounts.pool.options": { accounts: PoolAccountOption[]; truncated: boolean };
	"models.compaction.preview": CompactionPreview;
	"models.compaction.set": { saved: boolean; confirmationRequired: boolean; summary: string };
}
export const FEATURE_SETTINGS_KINDS = [
	"preferences.features.get",
	"preferences.features.set",
	"preferences.features.clearOverride",
	"accounts.pool.options",
	"models.compaction.preview",
	"models.compaction.set",
] as const;
export const FEATURE_SETTINGS_READ_KINDS = [
	"preferences.features.get",
	"accounts.pool.options",
	"models.compaction.preview",
] as const;
export function isFeatureSettingsKind(kind: string): kind is FeatureSettingsOperation["kind"] {
	return (FEATURE_SETTINGS_KINDS as readonly string[]).includes(kind);
}






