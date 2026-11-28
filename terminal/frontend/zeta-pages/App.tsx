/**
 * Standalone Team/Rooms/IM entry.
 *
 * Routes: `/` and `/team` open the Team workspace; `/rooms` opens local rooms;
 * `/im` opens the Team workspace's IM chat tab. The same route is recognized
 * under the `/zeta-pages` mount and the ADR-0101 `/pages` alias.
 * A `#zeta-pair=` fragment is consumed by `main.tsx` before this mounts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { hostErrorMessage } from "./hostError";
import { useI18n } from "./i18n";
import { pagePathFor, pageRouteFromPath, type PageRoute } from "./pageRoutes";
import { RoomsPage } from "./RoomsPage";
import { TeamWorkspacePage } from "./TeamWorkspacePage";
import { installStepUpPrompt, StudioHttpError, type StudioWebClient } from "./client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./app.css";

type Phase = "connecting" | "ready" | "pair" | "error";

interface StepUpRequest {
	readonly resolve: (code: string | null) => void;
}

export function App({ client, pairCode }: { client: StudioWebClient; pairCode: string | null }) {
	const { t, locale, setLocale } = useI18n();
	const [phase, setPhase] = useState<Phase>("connecting");
	const [error, setError] = useState("");
	const [route, setRoute] = useState<PageRoute>(() => pageRouteFromPath(window.location.pathname));
	const [pairDraft, setPairDraft] = useState("");
	const [pairBusy, setPairBusy] = useState(false);
	const [stepUp, setStepUp] = useState<StepUpRequest | null>(null);
	const [stepUpDraft, setStepUpDraft] = useState("");

	useEffect(() => {
		const onPopState = () => setRoute(pageRouteFromPath(window.location.pathname));
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		return installStepUpPrompt(() => {
			const { promise, resolve } = Promise.withResolvers<string | null>();
			setStepUpDraft("");
			setStepUp({ resolve });
			return promise;
		});
	}, []);

	useEffect(() => {
		return client.onAuthLost(() => {
			// Revoked device or expired session: drop the old cookie-bound
			// transport before showing pairing, so a new code cannot reuse an
			// event socket attached to the previous identity.
			void client.reset();
			setPhase("pair");
			setError("");
		});
	}, [client]);

	useEffect(() => {
		if (phase !== "ready") return;
		// Rooms and IM can sit without a Studio query; a low-frequency bootstrap
		// notices a device revoke even when the user is only reading a transcript.
		const timer = setInterval(() => void client.bootstrap().catch(() => {}), 15_000);
		return () => clearInterval(timer);
	}, [client, phase]);

	const boot = useCallback(
		async (code?: string) => {
			setPhase("connecting");
			setError("");
			let pairingError: unknown;
			if (code !== undefined) {
				try {
					await client.pair(code);
				} catch (cause) {
					// A used/expired code is expected (60 s, single use). An already
					// valid cookie must still boot; bootstrap below decides.
					pairingError = cause;
				}
			}
			try {
				await client.bootstrap();
				setPhase("ready");
			} catch (cause) {
				if (cause instanceof StudioHttpError && (cause.status === 401 || cause.status === 403)) {
					setPhase("pair");
					setError(pairingError !== undefined ? hostErrorMessage(pairingError, t("teamPages.pair.failed")) : "");
					return;
				}
				setPhase("error");
				setError(hostErrorMessage(cause, t("teamPages.error.detail")));
			}
		},
		[client, t],
	);

	useEffect(() => {
		void boot(pairCode ?? undefined);
	}, [boot, pairCode]);

	const navigate = (next: PageRoute) => {
		const path = pagePathFor(next, window.location.pathname);
		if (window.location.pathname !== path) {
			window.history.pushState(null, "", path);
		}
		setRoute(next);
	};

	const submitPair = async () => {
		const code = pairDraft.trim();
		if (code === "") return;
		setPairBusy(true);
		try {
			await boot(code);
			setPairDraft("");
		} finally {
			setPairBusy(false);
		}
	};

	const closeStepUp = (code: string | null) => {
		const pending = stepUp;
		setStepUp(null);
		setStepUpDraft("");
		pending?.resolve(code);
	};

	const body = useMemo(() => {
		if (phase === "connecting") {
			return <div className="zp-center muted">{t("teamPages.loading")}</div>;
		}
		if (phase === "error") {
			return (
				<div className="zp-center">
					<div className="zp-card">
						<h1>{t("teamPages.error.title")}</h1>
						<p className="zp-error">{error}</p>
						<div className="zp-actions">
							<button type="button" className="btn primary" onClick={() => void boot()}>
								{t("teamPages.error.retry")}
							</button>
						</div>
					</div>
				</div>
			);
		}
		if (phase === "pair") {
			return (
				<div className="zp-center">
					<div className="zp-card">
						<h1>{t("teamPages.pair.title")}</h1>
						<p>{t("teamPages.pair.detail")}</p>
						{error ? <p className="zp-error">{error}</p> : null}
						<label className="zp-field">
							<span>{t("teamPages.pair.code")}</span>
							<input
								className="zp-input"
								value={pairDraft}
								autoFocus
								spellCheck={false}
								placeholder={t("teamPages.pair.placeholder")}
								onChange={event => setPairDraft(event.target.value)}
								onKeyDown={event => {
									if (event.key === "Enter") void submitPair();
								}}
							/>
						</label>
						<div className="zp-actions">
							<button type="button" className="btn primary" onClick={() => void submitPair()} disabled={pairBusy}>
								{t("teamPages.pair.submit")}
							</button>
						</div>
					</div>
				</div>
			);
		}
		if (route === "rooms") return <RoomsPage client={client} />;
		if (route === "im") return <TeamWorkspacePage key="im" client={client} initialTab="im" />;
		return <TeamWorkspacePage key="team" client={client} />;
	}, [client, error, pairBusy, pairDraft, phase, route, t]);

	return (
		<div className="zeta-pages-root">
			<header className="zp-bar">
				<span className="zp-brand">{t("teamPages.title")}</span>
				<nav className="zp-nav" aria-label={t("teamPages.nav.label")}>
					<button
						type="button"
						className={route === "team" ? "active" : undefined}
						aria-current={route === "team" ? "page" : undefined}
						onClick={() => navigate("team")}
					>
						{t("teamPages.nav.team")}
					</button>
					<button
						type="button"
						className={route === "rooms" ? "active" : undefined}
						aria-current={route === "rooms" ? "page" : undefined}
						onClick={() => navigate("rooms")}
					>
						{t("teamPages.nav.rooms")}
					</button>
					<button
						type="button"
						className={route === "im" ? "active" : undefined}
						aria-current={route === "im" ? "page" : undefined}
						onClick={() => navigate("im")}
					>
						{t("teamWorkspace.im")}
					</button>
				</nav>
				<span className="zp-spacer" />
				<select
					className="zp-locale"
					aria-label={t("teamPages.nav.language")}
					value={locale}
					onChange={event => setLocale(event.target.value === "zh-CN" ? "zh-CN" : "en")}
				>
					<option value="en">English</option>
					<option value="zh-CN">中文</option>
				</select>
			</header>
			<main className="zp-main page-body">{body}</main>
			{stepUp ? (
				<div className="zp-modal-backdrop" role="dialog" aria-modal="true">
					<div className="zp-card">
						<h1>{t("teamPages.stepUp.title")}</h1>
						<p>{t("teamPages.stepUp.detail")}</p>
						<label className="zp-field">
							<span>{t("teamPages.stepUp.code")}</span>
							<input
								className="zp-input"
								value={stepUpDraft}
								autoFocus
								spellCheck={false}
								placeholder={t("teamPages.stepUp.placeholder")}
								onChange={event => setStepUpDraft(event.target.value)}
								onKeyDown={event => {
									if (event.key === "Enter") closeStepUp(stepUpDraft);
								}}
							/>
						</label>
						<div className="zp-actions">
							<button type="button" className="btn outline" onClick={() => closeStepUp(null)}>
								{t("teamPages.stepUp.cancel")}
							</button>
							<button type="button" className="btn primary" onClick={() => closeStepUp(stepUpDraft)}>
								{t("teamPages.stepUp.submit")}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
