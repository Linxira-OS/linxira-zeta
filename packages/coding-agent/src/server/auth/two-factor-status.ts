import type { ZetaLanguage } from "../../i18n";
import {
	twoFactorStore,
	TwoFactorStoreUnavailableError,
	type TwoFactorStatus,
	type TwoFactorStore,
} from "./two-factor-store";

export type TerminalTwoFactorStatus =
	| { available: true; status: TwoFactorStatus }
	| { available: false; error: "two_factor_unavailable" };

/** Read the active profile only. Remote device grants belong to the serve process. */
export async function readTerminalTwoFactorStatus(
	store: TwoFactorStore = twoFactorStore(),
): Promise<TerminalTwoFactorStatus> {
	try {
		return { available: true, status: await store.status() };
	} catch (error) {
		if (!(error instanceof TwoFactorStoreUnavailableError)) throw error;
		return { available: false, error: "two_factor_unavailable" };
	}
}

export function formatTerminalTwoFactorStatus(result: TerminalTwoFactorStatus, language: ZetaLanguage): string {
	const zh = language === "zh";
	if (!result.available)
		return zh
			? "二次验证：状态不可用\n远程写操作已阻止。请在本机 Work Studio → 设置 → 身份与设备中重置并重新绑定。"
			: "Two-factor authentication: unavailable\nRemote mutations are blocked. Reset and re-enroll in local Work Studio → Settings → Identity and devices.";
	const status = result.status;
	return zh
		? [
				"二次验证（TOTP）",
				`验证器：${status.enrolled ? "已绑定" : "未绑定"}`,
				`远程写操作验证：${status.required ? "必需" : "未强制"}`,
				`待确认绑定：${status.pending ? "有" : "无"}`,
				`剩余恢复码：${status.recoveryCodesRemaining}`,
				"验证窗口：普通写操作 12 小时；敏感设备操作 10 分钟。",
				"远程设备的已验证状态由 serve 持有，本终端不代替设备验证。",
				"绑定或管理：本机 Work Studio → 设置 → 身份与设备。",
			].join("\n")
		: [
				"Two-factor authentication (TOTP)",
				`Authenticator: ${status.enrolled ? "enrolled" : "not enrolled"}`,
				`Remote write verification: ${status.required ? "required" : "optional"}`,
				`Pending enrollment: ${status.pending ? "yes" : "no"}`,
				`Recovery codes remaining: ${status.recoveryCodesRemaining}`,
				"Verification windows: ordinary writes 12 hours; sensitive device actions 10 minutes.",
				"Remote device grants belong to serve; this terminal does not verify another device.",
				"Enroll or manage in local Work Studio → Settings → Identity and devices.",
			].join("\n");
}
