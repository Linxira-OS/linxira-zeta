import { Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StudioShell } from "@/components/studio/shell/StudioShell";

/**
 * The product surface. `StudioShell` is the only shell: the browser-only
 * `zeta-web` server and the `zetawork` desktop bundle both mount it against an
 * existing `zeta serve`, so there is no second UI codebase and no second
 * transport.
 */
export default function Home() {
	return (
		<ErrorBoundary>
			<Suspense>
				<StudioShell mode="app" />
			</Suspense>
		</ErrorBoundary>
	);
}
