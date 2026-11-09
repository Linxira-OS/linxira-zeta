import { useEffect, useMemo, useState } from "react";
import { MarkdownText } from "../conversation/markdown";
import { useI18n } from "../i18n";
import "./docs.css";

type DocEntry = {
	readonly path: string;
	readonly en: string;
	readonly zh: string;
};

const DOC_ENTRIES: readonly DocEntry[] = [
	{ path: "user-guide.md", en: "User guide", zh: "使用指南" },
	{ path: "cli-reference.md", en: "CLI reference", zh: "CLI 参考" },
	{ path: "environment-variables.md", en: "Environment", zh: "环境变量" },
	{ path: "agent-mesh.md", en: "Agent mesh", zh: "Agent 网格" },
	{ path: "agent-modes.md", en: "Agent modes", zh: "Agent 模式" },
	{ path: "channels.md", en: "Channels", zh: "频道" },
	{ path: "remote-workspaces.md", en: "Remote workspaces", zh: "远程工作区" },
	{ path: "plugins.md", en: "Plugins", zh: "插件" },
	{ path: "desktop-app.md", en: "Desktop app", zh: "桌面应用" },
];

export function DocsView() {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const [selected, setSelected] = useState(DOC_ENTRIES[0]?.path ?? "user-guide.md");
	const [content, setContent] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const entry = useMemo(
		() => DOC_ENTRIES.find((candidate) => candidate.path === selected) ?? DOC_ENTRIES[0],
		[selected],
	);

	useEffect(() => {
		if (!entry) return;
		let cancelled = false;
		setContent(null);
		setError(null);
		// Keep `/` literal for the gateway route; encode only each segment.
		const encoded = entry.path.split("/").map(encodeURIComponent).join("/");
		fetch(`/api/docs/${encoded}`)
			.then(async (response) => {
				if (response.status === 404) throw new Error(zh ? "未找到这篇文档。" : "Document not found.");
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as { content: string };
			})
			.then((data) => {
				if (!cancelled) setContent(data.content);
			})
			.catch((reason: unknown) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			cancelled = true;
		};
	}, [entry, zh]);

	return (
		<div className="docs-view">
			<nav className="docs-list" aria-label={zh ? "文档目录" : "Documentation"}>
				{DOC_ENTRIES.map((item) => (
					<button
						key={item.path}
						type="button"
						className={item.path === selected ? "docs-item is-active" : "docs-item"}
						onClick={() => setSelected(item.path)}
					>
						{zh ? item.zh : item.en}
					</button>
				))}
			</nav>
			<div className="docs-body" role="document">
				{error ? (
					<p className="docs-state docs-error" role="alert">{error}</p>
				) : content === null ? (
					<p className="docs-state">{zh ? "正在加载…" : "Loading…"}</p>
				) : (
					<MarkdownText text={content} />
				)}
			</div>
		</div>
	);
}
