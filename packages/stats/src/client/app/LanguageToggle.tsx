import { Languages } from "lucide-react";
import { setUserLocale, t } from "../i18n";
import { useLocale } from "../i18n/useLocale";

/**
 * Topbar language switch: EN ⇄ 中文. The label shows the language the click
 * will install (the dashboard is already in the other one), and the choice is
 * remembered in localStorage so a reload keeps it over the host's injected
 * locale.
 */
export function LanguageToggle() {
	const locale = useLocale();
	const next = locale === "en" ? "zh-CN" : "en";
	const label = locale === "en" ? "中文" : "EN";

	return (
		<button
			type="button"
			className="btn"
			data-variant="ghost"
			data-locale-toggle={locale}
			onClick={() => setUserLocale(next)}
			aria-label={t("shell.switch-language")}
			title={`${t("shell.language")}: ${label}`}
		>
			<Languages size={15} />
			<span className="topbar-locale-label">{label}</span>
		</button>
	);
}
