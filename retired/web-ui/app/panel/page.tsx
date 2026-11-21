import { Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StudioShell } from "@/components/studio/shell/StudioShell";

/**
 * Docked surface for hosts that mount the web UI inside their own frame (the
 * zetawork WebView2 window, an IDE panel, a kiosk page). Same shell, same
 * client: panel mode drops the sidebar and the page routes and keeps the tab
 * strip, transcript and composer.
 *
 * `?mode=panel` on the root route is equivalent; this route exists so a host can
 * point at a clean URL, e.g. `http://127.0.0.1:30141/panel?session=<id>`.
 */
export default function EmbedPage() {
	return (
		<ErrorBoundary>
			<Suspense>
				<StudioShell mode="panel" />
			</Suspense>
		</ErrorBoundary>
	);
}
