/**
 * Time-bucket group rendering (Today / Yesterday / Earlier) for the selected
 * project's session tree. Extracted from SessionSidebar's groupedTree map.
 */
"use client";

import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { SessionNodeItem } from "./SessionNodeItem";

export interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
}

export interface TimeGroup {
	bucket: "today" | "yesterday" | "earlier";
	nodes: SessionTreeNode[];
}

interface SessionGroupSectionProps {
	groups: TimeGroup[];
	bucketLabels: Record<TimeGroup["bucket"], string>;
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
					depth={depth}
					hasChildren={hasChildren}
					collapsed={collapsed}
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


export function SessionGroupSection({
	groups,
	bucketLabels,
	visibleIds,
	...rest
}: Omit<SessionGroupSectionProps, "visibleIds"> & { visibleIds: readonly string[] }) {
	return (
		<>
			{groups.map(group => (
				<div key={group.bucket}>
					<div
						style={{
							padding: "10px 14px 4px",
							color: "var(--text-dim)",
							fontSize: 10,
							fontWeight: 600,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
						}}
					>
						{bucketLabels[group.bucket]}
					</div>
					{group.nodes.map(node => (
						<TreeItem key={node.session.id} node={node} depth={0} visibleIds={visibleIds} {...rest} />
					))}
				</div>
			))}
		</>
	);
}
