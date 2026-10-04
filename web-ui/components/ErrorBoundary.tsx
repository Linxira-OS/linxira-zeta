"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";

interface ErrorBoundaryProps {
	children: React.ReactNode;
}

interface ErrorBoundaryState {
	error: Error | null;
}

/**
 * App-level render crash containment. Without a boundary any uncaught render
 * error unmounts the whole React tree, leaving a blank white window (the
 * desktop shell then looks "crashed" even though the service is alive).
 * The fallback offers a one-click reload; componentDidCatch keeps the error
 * visible on the console for diagnosis.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo): void {
		console.error("[ErrorBoundary] Uncaught render error", error, info.componentStack);
	}

	render(): React.ReactNode {
		if (!this.state.error) return this.props.children;
		return <ErrorFallback error={this.state.error} onReload={() => window.location.reload()} />;
	}
}

function ErrorFallback({ error, onReload }: { error: Error; onReload: () => void }) {
	const { t } = useI18n();
	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 2000,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--bg)",
				padding: 24,
			}}
		>
			<div
				style={{
					maxWidth: 520,
					display: "flex",
					flexDirection: "column",
					gap: 12,
					padding: 24,
					background: "var(--bg-panel)",
					border: "1px solid var(--border)",
					borderRadius: 10,
				}}
			>
				<div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
					{t("error-boundary.title")}
				</div>
				<div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
					{t("error-boundary.description")}
				</div>
				<div
					style={{
						fontSize: 12,
						fontFamily: "var(--font-mono)",
						color: "var(--text-dim)",
						background: "var(--bg)",
						border: "1px solid var(--border)",
						borderRadius: 6,
						padding: "8px 10px",
						maxHeight: 120,
						overflow: "auto",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
					}}
				>
					{error.message || String(error)}
				</div>
				<div style={{ display: "flex", justifyContent: "flex-end" }}>
					<button
						onClick={onReload}
						style={{
							padding: "8px 18px",
							fontSize: 12,
							fontWeight: 600,
							fontFamily: "var(--font-mono)",
							background: "var(--accent)",
							border: "none",
							borderRadius: 6,
							color: "#fff",
							cursor: "pointer",
						}}
					>
						{t("error-boundary.reload")}
					</button>
				</div>
			</div>
		</div>
	);
}
