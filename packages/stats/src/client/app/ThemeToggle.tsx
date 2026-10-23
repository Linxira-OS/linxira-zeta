import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { type ThemePreference, useThemePreference } from "../useSystemTheme";
import { t } from "../i18n";
import { useLocale } from "../i18n/useLocale";

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
	system: "light",
	light: "dark",
	dark: "system",
};

const PREFERENCE_LABEL_KEY = {
	system: "shell.system-theme",
	light: "shell.light-theme",
	dark: "shell.dark-theme",
} as const;

const PREFERENCE_ICON: Record<ThemePreference, LucideIcon> = {
	system: Monitor,
	light: Sun,
	dark: Moon,
};

/** Cycles system → light → dark. */
export function ThemeToggle() {
	useLocale();
	const { preference, setPreference } = useThemePreference();
	const Icon = PREFERENCE_ICON[preference];
	const label = t(PREFERENCE_LABEL_KEY[preference]);

	return (
		<button
			type="button"
			className="btn"
			data-variant="ghost"
			data-icon="true"
			onClick={() => setPreference(NEXT_PREFERENCE[preference])}
			aria-label={`${label} (click to switch)`}
			title={`${label} — click to switch`}
		>
			<Icon size={15} />
		</button>
	);
}
