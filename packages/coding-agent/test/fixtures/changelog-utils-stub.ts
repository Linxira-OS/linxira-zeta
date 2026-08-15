import packageJson from "../../package.json" with { type: "json" };

export const VERSION = packageJson.version;
export const getLastChangelogVersionPath = (): string => "";
export const getChangelogPath = (): string | undefined => undefined;
export const isEnoent = (error: unknown): boolean =>
	typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
export const wrapFetchForExtraCa = <T extends ((input: unknown, init?: unknown) => unknown) | undefined>(
	fetchImpl: T,
): T => fetchImpl;
export const logger = { error: () => {}, warn: () => {} };
