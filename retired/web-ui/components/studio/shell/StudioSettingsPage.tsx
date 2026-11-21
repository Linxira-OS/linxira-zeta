"use client";

/**
 * StudioSettingsPage — the settings surface, hosted inside the shell.
 *
 * `SettingsWindow` already owns the whole settings contract: it renders the
 * gateway's typed entry list (`GET /api/settings`), writes one path at a time
 * (`PUT /api/settings`), and reads/writes `web.yml` (`/api/web-config`).
 * Re-implementing that form would either drop entry types (`providerLimits`,
 * `modelRoles`, `multiselect`) or drift from the schema, so the page hosts it
 * instead of re-drawing it.
 *
 * It runs inside the shell's single `I18nProvider` — no second locale state.
 */

import { useI18n } from "@/hooks/useI18n";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/ThemePicker";
import { SettingsWindow } from "@/components/settings/SettingsWindow";
import { StudioPage } from "./StudioPageHost";

export function StudioSettingsPage({
	cwd,
	onNavigateHome,
}: {
	cwd: string | null;
	onNavigateHome: () => void;
}) {
	const { t } = useI18n();
	return (
		<StudioPage
			title={t("studio.route.settings")}
			actions={
				<>
					<ThemePicker />
					<LanguagePicker />
				</>
			}
		>
			<SettingsWindow open onClose={onNavigateHome} onOpenModelsConfig={onNavigateHome} cwd={cwd} />
		</StudioPage>
	);
}
