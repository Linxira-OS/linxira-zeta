"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/hooks/useI18n";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function shortenPath(path: string): string {
	return path
		.replace(/^\/(?:Users|home)\/[^/]+/, "~")
		.replace(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+/, "~");
}

function resourceSummary(pkg: PluginPackageInfo, t: (key: string) => string): string {
	if (pkg.disabled) return t("plugins.status.disabled");
	const parts: Array<string> = [];
	if (pkg.counts.extensions) parts.push(`${pkg.counts.extensions} ${t("plugins.unit.extensions")}`);
	if (pkg.counts.skills) parts.push(`${pkg.counts.skills} ${t("plugins.unit.skills")}`);
	if (pkg.counts.prompts) parts.push(`${pkg.counts.prompts} ${t("plugins.unit.prompts")}`);
	if (pkg.counts.themes) parts.push(`${pkg.counts.themes} ${t("plugins.unit.themes")}`);
	return parts.length ? parts.join(" · ") : t("plugins.no-resources");
}

/** Git hosts whose bare `host/owner/repo` shorthand we can rewrite. */
const KNOWN_GIT_HOSTS = [
	"github.com",
	"gitlab.com",
	"bitbucket.org",
	"codeberg.org",
	"git.sr.ht",
];

/**
 * Normalize a pasted plugin source into a spec the extension loader resolves.
 *
 * The backend records the string verbatim (`POST /api/plugins` only appends it
 * to `settings.extensions`); resolution happens later through `parseGitUrl`,
 * which rejects a bare `github.com/owner/repo` — it needs a `git:` prefix, a
 * `://` scheme, or scp-like `git@host:owner/repo`. Without this rewrite the
 * entry is stored and then silently fails to resolve.
 */
function normalizePluginSource(raw: string): string {
	const source = raw.trim();
	if (!source) return source;

	// Absolute filesystem paths (POSIX, Windows drive, relative) — untouched.
	if (source.startsWith("/") || source.startsWith("./") || /^[A-Za-z]:[\\/]/.test(source)) {
		return source;
	}
	// scp-like SSH (git@host:owner/repo) — already understood by git.
	if (/^git@[^:]+:.+/.test(source)) return source;
	// Qualified specs: npm:, git:, https:, ssh:, and namespaced shorthand
	// (github:owner/repo) are all handled upstream — pass through.
	if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;

	// Bare `host/owner/repo` shorthand → full clone URL.
	const lower = source.toLowerCase();
	const host = KNOWN_GIT_HOSTS.find((candidate) => lower.startsWith(`${candidate}/`));
	if (!host) return source;
	const rest = source.slice(host.length).replace(/^\/+/, "").replace(/\.git$/i, "");
	return rest.includes("/") ? `https://${host}/${rest}.git` : source;
}

const STATUS_COLOR: Record<PluginPackageInfo["status"], string> = {
	loaded: "var(--accent)",
	installed: "#f59e0b",
	disabled: "var(--text-dim)",
	missing: "#ef4444",
};

interface PluginsManagerProps {
	cwd: string;
	sessionId?: string | null;
	onReloaded?: () => void;
	onOpenAdvanced?: () => void;
}

/**
 * Compact always-available plugin manager hosted inside the right tool dock.
 * Lists packages from GET /api/plugins with inline enable/disable/update/remove;
 * quick-add covers npm:/git/absolute-path sources. The full install wizard
 * (PluginsConfig modal) stays reachable via the advanced entry.
 */
