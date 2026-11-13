import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientBootstrap, StudioClient } from "@linxiraos/studio-contract";
import { getAppSettings } from "../settings/appSettings";
import { useI18n } from "../i18n";
import { waitReceipt } from "../hostError";
import { Icon } from "../icons";
import {
	PAGE_CALL_TIMEOUT_MS,
	PluginPageBridge,
	installPageApi,
	pluginPageSrc,
	runPluginToolCall,
	type PageContext,
	type PluginToolOutcome,
	type PluginToolRequest,
} from "./bridge";
import "./plugins.css";

/**
 * REQ-055 — host for a plugin-shipped HTML page.
 *
 * The page is served by the gateway from its own package
 * (`/api/plugin-assets/<plugin>/<page>`) and mounted in a sandboxed
 * same-origin iframe. Chrome lives in the host; the document owns everything
 * below the header.
 *
 * ## Page API (`window.__zetaPage`, protocol v1)
 *
 * The host injects this object into the iframe on `load`. A page never sees a
 * host global:
 *
 * ```ts
 * interface ZetaPageApi {
 *   ready(capabilities?: string[]): void;                  // announce the page
 *   callTool(tool: string, args?: JsonValue): Promise<unknown>;
 *   getContext(): Promise<{ theme; language; cwd; plugin }>;
 *   subscribe(events: string[]): void;                     // answered with UNSUPPORTED_SUBSCRIPTION
 *   notify(level: "info" | "warning" | "error", message: string): void;
 *   on(type: "init" | "context" | "result" | "error" | "event", listener): () => void;
 *   resize(height?: number): void;                         // defaults to document height
 * }
 * ```
 *
 * `ready()` must be called once the page is able to receive `init`/`context`;
 * the host also answers `getContext()` and echoes every request id. A page
 * may call `resize()` itself; a `ResizeObserver` installed by the host sends
 * the document height automatically as well.
 *
 * `subscribe()` is deliberately not implemented: no permissionless event
 * projection exists for plugin pages yet, so the host answers
 * `UNSUPPORTED_SUBSCRIPTION` instead of pretending events will arrive.
 *
 * ## Security
 *
 * Only messages whose `source` is this iframe's `contentWindow` and whose
 * `origin` is the host origin are accepted. `callTool` forwards exactly
 * `{ plugin, tool, arguments?, sessionId? }`; no other page field reaches the
 * client. Tool failures map to `CALL_DENIED` (permission-ish) or
 * `CALL_FAILED`, never a silent success.
 */

export interface PluginPageHostProps {
	/** Host client; `null` while the transport is still being built. */
	readonly client: StudioClient | null;
	/** Plugin catalogue id, as addressed by `/plugins/view/<plugin>/<page>`. */
	readonly plugin: string;
	/** Package-relative page entry, e.g. `ui/board.html`. */
	readonly page: string;
	readonly title?: string;
	readonly onBack?: () => void;
	/**
	 * Session the tool call runs against. When omitted, the host uses the
	 * session already selected in the client bootstrap; it never invents one.
	 */
	readonly sessionId?: string;
	/**
	 * Project root for the page's package lookup. Studio App passes the
	 * selected workspace here; without it the host falls back to the client's
	 * `cwd`, which an iframe asset request cannot forward as a header.
	 */
	readonly cwd?: string;
}

type Notice = { readonly level: "info" | "warning" | "error"; readonly message: string };

/**
 * The browser transport carries the project cwd as `client.cwd` (the same
 * property `RawConfigEditor` reads). The semantic bootstrap deliberately has
 * no absolute paths, so this is the fallback when the route does not pass `cwd`.
 */
function readClientCwd(client: StudioClient | null): string {
	if (client === null || !("cwd" in client)) return "";
	const value: unknown = client.cwd;
	return typeof value === "string" ? value : "";
}

