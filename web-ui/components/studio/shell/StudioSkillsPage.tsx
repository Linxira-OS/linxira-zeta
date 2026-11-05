"use client";

/**
 * StudioSkillsPage — installed skills for a workspace.
 *
 * `GET /api/skills?cwd=` lists what is installed for that workspace (project +
 * global scope), `PATCH /api/skills` flips `disableModelInvocation`, and
 * `POST /api/skills/check` asks upstream for updates. Installing and updating
 * run the third-party skills CLI through the gateway; nothing here shells out.
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { StudioPage } from "./StudioPageHost";
import type { SkillInfo, SkillUpdateResult, SkillsResponse } from "@/lib/api-types";

function scopeOf(skill: SkillInfo): string {
	return skill.install?.scope ?? skill.sourceInfo?.scope ?? "unknown";
}

export function StudioSkillsPage({ cwd, title }: { cwd: string | null; title: string }) {
	const { t } = useI18n();
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [updates, setUpdates] = useState<Record<string, SkillUpdateResult>>({});
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!cwd) return;
		try {
			const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `skills: HTTP ${res.status}`);
			}
			const body = (await res.json()) as SkillsResponse;
			setSkills(body.skills ?? []);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const toggle = useCallback(
		async (skill: SkillInfo) => {
			setBusy(skill.filePath);
			try {
				const res = await fetch("/api/skills", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						filePath: skill.filePath,
						disableModelInvocation: !skill.disableModelInvocation,
					}),
				});
				if (!res.ok) throw new Error(`skills: HTTP ${res.status}`);
				await load();
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setBusy(null);
			}
		},
		[load],
	);

	const check = useCallback(async () => {
		if (!cwd) return;
		setBusy("check");
		try {
			const res = await fetch("/api/skills/check", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd }),
			});
			if (!res.ok) throw new Error(`skills check: HTTP ${res.status}`);
			const body = (await res.json()) as { updates?: SkillUpdateResult[] };
			setUpdates(Object.fromEntries((body.updates ?? []).map(entry => [entry.package, entry])));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(null);
		}
	}, [cwd]);

	const visible = skills.filter(skill => {
		const needle = query.trim().toLowerCase();
		if (!needle) return true;
		return skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle);
	});

	if (!cwd) {
		return (
			<StudioPage title={title}>
				<div className="empty">
					<p className="muted">{t("studio.skills.needsWorkspace")}</p>
				</div>
			</StudioPage>
		);
	}

	return (
		<StudioPage
			title={title}
			subtitle={cwd}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={() => void load()}>
						{t("studio.action.refresh")}
					</button>
					<button type="button" className="btn btn-ghost" onClick={() => void check()} disabled={busy !== null}>
						{t("studio.skills.checkUpdates")}
					</button>
				</>
			}
		>
			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}
			<input
				className="input"
				type="search"
				value={query}
				placeholder={t("studio.skills.filter")}
				onChange={event => setQuery(event.target.value)}
			/>
			{visible.length === 0 ? (
				<p className="muted small">{t("studio.skills.empty")}</p>
			) : (
				<ul className="card-list">
					{visible.map(skill => {
						const update = skill.install ? updates[skill.install.package] : undefined;
						return (
							<li key={skill.filePath} className="card skill-card">
								<div className="skill-head">
									<h3 className="skill-name">{skill.name}</h3>
									<span className="chip">{scopeOf(skill)}</span>
									{skill.disableModelInvocation ? (
										<span className="chip chip-warn">{t("studio.skills.manualOnly")}</span>
									) : null}
									{update?.state === "update-available" ? (
										<span className="chip chip-warn">{t("studio.skills.updateAvailable")}</span>
									) : null}
								</div>
								<p className="skill-desc muted">{skill.description}</p>
								<div className="skill-actions">
									<button
										type="button"
										className="btn btn-ghost btn-xs"
										onClick={() => void toggle(skill)}
										disabled={busy !== null}
									>
										{skill.disableModelInvocation ? t("studio.skills.allowModel") : t("studio.skills.disableModel")}
									</button>
									<code className="skill-path muted small" title={skill.filePath}>
										{skill.filePath}
									</code>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</StudioPage>
	);
}
