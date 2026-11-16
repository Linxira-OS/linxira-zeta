import { StudioEventSocket } from "./remote/http";

/** A connection to the existing Zeta Host, never a second authority. */
export interface DesktopHostConnection {
	readonly base: string;
	gateway<T = unknown>(route: string, init?: RequestInit): Promise<T>;
	query<T = unknown>(request: unknown): Promise<T>;
	socket(route: string): Promise<StudioEventSocket>;
}

export interface LocalHostOptions {
	base: string;
	fetch: typeof fetch;
	cookie(): Promise<string | undefined>;
}

/** Electron supplies its renderer session's fetch and cookie jar. Pairing stays in the Host. */
export function localHostConnection(options: LocalHostOptions): DesktopHostConnection {
	const base = options.base.replace(/\/$/, "");
	let csrf: string | undefined;
	const request = async <T>(route: string, init: RequestInit = {}): Promise<T> => {
		if (!route.startsWith("/api/") || route.startsWith("//")) throw new Error("Invalid Host route");
		const mutate = !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) && route !== "/api/v1/query";
		if (mutate && csrf === undefined) {
			const bootstrap = await options.fetch(`${base}/api/v1/bootstrap`, { credentials: "include", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
			if (!bootstrap.ok) throw new Error(`Host bootstrap failed (${bootstrap.status})`);
			csrf = bootstrap.headers.get("x-studio-csrf") ?? "";
			await bootstrap.body?.cancel();
		}
		const headers = new Headers(init.headers);
		headers.set("accept", "application/json");
		if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
		if (mutate && csrf) headers.set("x-studio-csrf", csrf);
		const response = await options.fetch(`${base}${route}`, {
			...init, credentials: "include", headers,
			signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error((await response.text().catch(() => "")) || `Host request failed (${response.status})`);
		return await response.json() as T;
	};
	return {
		base,
		gateway: request,
		query: body => request("/api/v1/query", { method: "POST", body: JSON.stringify(body) }),
		async socket(route) {
			if (!route.startsWith("/api/terminal/") || route.startsWith("//")) throw new Error("Invalid terminal socket route");
			return new StudioEventSocket(`${base.replace(/^http/, "ws")}${route}`, await options.cookie());
		},
	};
}
