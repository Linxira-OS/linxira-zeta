/**
 * Flat session list for one project group (D6: single-level grouping — no
 * time-bucket headers). Newest 10 rows render first; "Load more" reveals the
 * rest.
 */
"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import { SessionNodeItem } from "./SessionNodeItem";

export interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
}

interface SessionGroupSectionProps {
	nodes: SessionTreeNode[];
	selectedSessionId: string | null;
	runningSessionIds: ReadonlySet<string>;
	unreadSessionIds: ReadonlySet<string>;
	editMode: boolean;
	selectedIds: ReadonlySet<string>;
	onSelectSession: (s: SessionInfo) => void;
	onRenamed: () => void;
	onSessionDeleted: (id: string) => void;
	onToggleSelect: (id: string, opts?: { shift?: boolean; visibleIds?: readonly string[] }) => void;
	onRowContextMenu?: (e: React.MouseEvent, session: SessionInfo) => void;
	visibleIds: readonly string[];
	onArchive: (id: string) => void;
	pinnedIds: ReadonlySet<string>;
	onPinToggle: (id: string) => void;
}

function TreeItem({
	node,
	depth,
	...rest
}: {
	node: SessionTreeNode;
	depth: number;
	selectedSessionId: string | null;
	runningSessionIds: ReadonlySet<string>;
	unreadSessionIds: ReadonlySet<string>;
	editMode: boolean;
	selectedIds: ReadonlySet<string>;
	onSelectSession: (s: SessionInfo) => void;
	onRenamed: () => void;
	onSessionDeleted: (id: string) => void;
	onToggleSelect: (id: string, opts?: { shift?: boolean; visibleIds?: readonly string[] }) => void;
	visibleIds: readonly string[];
	onArchive: (id: string) => void;
	pinnedIds: ReadonlySet<string>;
	onPinToggle: (id: string) => void;
	onRowContextMenu?: (e: React.MouseEvent, session: SessionInfo) => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const hasChildren = node.children.length > 0;

	return (
		<div>
			<div style={{ position: "relative" }}>
				{depth > 0 && (
					<div
						style={{
							position: "absolute",
							left: depth * 12 + 6,
							top: 0,
							bottom: 0,
							width: 1,
							background: "var(--border)",
							pointerEvents: "none",
						}}
					/>
				)}
				<SessionNodeItem
					session={node.session}
					isSelected={node.session.id === rest.selectedSessionId}
					isRunning={rest.runningSessionIds.has(node.session.id)}
					isUnread={rest.unreadSessionIds.has(node.session.id)}
					onClick={() => rest.onSelectSession(node.session)}
					onRenamed={rest.onRenamed}
					onDeleted={rest.onSessionDeleted}
					onArchive={() => rest.onArchive(node.session.id)}
					pinned={rest.pinnedIds.has(node.session.id)}
					onPinToggle={() => rest.onPinToggle(node.session.id)}
					onRowContextMenu={rest.onRowContextMenu ? (e) => rest.onRowContextMenu?.(e, node.session) : undefined}
					depth={depth}
					hasChildren={hasChildren}
					collapsed={collapsed}
					onToggleCollapse={() => setCollapsed(v => !v)}
					editMode={rest.editMode}
					isChecked={rest.selectedIds.has(node.session.id)}
					onToggleSelect={opts => rest.onToggleSelect(node.session.id, { ...opts, visibleIds: rest.visibleIds })}
					visibleIds={rest.visibleIds}
				/>
			</div>
			{hasChildren && !collapsed && (
				<div>
					{node.children.map(child => (
						<TreeItem key={child.session.id} node={child} depth={depth + 1} {...rest} />
					))}
				</div>
			)}
		</div>
	);
}

const MAX_VISIBLE_SESSIONS = 10;

export function SessionGroupSection({ nodes, visibleIds, ...rest }: SessionGroupSectionProps) {
	// Fold: show the newest 10 rows, "Load more" reveals the rest.
	const [expanded, setExpanded] = useState(false);
	const { t } = useI18n();
	const hidden = expanded ? 0 : Math.max(0, nodes.length - MAX_VISIBLE_SESSIONS);
	const visibleNodes = hidden > 0 ? nodes.slice(0, MAX_VISIBLE_SESSIONS) : nodes;
	return (
		<>
			{visibleNodes.map(node => (
				<TreeItem key={node.session.id} node={node} depth={0} visibleIds={visibleIds} {...rest} />
			))}
			{hidden > 0 && (
				<button
					onClick={() => setExpanded(true)}
					style={{
						display: "block",
						width: "100%",
						padding: "5px 14px",
						background: "none",
						border: "none",
						color: "var(--accent)",
						cursor: "pointer",
						fontSize: 11,
						textAlign: "left",
					}}
				>
					{t("sidebar.loadMore")}
				</button>
			)}
		</>
	);
}