export function PluginsManager({ cwd, sessionId, onReloaded, onOpenAdvanced }: PluginsManagerProps) {
	const { t } = useI18n();
	const [data, setData] = useState<PluginsResponse | null>(null);
	const [busySource, setBusySource] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [sourceInput, setSourceInput] = useState("");
	const [scope, setScope] = useState<PluginScope>("global");

	const load = useCallback(async () => {
		try {
			const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
			setData(body as PluginsResponse);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const act = useCallback(
		async (action: PluginAction, source?: string) => {
			const target = source ?? normalizePluginSource(sourceInput);
			if (!target) return;
			setBusySource(target);
			setError(null);
			setMessage(null);
			try {
				const res = await fetch("/api/plugins", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action, source: target, scope, cwd }),
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
				setData(body as PluginsResponse);
				if ((action === "install" || action === "update") && sessionId) {
					try {
						await sendAgentCommand(sessionId, { type: "reload" });
						onReloaded?.();
					} catch {
						// No live session to reload into; next launch picks it up.
					}
					setMessage(t("plugins.toast.installed"));
				} else if (action === "remove") {
					setMessage(t("plugins.toast.removed"));
				}
				if (!source) setSourceInput("");
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setBusySource(null);
			}
		},
		[cwd, scope, sessionId, sourceInput, onReloaded, t],
	);

	const packages = data?.packages ?? [];

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
			{/* Quick add row */}
			<div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
				<input
					value={sourceInput}
					onChange={(event) => setSourceInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && sourceInput.trim()) void act("install");
					}}
					placeholder={t("plugins.install.placeholder")}
					title={t("plugins.install.placeholder")}
					style={{
						flex: 1,
						minWidth: 0,
						height: 26,
						padding: "0 8px",
						fontSize: 12,
						color: "var(--text)",
						background: "var(--bg-subtle)",
						border: "1px solid var(--border)",
						borderRadius: 6,
						outline: "none",
					}}
				/>
				<select
					value={scope}
					onChange={(event) => setScope(event.target.value === "project" ? "project" : "global")}
					style={{
						height: 26,
						fontSize: 11.5,
						color: "var(--text)",
						background: "var(--bg-subtle)",
						border: "1px solid var(--border)",
						borderRadius: 6,
					}}
				>
					<option value="global">{t("plugins.scope.global")}</option>
					<option value="project">{t("plugins.scope.project")}</option>
				</select>
				<button
					type="button"
					onClick={() => void act("install")}
					disabled={!sourceInput.trim() || busySource !== null}
					style={{
						height: 26,
						padding: "0 10px",
						fontSize: 12,
						cursor: "pointer",
						color: "var(--accent-foreground)",
						background: "var(--accent)",
						border: "none",
						borderRadius: 6,
					}}
				>
					{t("plugins.action.add")}
				</button>
				{onOpenAdvanced && (
					<button
						type="button"
						onClick={onOpenAdvanced}
						title={t("plugins.open-advanced")}
						style={{
							height: 26,
							padding: "0 8px",
							fontSize: 12,
							cursor: "pointer",
							color: "var(--text-muted)",
							background: "transparent",
							border: "1px solid var(--border)",
							borderRadius: 6,
						}}
					>
						⋯
					</button>
				)}
			</div>

			{(message || error) && (
				<div
					style={{
						padding: "5px 10px",
						fontSize: 11.5,
						borderBottom: "1px solid var(--border)",
						color: error ? "var(--status-error-foreground)" : "var(--status-success-foreground)",
					}}
				>
					{error ?? message}
				</div>
			)}

			{/* Package list */}
			<div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
				{packages.length === 0 ? (
					<div style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>
						{data ? t("plugins.empty") : t("plugins.loading")}
					</div>
				) : (
					packages.map((pkg) => (
						<div
							key={`${pkg.scope}\u0000${pkg.source}`}
							style={{ padding: "9px 10px", borderBottom: "1px solid var(--border)" }}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 7 }}>
								<span
									aria-hidden
									style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: STATUS_COLOR[pkg.status] }}
								/>
								<span
									title={pkg.source}
									style={{
										flex: 1,
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										fontSize: 12.5,
										fontWeight: 600,
										color: pkg.disabled ? "var(--text-dim)" : "var(--text)",
									}}
								>
									{pkg.packageName ?? shortenPath(pkg.source)}
								</span>
								<span style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>
									{pkg.scope === "project" ? t("plugins.scope.project") : t("plugins.scope.global")}
								</span>
							</div>

							<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
								<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--text-muted)" }}>
									{resourceSummary(pkg, t)}
									{pkg.version ? ` · v${pkg.version}` : ""}
								</span>
								{pkg.disabled ? (
									<SmallButton onClick={() => void act("enable", pkg.source)} disabled={busySource !== null}>
										{t("plugins.action.enable")}
									</SmallButton>
								) : (
									<SmallButton onClick={() => void act("disable", pkg.source)} disabled={busySource !== null}>
										{t("plugins.action.disable")}
									</SmallButton>
								)}
								<SmallButton onClick={() => void act("update", pkg.source)} disabled={busySource !== null}>
									{t("plugins.action.update")}
								</SmallButton>
								<SmallButton danger onClick={() => void act("remove", pkg.source)} disabled={busySource !== null}>
									{t("plugins.action.remove")}
								</SmallButton>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}

function SmallButton({
	onClick,
	children,
	danger,
	disabled,
}: {
	onClick: () => void;
	children: ReactNode;
	danger?: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			style={{
				height: 21,
				padding: "0 7px",
				fontSize: 10.5,
				lineHeight: 1,
				cursor: disabled ? "default" : "pointer",
				flexShrink: 0,
				color: danger ? "#ef4444" : "var(--text-muted)",
				background: "transparent",
				border: "1px solid var(--border)",
				borderRadius: 5,
				opacity: disabled ? 0.55 : 1,
			}}
		>
			{children}
		</button>
	);
}
