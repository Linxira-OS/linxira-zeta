import type { ConversationMessageItem } from "@linxiraos/studio-contract";

/** Each label belongs to one message; no session or binding state is accepted here. */
export function userMessageSourceLabel(source: ConversationMessageItem["source"]): string {
	if (!source) return "Unknown source";
	if (source.kind === "client") {
		return source.client === "cli" ? "TUI / CLI" : source.client === "web" ? "Web" : source.client === "desktop" ? "Desktop" : source.client === "automation" ? "Automation" : "Unknown source";
	}
	const platform = source.platform === "feishu" ? "飞书 / Feishu" : source.platform ?? "IM";
	return [platform, source.instance, source.senderName ?? source.senderId].filter(Boolean).join(" · ");
}

export function UserMessageSource({ source }: { source: ConversationMessageItem["source"] }) {
	return <span className="chip gray xs" data-message-source={source?.kind ?? "unknown"}>{userMessageSourceLabel(source)}</span>;
}
