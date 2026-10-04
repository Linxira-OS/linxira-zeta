import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <Suspense>
        <AppShell />
      </Suspense>
    </ErrorBoundary>
  );
}
