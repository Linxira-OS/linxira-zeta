"use client";

/**
 * SkillsPage — installed skills and plugins for the selected workspace.
 *
 * Gateway routes (all live, no CLI in the browser):
 *   `GET   /api/skills?cwd=`          installed skills + diagnostics
 *   `PATCH /api/skills`               toggle `disableModelInvocation`
 *   `POST  /api/skills/search`        registry search
 *   `POST  /api/skills/install`       install a package into a scope
 *   `POST  /api/skills/check`         upstream update availability
 *   `POST  /api/skills/update`        run the package update
 *   `GET   /api/plugins?cwd=`         plugin packages and their resources
 *
 * Studio's MCP panes (runtime readiness, OAuth, server tests) and the IDA
 * resource panes are absent: Zeta's web gateway publishes no MCP surface, and
 * the runtime-catalog commands they call have no route.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/studio/i18n";
import { hostErrorMessage } from "@/components/studio/primitives/hostError";
import { Icon } from "@/components/studio/primitives/icons";
import type {
	PluginPackageInfo,
	PluginsResponse,
	SkillInfo,
	SkillSearchResult,
	SkillUpdateResult,
	SkillsResponse,
} from "@/lib/api-types";
import { PageBanner, PageEmpty, PageFrame } from "./page-frame";

type Tab = "skills" | "plugins";

async function readJson<T>(response: Response, what: string): Promise<T> {
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `${what}: HTTP ${response.status}`);
	}
	return (await response.json()) as T;
}

export function SkillsPage({ cwd, title }: { cwd: string | null; title?: string }) {
	const { t } = useI18n();
	const [tab, setTab] = useState<Tab>("skills");
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [packages, setPackages] = useState<PluginPackageInfo[]>([]);
	const [updates, setUpdates] = useState<Record<string, SkillUpdateResult>>({});
	const [search, setSearch] = useState("");
	const [results, setResults] = useState<SkillSearchResult[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!cwd) return;
		try {
			const query = `?cwd=${encodeURIComponent(cwd)}`;
			const [skillsBody, pluginsBody] = await Promise.all([
				fetch(`/api/skills${query}`, { cache: "no-store" }).then(res => readJson<SkillsResponse>(res, "skills")),
				fetch(`/api/plugins${query}`, { cache: "no-store" }).then(res => readJson<PluginsResponse>(res, "plugins")),
			]);
			setSkills(skillsBody.skills ?? []);
			setPackages(pluginsBody.packages ?? []);
			setError(null);
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.skills.loadError")));
		}
	}, [cwd, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const toggle = useCallback(
		async (skill: SkillInfo) => {
			setBusy(skill.filePath);
			try {
				await fetch("/api/skills", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						filePath: skill.filePath,
						disableModelInvocation: !skill.disableModelInvocation,
					}),
				}).then(res => readJson<unknown>(res, "skills patch"));
				await load();
			} catch (cause) {
				setError(hostErrorMessage(cause, t("studio.skills.actionError")));
			} finally {
				setBusy(null);
			}
		},
		[load, t],
	);

	const check = useCallback(async () => {
		if (!cwd) return;
		setBusy("check");
		try {
			// The gateway answers `{ updates }` (one row per installable skill).
			const body = await fetch("/api/skills/check", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd }),
			}).then(res => readJson<{ updates?: SkillUpdateResult[] }>(res, "skills check"));
			const map: Record<string, SkillUpdateResult> = {};
			for (const result of body.updates ?? []) map[`${result.package}@${result.scope}`] = result;
			setUpdates(map);
			setNotice(t("studio.skills.checkDone"));
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.skills.actionError")));
		} finally {
			setBusy(null);
		}
	}, [cwd, t]);

	const update = useCallback(
		async (pkg: string, scope: string) => {
			if (!cwd) return;
			setBusy(pkg);
			try {
				await fetch("/api/skills/update", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cwd, package: pkg, scope }),
				}).then(res => readJson<unknown>(res, "skills update"));
				setNotice(t("studio.skills.updated", { package: pkg }));
				await load();
			} catch (cause) {
				setError(hostErrorMessage(cause, t("studio.skills.actionError")));
			} finally {
				setBusy(null);
			}
		},
		[cwd, load, t],
	);

	const runSearch = useCallback(async () => {
		const query = search.trim();
		if (!query) return;
		setBusy("search");
		try {
			const body = await fetch("/api/skills/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, limit: 15 }),
			}).then(res => readJson<{ results?: SkillSearchResult[] }>(res, "skills search"));
			setResults(body.results ?? []);
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.skills.actionError")));
		} finally {
			setBusy(null);
		}
	}, [search, t]);

	const install = useCallback(
		async (pkg: string, scope: "global" | "project") => {
			if (!cwd) return;
			setBusy(pkg);
			try {
				await fetch("/api/skills/install", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ package: pkg, scope, cwd }),
				}).then(res => readJson<unknown>(res, "skills install"));
				setNotice(t("studio.skills.installed", { package: pkg }));
				setResults([]);
				await load();
			} catch (cause) {
				setError(hostErrorMessage(cause, t("studio.skills.actionError")));
			} finally {
				setBusy(null);
			}
		},
		[cwd, load, t],
	);

	const installed = useMemo(
		() => skills.filter(skill => skill.install !== undefined).length,
		[skills],
	);

	if (!cwd) {
		return (
			<PageFrame title={title ?? t("studio.route.skills")}>
				<PageEmpty>{t("studio.empty.noProject")}</PageEmpty>
			</PageFrame>
		);
	}

	return (
		<PageFrame
			title={title ?? t("studio.route.skills")}
			subtitle={cwd}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={() => void load()}>
						{t("studio.action.refresh")}
					</button>
					<button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void check()}>
						{t("studio.skills.check")}
					</button>
				</>
			}
		>
			{error ? <PageBanner className="banner red">{error}</PageBanner> : null}
			{notice ? <PageBanner className="banner amber">{notice}</PageBanner> : null}

			<div className="cap-layout">
				<div className="cap-main">
					<div className="set-toolbar">
						<button
							type="button"
							className={`btn small ${tab === "skills" ? "primary" : "ghost"}`}
							onClick={() => setTab("skills")}
						>
							{t("studio.skills.tabSkills")} · {skills.length}
						</button>
						<button
							type="button"
							className={`btn small ${tab === "plugins" ? "primary" : "ghost"}`}
							onClick={() => setTab("plugins")}
						>
							{t("studio.skills.tabPlugins")} · {packages.length}
						</button>
					</div>

					{tab === "skills" ? (
						skills.length === 0 ? (
							<PageEmpty>{t("studio.skills.empty")}</PageEmpty>
						) : (
							<ul className="cap-skills">
								{skills.map(skill => {
									const updateKey = skill.install ? `${skill.install.package}@${skill.install.scope}` : null;
									const updateInfo = updateKey ? updates[updateKey] : undefined;
									return (
										<li key={skill.filePath} className="cap-item">
											<div className="cap-item-main">
												<div className="cap-item-name-row">
													<span className="cap-item-name">{skill.name}</span>
													<span className="cap-source">
														{skill.install?.scope ?? skill.sourceInfo?.scope ?? "global"}
													</span>
													{skill.disableModelInvocation ? (
														<span className="chip gray xs">{t("studio.skills.manualOnly")}</span>
													) : null}
													{updateInfo?.state === "update-available" ? (
														<span className="chip amber xs">{t("studio.skills.updateAvailable")}</span>
													) : null}
												</div>
												<p className="cap-item-desc">{skill.description}</p>
												<p className="cap-item-meta mono ellipsis">{skill.baseDir}</p>
											</div>
											<div className="cap-item-actions">
												<label className="set-row">
													<input
														type="checkbox"
														checked={!skill.disableModelInvocation}
														disabled={busy !== null}
														onChange={() => void toggle(skill)}
													/>
													<span className="small">{t("studio.skills.modelInvocable")}</span>
												</label>
												{updateInfo?.state === "update-available" && skill.install ? (
													<button
														type="button"
														className="btn small outline"
														disabled={busy !== null}
														onClick={() => void update(skill.install!.package, skill.install!.scope)}
													>
														{t("studio.skills.update")}
													</button>
												) : null}
											</div>
										</li>
									);
								})}
							</ul>
						)
					) : packages.length === 0 ? (
						<PageEmpty>{t("studio.skills.noPlugins")}</PageEmpty>
					) : (
						<ul className="cap-skills">
							{packages.map(pkg => (
								<li key={`${pkg.scope}:${pkg.source}`} className="cap-item">
									<div className="cap-item-main">
										<div className="cap-item-name-row">
											<span className="cap-item-name">{pkg.packageName ?? pkg.source}</span>
											<span className="cap-source">{pkg.scope}</span>
											{pkg.version ? <span className="chip gray xs">{pkg.version}</span> : null}
											{pkg.disabled ? <span className="chip gray xs">{t("studio.skills.disabled")}</span> : null}
										</div>
										<p className="cap-item-meta">
											{t("studio.skills.pluginCounts", {
												extensions: pkg.counts.extensions,
												skills: pkg.counts.skills,
												prompts: pkg.counts.prompts,
												themes: pkg.counts.themes,
											})}
										</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				<aside className="cap-side">
					<div className="cap-summary">
						<span className="cap-sum-stat">
							<b>{skills.length}</b> {t("studio.skills.tabSkills")}
						</span>
						<span className="cap-sum-stat">
							<b>{installed}</b> {t("studio.skills.managed")}
						</span>
						<span className="cap-sum-stat">
							<b>{packages.length}</b> {t("studio.skills.tabPlugins")}
						</span>
					</div>

					<section className="cap-item">
						<div className="cap-item-main">
							<div className="cap-item-name-row">
								<span className="cap-item-name">{t("studio.skills.installTitle")}</span>
							</div>
							<div className="set-toolbar">
								<input
									className="input"
									type="search"
									value={search}
									placeholder={t("studio.skills.searchPlaceholder")}
									onChange={event => setSearch(event.target.value)}
									onKeyDown={event => {
										if (event.key === "Enter") void runSearch();
									}}
								/>
								<button type="button" className="icon-btn small" aria-label={t("studio.skills.search")} onClick={() => void runSearch()}>
									<Icon name="search" extra="sm" />
								</button>
							</div>
							{results.length === 0 ? (
								<PageEmpty>{t("studio.skills.searchEmpty")}</PageEmpty>
							) : (
								<ul className="cap-slash-list">
									{results.map(result => (
										<li key={result.package} className="cap-slash-row">
											<span className="cap-slash-name">{result.package}</span>
											<span className="cap-slash-desc">{result.installs}</span>
											<button
												type="button"
												className="btn small outline"
												disabled={busy !== null}
												onClick={() => void install(result.package, "project")}
											>
												{t("studio.skills.install")}
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
					</section>
				</aside>
			</div>
		</PageFrame>
	);
}
