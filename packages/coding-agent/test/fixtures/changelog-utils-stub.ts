import packageJson from "../../package.json" with { type: "json" };

export const VERSION = packageJson.version;
export const getLastChangelogVersionPath = (): string => "";
export const getChangelogPath = (): string | undefined => undefined;
export const $env: Record<string, string> = { ...(process.env as Record<string, string>) };
export const $envExact = (name: string): string | undefined => process.env[name];
export const directoryIsEnterable = (): boolean => true;
export const getAgentDir = (): string => "/tmp/zeta-stub-agent";
export const getProjectDir = (): string => process.cwd();
export const isBunTestRuntime = (): boolean => true;
// Mirrors the real pi-utils isRecord contract; boolean form keeps this
// dependency-free fixture free of local type-guard predicates.
export const isRecord = (value: unknown): boolean =>
	typeof value === "object" && value !== null && !Array.isArray(value);
export const once = (fn: (...args: unknown[]) => unknown): ((...args: unknown[]) => unknown) => {
	let called = false;
	let result: unknown;
	return (...args: unknown[]) => {
		if (!called) {
			called = true;
			result = fn(...args);
		}
		return result;
	};
};
export const parseFlag = (value: string | undefined, def = false): boolean =>
	value === undefined ? def : value !== "false" && value !== "0";
export const ptree = { error: () => {}, warn: () => {}, info: () => {} };
export const stringifyYamlConfig = (value: unknown): string => JSON.stringify(value);
export const untilAborted = async <T>(promise: Promise<T>): Promise<T> => promise;
export const withFileLock = async <T>(fn: () => Promise<T>): Promise<T> => fn();
export const wrapFetchForExtraCa = (fetchImpl: typeof fetch): typeof fetch => fetchImpl;
export const extractHttpStatusFromError = (error: unknown): number | undefined => {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const match = /\b(?:HTTP|status)[ :=]+(\d{3})\b/i.exec(message);
	return match ? Number(match[1]) : undefined;
};
export const extractRetryHint = (
	source: unknown,
	body?: string,
	options?: unknown,
): number | undefined => undefined;
export const isEnoent = (error: unknown): boolean =>
	typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
export const logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
