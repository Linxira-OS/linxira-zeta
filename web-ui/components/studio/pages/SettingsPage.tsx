"use client";

/**
 * SettingsPage — the settings surface inside the Studio frame.
 *
 * `SettingsWindow` already owns the gateway's typed settings contract
 * (`GET/PUT /api/settings`, `/api/web-config`), including the `providerLimits`,
 * `modelRoles` and `multiselect` entry kinds. Re-drawing that form in Studio
 * markup would drift from the schema, so the page hosts it and adds only the
 * Studio page chrome plus the theme/language pickers (one language store).
 *
 * Studio's host-native panes (`settings/NativePreferencesPane`,
 * `DesktopUpdateRecovery`, `BackgroundSettingsPane`, `AvatarCropDialog`,
 * `PredictionSettingsPane`) are absent: they write Electron/wry preferences
 * and prediction settings, which no gateway route exposes.
 */

import { useState } from "react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/ThemePicker";
import { ModelsConfig } from "@/components/ModelsConfig";
import { useI18n } from "@/components/studio/i18n";
import { SettingsWindow } from "@/components/settings/SettingsWindow";
import { PageFrame } from "./page-frame";

export function SettingsPage({ cwd, title }: { cwd: string | null; title?: string }) {
	const { t } = useI18n();
	const [modelsOpen, setModelsOpen] = useState(false);

	return (
		<PageFrame
			title={title ?? t("studio.route.settings")}
			actions={
				<>
					<ThemePicker />
					<LanguagePicker />
				</>
			}
		>
			<SettingsWindow
				open
				onClose={() => undefined}
				onOpenModelsConfig={() => setModelsOpen(true)}
				cwd={cwd}
			/>
			{modelsOpen ? <ModelsConfig onClose={() => setModelsOpen(false)} /> : null}
		</PageFrame>
	);
}