export function PluginPageHost({ client, plugin, page, title, onBack, sessionId, cwd }: PluginPageHostProps) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const projectCwd = cwd ?? readClientCwd(client);
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [frameHeight, setFrameHeight] = useState<number | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const disposeApiRef = useRef<(() => void) | null>(null);
	const bridgeRef = useRef<PluginPageBridge | null>(null);
	const bootstrapRef = useRef<Promise<ClientBootstrap | null> | null>(null);
	const sessionIdRef = useRef(sessionId);
	sessionIdRef.current = sessionId;

	const src = pluginPageSrc(plugin, page, projectCwd);

	const ensureBootstrap = useCallback((): Promise<ClientBootstrap | null> => {
		if (client === null) return Promise.resolve(null);
		if (bootstrapRef.current === null) {
			bootstrapRef.current = client.bootstrap().catch(() => null);
		}
		return bootstrapRef.current;
	}, [client]);

	useEffect(() => {
		if (client === null) return;
		void ensureBootstrap();
	}, [client, ensureBootstrap]);

	const context = useCallback((): PageContext => {
		const settings = getAppSettings();
		const theme =
			typeof document === "undefined"
				? settings.theme
				: (document.documentElement.getAttribute("data-theme") ?? settings.theme);
		return {
			theme,
			language: resolvedLanguage,
			cwd: projectCwd,
			plugin,
		};
	}, [plugin, projectCwd, resolvedLanguage]);

	const callTool = useCallback(
		async (request: PluginToolRequest): Promise<PluginToolOutcome> => {
			if (client === null) return { ok: false, code: "CALL_FAILED", message: "Z Work Studio client unavailable" };
			const explicitSession = sessionIdRef.current;
			const session = explicitSession ?? (await ensureBootstrap())?.selected.sessionId;
			return await runPluginToolCall({
				client,
				plugin,
				request,
				...(session === undefined ? {} : { sessionId: session }),
				wait: requestId => waitReceipt(client, requestId, PAGE_CALL_TIMEOUT_MS),
			});
		},
		[client, ensureBootstrap, plugin],
	);

	useEffect(() => {
		const bridge = new PluginPageBridge({
			origin: window.location.origin,
			target: () => frameRef.current?.contentWindow ?? null,
			plugin,
			page,
			context,
			callTool,
			notify: (level, message) => setNotice({ level, message }),
			resize: height => setFrameHeight(height),
		});
		const listener = (event: MessageEvent): void => {
			bridge.handleMessage(event, frameRef.current?.contentWindow ?? null);
		};
		bridgeRef.current = bridge;
		window.addEventListener("message", listener);
		return () => {
			window.removeEventListener("message", listener);
			if (bridgeRef.current === bridge) bridgeRef.current = null;
			bridge.dispose();
		};
	}, [callTool, context, page, plugin]);

	useEffect(() => {
		return () => {
			disposeApiRef.current?.();
			disposeApiRef.current = null;
		};
	}, [plugin, page, reloadToken]);

	const onFrameLoad = useCallback((): void => {
		disposeApiRef.current?.();
		disposeApiRef.current = null;
		const win = frameRef.current?.contentWindow;
		if (!win) return;
		bridgeRef.current?.resetHandshake();
		try {
			disposeApiRef.current = installPageApi(win);
			setNotice(null);
		} catch {
			setNotice({
				level: "error",
				message: zh
					? "插件页面与 Z Work Studio 不同源，页面桥接无法挂载。"
					: "Plugin page is not same-origin; the bridge cannot attach.",
			});
		}
	}, [zh]);

	const heading = title ?? `${plugin} · ${page}`;
	const noticeIcon =
		notice === null ? "info" : notice.level === "error" ? "alert-c" : notice.level === "warning" ? "alert-c" : "info";
	const frameStyle = useMemo(() => (frameHeight === null ? undefined : { height: `${frameHeight}px` }), [frameHeight]);

	if (src === null) {
		return (
			<div className="plugin-page plugin-page-invalid">
				<div className="plugin-page-head">
					{onBack ? (
						<button type="button" className="icon-btn" aria-label={zh ? "返回" : "Back"} onClick={onBack}>
							<Icon name="arrow-l" extra="sm" />
						</button>
					) : null}
					<span className="plugin-page-title">{heading}</span>
				</div>
				<div className="plugin-page-empty" role="alert">
					{zh ? "插件页面地址无效。" : "Invalid plugin page address."}
				</div>
			</div>
		);
	}

	return (
		<div className="plugin-page" data-plugin-page={`${plugin}/${page}`}>
			<header className="plugin-page-head">
				{onBack ? (
					<button
						type="button"
						className="icon-btn"
						aria-label={zh ? "返回" : "Back"}
						data-tip={zh ? "返回" : "Back"}
						onClick={onBack}
					>
						<Icon name="arrow-l" extra="sm" />
					</button>
				) : null}
				<span className="plugin-page-title" title={heading}>
					{heading}
				</span>
				<span className="plugin-page-plugin mono" title={plugin}>
					{plugin}
				</span>
				<span className="plugin-page-spacer" />
				<button
					type="button"
					className="icon-btn"
					aria-label={zh ? "重新加载插件页面" : "Reload plugin page"}
					data-tip={zh ? "刷新" : "Reload"}
					onClick={() => setReloadToken(value => value + 1)}
				>
					<Icon name="refresh" extra="sm" />
				</button>
			</header>
			{notice === null ? null : (
				<div className={`plugin-page-notice is-${notice.level}`} role="status" aria-live="polite">
					<Icon name={noticeIcon} extra="sm" />
					<span>{notice.message}</span>
					<button
						type="button"
						className="icon-btn small"
						aria-label={zh ? "关闭通知" : "Dismiss notification"}
						onClick={() => setNotice(null)}
					>
						<Icon name="x" extra="xs" />
					</button>
				</div>
			)}
			<iframe
				key={`${src}#${reloadToken}`}
				ref={frameRef}
				className="plugin-page-frame"
				src={src}
				title={heading}
				sandbox="allow-scripts allow-same-origin"
				style={frameStyle}
				onLoad={onFrameLoad}
			/>
		</div>
	);
}

export default PluginPageHost;
