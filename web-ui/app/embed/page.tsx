import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * Conversation-only surface for hosts that mount the web UI in their own frame
 * (the zetawork GUI's WebView2, an iframe, a kiosk page). Same shell, same
 * client: the layout drops every chrome region and keeps the transcript plus
 * the composer — see `components/shell/ShellLayout.tsx`.
 *
 * `?mode=embed` on the root route is equivalent; this route exists so a host
 * can point at a clean URL, e.g. `http://127.0.0.1:30141/embed?session=<id>`.
 */
export default function EmbedPage() {
  return (
    <ErrorBoundary>
      <Suspense>
        <AppShell mode="embed" />
      </Suspense>
    </ErrorBoundary>
  );
}
