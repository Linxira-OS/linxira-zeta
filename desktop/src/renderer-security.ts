export interface RendererSender { isDestroyed(): boolean; getURL(): string }

/** Only the existing Host document is allowed to invoke desktop capabilities. */
export function isTrustedRendererUrl(value: string, origin: string): boolean {
	try {
		const url = new URL(value), expected = new URL(origin);
		return url.origin === expected.origin && !url.username && !url.password && url.pathname === "/";
	} catch { return false; }
}

export function secureWebPreferences(preload: string) {
	return { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false };
}

export function isExternalWebLink(value: string): boolean {
	try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
