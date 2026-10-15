import { PageSurface } from "@/components/shell/PageSurface";
import { pluginRoots, readPluginPages, type PluginPageEntry } from "@/lib/plugin-pages";

interface PluginPageProps {
	params: Promise<{ pluginId: string; path?: string[] }>;
}

function EmptyState({ title, detail, pages }: { title: string; detail: string; pages?: PluginPageEntry[] }) {
	return (
		<div
			data-plugin-page="empty"
			style={{
				flex: 1,
				minHeight: 0,
				overflowY: "auto",
				padding: 16,
				fontSize: 13,
				lineHeight: 1.6,
				color: "var(--zeta-alias-text-muted)",
			}}
		>
			<div style={{ color: "var(--zeta-alias-text)", fontWeight: 600, marginBottom: 6 }}>{title}</div>
			<div>{detail}</div>
			{pages && pages.length > 0 && (
				<ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
					{pages.map(entry => (
						<li key={entry.path}>
							<a href={`./${entry.path}`} style={{ color: "var(--zeta-alias-accent)" }}>
								{entry.title}
							</a>{" "}
							<span style={{ fontFamily: "var(--font-mono)" }}>{entry.path}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * One web plugin page, mounted chrome-free.
 *
 * This is the URL a host panel points at (the desktop's right sidebar, an
 * iframe, a browser tab): `/plugins/view/<plugin>/<page>`. The page runs inside
 * the panel surface with no app chrome of its own, and the plugin's HTML/JS/CSS
 * is served from its own package by `/api/plugin-assets/…`, so the page can call
 * whatever `/api` endpoints it needs.
 *
 * With no page path the route lists the plugin's pages instead — that is the
 * discovery surface for a human (or the desktop) that only knows the plugin id.
 */
export default async function PluginPage({ params }: PluginPageProps) {
	const { pluginId, path: segments = [] } = await params;
	const plugin = readPluginPages(pluginId);

	if (!plugin) {
		return (
			<PageSurface label={`Plugin ${pluginId}`}>
				<EmptyState
					title={`Plugin not installed: ${pluginId}`}
					detail={`No plugin package declares this id under ${pluginRoots().join(", ")}.`}
				/>
			</PageSurface>
		);
	}

	const requested = segments.filter(Boolean).join("/");
	const page = requested ? plugin.pages.find(entry => entry.path === requested) : undefined;

	if (!requested) {
		return (
			<PageSurface label={`${plugin.name} pages`}>
				{plugin.pages.length === 0 ? (
					<EmptyState
						title={`${plugin.name} ships no pages`}
						detail="A web plugin page is an .html/.htm file inside the plugin package."
					/>
				) : (
					<EmptyState
						title={`${plugin.name} · ${plugin.pages.length} page(s)`}
						detail="Mounted at /plugins/view/<plugin>/<page>; add ?mode=panel for the host-panel URL."
						pages={plugin.pages}
					/>
				)}
			</PageSurface>
		);
	}

	if (!page) {
		return (
			<PageSurface label={`${plugin.name} page not found`}>
				<EmptyState
					title={`No such page: ${requested}`}
					detail={`${plugin.name} ${plugin.version} ships ${plugin.pages.length} page(s).`}
					pages={plugin.pages}
				/>
			</PageSurface>
		);
	}

	return (
		<PageSurface label={page.title}>
			{/* The plugin page is isolated from the host document (CSS/DOM) but keeps
          its origin, because a plugin view is expected to call `/api`. */}
			<iframe
				data-plugin-page="frame"
				src={page.url}
				title={page.title}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
				style={{
					flex: 1,
					minHeight: 0,
					width: "100%",
					border: 0,
					background: "var(--zeta-alias-bg)",
				}}
			/>
		</PageSurface>
	);
}
