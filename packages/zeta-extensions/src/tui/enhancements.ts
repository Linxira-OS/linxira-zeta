// TUI/UX enhancements: desktop notifications on agent settle, and a zeta
// settings panel (omp settings-page equivalent surfaced through pi dialogs).
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Platform = "win32" | "darwin" | "linux";

function platform(): Platform {
	const p = process.platform;
	if (p === "win32" || p === "darwin" || p === "linux") return p;
	return "linux";
}

function notify(api: ExtensionAPI, title: string, message: string): void {
	const p = platform();
	if (p === "win32") {
		void api.exec("powershell", [
			"-NoProfile",
			"-Command",
			`[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.NotifyIcon]::new() | Out-Null; New-Object System.Windows.Forms.NotifyIcon -Property @{Visible=$true; Icon=[System.Drawing.SystemIcons]::Information; BalloonTipText=${JSON.stringify(message)}; BalloonTipTitle=${JSON.stringify(title)}} | % { $_.ShowBalloonTip(5000); Start-Sleep 5; $_.Dispose() }`,
		]);
		return;
	}
	if (p === "darwin") {
		void api.exec(
			"osascript",
			["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
		);
		return;
	}
	void api.exec("notify-send", [title, message]);
}

export interface NotifyOptions {
	onAgentEnd: boolean;
	onError: boolean;
}

export function installDesktopNotify(api: ExtensionAPI): void {
	const options: NotifyOptions = { onAgentEnd: true, onError: true };

	api.registerFlag("notify", {
		description: "Show desktop notifications when the agent finishes (default: true)",
		type: "boolean",
		default: true,
	});

	api.registerCommand("notify", {
		description: "Toggle desktop notifications on agent finish. Usage: /notify [on|off]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") options.onAgentEnd = true;
			else if (arg === "off") options.onAgentEnd = false;
			else options.onAgentEnd = !options.onAgentEnd;
			ctx.ui.notify(`Desktop notifications: ${options.onAgentEnd ? "on" : "off"}`, "info");
		},
	});

	api.on("agent_end", () => {
		if (api.getFlag("notify") === false || !options.onAgentEnd) return;
		notify(api, "Zeta", "Agent finished");
	});
}

export interface ZetaFeatureInfo {
	name: string;
	status: string;
	toggle: () => Promise<void>;
}

export function installSettingsPanel(api: ExtensionAPI, getFeatures: () => ZetaFeatureInfo[]): void {
	api.registerCommand("zeta-settings", {
		description: "Zeta settings panel: view and toggle zeta features (loop, vibe, plan, goal, notifications)",
		handler: async (_args, ctx) => {
			await showPanel(api, ctx, getFeatures);
		},
	});

	const showPanel = async (
		api: ExtensionAPI,
		ctx: ExtensionContext,
		getFeatures: () => ZetaFeatureInfo[],
	): Promise<void> => {
		const features = getFeatures();
		const options = features.map((f) => `${f.name}: ${f.status}`);
		options.push("Close");
		const choice = await ctx.ui.select("Zeta settings", options);
		if (!choice || choice === "Close") return;
		const feature = features[options.indexOf(choice)];
		if (feature) {
			await feature.toggle();
			await showPanel(api, ctx, getFeatures);
		}
	};
}
