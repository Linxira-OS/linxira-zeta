"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface BootFailureListProps {
	/** Human-readable failure bullets; renders nothing when empty. */
	items: string[];
}

/**
 * Renders a boot checklist of failed initialisation steps. The point is that a
 * half-initialised shell shows *what* failed instead of a blank window
 * (plan §2.1 "boot gate ... 失败可见").
 */
export function BootFailureList({ items }: BootFailureListProps) {
	if (items.length === 0) return null;
	return (
		<div
			role="alert"
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				zIndex: 1500,
				background: "var(--status-error-background, var(--bg-panel))",
				borderBottom: "1px solid var(--status-error-border, var(--border))",
				color: "var(--text)",
				padding: "10px 14px",
				fontSize: 12,
				fontFamily: "var(--font-mono)",
			}}
		>
			<div style={{ fontWeight: 700, marginBottom: 4 }}>
				Shell initialisation failed — {items.length} item{items.length === 1 ? "" : "s"}:
			</div>
			<ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
				{items.map((item, index) => (
					<li key={`${index}:${item}`}>{item}</li>
				))}
			</ul>
		</div>
	);
}

export interface ShellBootGateProps {
	children: ReactNode;
	/** Non-fatal initialisation failures collected before render completes. */
	failures?: string[];
}

interface ShellBootGateState {
	error: Error | null;
}

/**
 * Shell-scoped boot gate. Two jobs:
 *  1. record non-fatal init failures and list them above the shell;
 *  2. contain a render/init crash so the window shows the failure list plus a
 *     reload button instead of going blank.
 */
export class ShellBootGate extends Component<ShellBootGateProps, ShellBootGateState> {
	state: ShellBootGateState = { error: null };

	static getDerivedStateFromError(error: Error): ShellBootGateState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[ShellBootGate] shell failed to start", error, info.componentStack);
	}

	render(): ReactNode {
		const failures = this.props.failures ?? [];
		if (this.state.error) {
			const items = [
				...failures,
				`render: ${this.state.error.message || String(this.state.error)}`,
			];
			return (
				<div style={{ minHeight: "100dvh", background: "var(--bg)" }}>
					<BootFailureList items={items} />
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							paddingTop: 96,
						}}
					>
						<button
							type="button"
							onClick={() => window.location.reload()}
							style={{
								padding: "8px 18px",
								borderRadius: 8,
								border: "1px solid var(--border)",
								background: "var(--bg-panel)",
								color: "var(--text)",
								cursor: "pointer",
								fontSize: 13,
							}}
						>
							Reload
						</button>
					</div>
				</div>
			);
		}
		return (
			<>
				<BootFailureList items={failures} />
				{this.props.children}
			</>
		);
	}
}
