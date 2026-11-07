import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { useI18n } from "../i18n";
import "./rawConfig.css";

type Scope = "global" | "project";

interface RawResponse {
	scope: Scope;
	path: string;
	contents: string;
	exists: boolean;
	precedence: readonly string[];
}

interface PutResponse {
	ok?: boolean;
	error?: string;
	path?: string;
	backupPath?: string;
}

/**
 * Raw YAML editor for the two user-owned settings layers.
 *
 * The gateway owns the writer: PUT /api/settings/raw validates with the same
 * YAML parser Settings uses, writes atomically, keeps a `.bak`, and reloads the
 * live layer. This component only displays text and shows the precedence.
 */
export function RawConfigEditor({ cwd }: { cwd?: string | null | undefined }) {
	const { t } = useI18n();
	const [scope, setScope] = useState<Scope>("global");
	const [contents, setContents] = useState("");
	const [original, setOriginal] = useState("");
	const [path, setPath] = useState("");
	const [exists, setExists] = useState(false);
	const [precedence, setPrecedence] = useState<readonly string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const dirty = contents !== original;
	const headers = useMemo<Record<string, string>>(
		() => ({ "content-type": "application/json", ...(cwd ? { "x-zeta-cwd": cwd } : {}) }),
		[cwd],
	);

	const load = useCallback(async (next: Scope) => {
		setBusy(true);
		setError(null);
		setSaved(null);
		try {
			const response = await fetch(`/api/settings/raw?scope=${next}`, { headers });
			const payload = (await response.json()) as RawResponse & { error?: string };
			if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
			setContents(payload.contents);
			setOriginal(payload.contents);
			setPath(payload.path);
			setExists(payload.exists);
			setPrecedence(payload.precedence);
		} catch (cause) {
			setError(t("settings.raw.loadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
			setContents("");
			setOriginal("");
			setPath("");
			setExists(false);
		} finally {
			setBusy(false);
		}
	}, [headers, t]);

	useEffect(() => {
		void load("global");
	}, [load]);

	useEffect(() => {
		const onUnload = (event: BeforeUnloadEvent) => {
			if (!dirty) return;
			event.preventDefault();
		};
		window.addEventListener("beforeunload", onUnload);
		return () => window.removeEventListener("beforeunload", onUnload);
	}, [dirty]);

	const switchScope = (next: Scope) => {
		if (next === scope || busy) return;
		if (dirty && !window.confirm(t("settings.raw.unsaved"))) return;
		setScope(next);
		void load(next);
	};

	const save = async () => {
		if (busy || !dirty) return;
		setBusy(true);
		setError(null);
		setSaved(null);
		try {
			const response = await fetch("/api/settings/raw", {
				method: "PUT",
				headers,
				body: JSON.stringify({ scope, contents }),
			});
			const payload = (await response.json()) as PutResponse;
			if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
			setOriginal(contents);
			setExists(true);
			if (payload.path) setPath(payload.path);
			setSaved(t("settings.raw.saved"));
		} catch (cause) {
			// The gateway rejects invalid YAML before writing anything.
			setError(t("settings.raw.invalid", { error: cause instanceof Error ? cause.message : String(cause) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="raw-config" aria-label={t("settings.raw.title")}>
			<header>
				<div>
					<h2>{t("settings.raw.title")}</h2>
					<p>{t("settings.raw.desc")}</p>
				</div>
				<div className="raw-config-scopes" role="group" aria-label={t("settings.raw.title")}>
					<button type="button" className={scope === "global" ? "active" : ""} onClick={() => switchScope("global")}>{t("settings.raw.scopeGlobal")}</button>
					<button type="button" className={scope === "project" ? "active" : ""} onClick={() => switchScope("project")}>{t("settings.raw.scopeProject")}</button>
				</div>
			</header>
			<code className="raw-config-path">{path || t("settings.raw.unknownPath")}</code>
			<p className="raw-config-precedence">
				{t("settings.raw.precedence")}: {precedence.map((layer) => t(`settings.raw.layer.${layer}`)).join(" > ") || "—"}
			</p>
			<textarea
				className="raw-config-text"
				value={contents}
				onChange={(event) => { setContents(event.target.value); setSaved(null); }}
				spellCheck={false}
				rows={16}
				aria-label={t("settings.raw.title")}
				placeholder={exists ? "" : t("settings.raw.empty")}
			/>
			{error ? <p className="raw-config-error" role="alert">{error}</p> : null}
			{saved ? <p className="raw-config-saved" role="status">{saved}</p> : null}
			<div className="raw-config-actions">
				<button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
					<Icon name="check" extra="sm" />{t("settings.raw.save")}
				</button>
				<button type="button" className="btn outline" disabled={busy || !dirty} onClick={() => { setContents(original); setError(null); setSaved(null); }}>
					{t("settings.raw.reset")}
				</button>
				{dirty ? <span className="raw-config-dirty">{t("settings.raw.dirty")}</span> : null}
			</div>
		</section>
	);
}
