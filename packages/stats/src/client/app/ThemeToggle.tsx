import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { type ThemePreference, useThemePreference } from "../useSystemTheme";
import { t } from "../i18n";

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
	system: "light",
	light: "dark",
	dark: "system",
};

const PREFERENCE_ICON: Record<ThemePreference, LucideIcon> = {
	system: Monitor,
	light: Sun,
	dark: Moon,
};

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
	system: t("shell.system-theme"),
	light: t("shell.light-theme"),
	dark: t("shell.dark-theme"),
};

/** Cycles system → light → dark. */
export function ThemeToggle() {
	const { preference, setPreference } = useThemePreference();
	const Icon = PREFERENCE_ICON[preference];

	return (
		<button
			type="button"
			className="btn"
			data-variant="ghost"
			data-icon="true"
			onClick={() => setPreference(NEXT_PREFERENCE[preference])}
			aria-label={`${PREFERENCE_LABEL[preference]} (click to switch)`}
			title={`${PREFERENCE_LABEL[preference]} — click to switch`}
		>
			<Icon size={15} />
		</button>
	);
}
