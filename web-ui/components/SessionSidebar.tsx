"use client";

// `node:`-prefixed specifiers are not resolvable in the client bundle — the
// project's own helper covers POSIX and Windows paths without a Node import.
import { getFileName } from "@/lib/file-paths";

import {
	useEffect,
	useLayoutEffect,
	useState,
	useCallback,
	useMemo,
	useRef,
	type CSSProperties,
	type ReactNode,
} from "react";
import type { SessionInfo } from "@/lib/types";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { StarfieldEmblem } from "./StarfieldEmblem";
import { FolderPickerModal } from "./FolderPickerModal";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import { ProjectsSection } from "./sidebar/ProjectsSection";
import {
	loadPinnedSessionIds,
	savePinnedSessionIds,
	sessionDisplayTitle,
} from "./sidebar/sidebar-shared";
import { SidebarProjectsList } from "./sidebar/SidebarProjectsList";
import { SessionGroupSection } from "./sidebar/SessionGroupSection";
import { SessionNodeItem } from "./sidebar/SessionNodeItem";
import { EmptySessionsFold } from "./sidebar/EmptySessionsFold";
import { ArchiveSection } from "./sidebar/ArchiveSection";
import { PinnedSection } from "./sidebar/PinnedSection";
import { BulkActionBar } from "./sidebar/BulkActionBar";
import { FloatingMenu, type FloatingMenuItem } from "./sidebar/FloatingMenu";
import { SearchDialog } from "./SearchDialog";
import {
	loadSidebarPrefs,
	updatePrefs,
	markSessionRead,
	collapseProject,
	pinProject,
	setProjectAlias as setProjectAliasPref,
	type SessionSort,
	type ProjectSort,
} from "@/lib/sidebar-prefs";
import { sortSessions, isFoldableEmptySession } from "@/lib/sidebar-groups";
import { useSessionMultiSelect } from "./sidebar/useSessionMultiSelect";
import {
	archiveSession,
	deleteProjectSessions,
	deleteSessions,
	fetchArchivedSessions,
	renameSession,
} from "@/lib/session-api";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import { sendAgentCommand } from "@/lib/agent-client";
import { defaultWorkspacePath, isSameWorkspacePath, withDefaultWorkspace } from "@/lib/default-workspace";
import "@/lib/pi-desktop";

interface Props {
	selectedSessionId: string | null;
	onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
	/**
	 * New-session entry (D2): the sidebar resolves the draft cwd (entry hint →
	 * selected project → default workspace) and hands it to the shell, which
	 * switches to the empty-state draft. `cwd` is null only when neither a
	 * project nor the default workspace is available — batch 3's degraded
	 * workspace-trigger card consumes that case.
	 */
	onNewSession?: (sessionId: string, cwd: string | null) => void;
	initialSessionId?: string | null;
	skipInitialProjectSelection?: boolean;
	onInitialRestoreDone?: () => void;
	refreshKey?: number;
	onSessionDeleted?: (sessionId: string) => void;
	selectedCwd?: string | null;
	onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
	onOpenSkills?: () => void;
	onOpenFile?: (
		filePath: string,
		fileName: string,
		options?: { sourceSessionId?: string | null; modeHint?: "diff" },
	) => void;
	explorerRefreshKey?: number;
	onExplorerRefresh?: () => void;
	onAtMention?: (relativePath: string, isDir: boolean) => void;
	onAtMentions?: (relativePaths: string[]) => void;
	/** Active plan card shown under the new-session row (null hides it). */
	planCard?: { title: string; onOpen: () => void } | null;
}

interface WorktreeEntry {
	path: string;
	branch: string | null;
	isMain: boolean;
}

interface WorktreeState {
	/** The cwd this data was fetched for — guards against stale responses */
	forCwd: string;
	projectRoot: string;
	isGit: boolean;
	/** False when forCwd is a repo subdirectory — the switcher is hidden there
	 *  because subdir sessions keep their own project identity */
	isTopLevel: boolean;
	worktrees: WorktreeEntry[];
}

const UNREAD_SESSIONS_STORAGE_KEY = "zeta-web:unread-session-ids";
const RUNNING_SESSIONS_POLL_MS = 2500;

function loadUnreadSessionIds(): Set<string> {
	if (typeof window === "undefined") return new Set();
	try {
		const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
		return new Set();
	} catch {
		return new Set();
	}
}

function saveUnreadSessionIds(ids: Set<string>): void {
	if (typeof window === "undefined") return;
	try {
		if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
		else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
	} catch {
		// ignore storage quota / privacy-mode errors
	}
}

function formatRelativeTime(dateStr: string, t: (key: string, params?: TranslationParams) => string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);
	if (mins < 1) return t("sidebar.time.justNow");
	if (mins < 60) return t("sidebar.time.minAgo", { n: mins });
	if (hours < 24) return t("sidebar.time.hourAgo", { n: hours });
	if (days < 7) return t("sidebar.time.dayAgo", { n: days });
	return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
function getRecentProjects(sessions: SessionInfo[]): string[] {
	const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
	for (const s of sessions) {
		const root = s.projectRoot ?? s.cwd;
		if (!root) continue;
		const prev = latestByRoot.get(root);
		if (!prev || s.modified > prev) {
			latestByRoot.set(root, s.modified);
		}
	}
	return [...latestByRoot.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([root]) => root);
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
	return homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */

function ToolbarIconButton({
	onClick,
	title,
	disabled,
	skipHover,
	color,
	background = "none",
	marginRight,
	ariaPressed,
	children,
}: {
	onClick: () => void;
	title: string;
	disabled?: boolean;
	skipHover?: boolean;
	color: string;
	background?: string;
	marginRight?: number;
	ariaPressed?: boolean;
	children: ReactNode;
}) {
	const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
		if (disabled || skipHover) return;
		e.currentTarget.style.color = "var(--text-muted)";
		e.currentTarget.style.background = "var(--bg-hover)";
	};
	const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
		if (disabled || skipHover) return;
		e.currentTarget.style.color = color;
		e.currentTarget.style.background = background;
	};
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			title={title}
			aria-label={title}
			aria-pressed={ariaPressed}
			style={{
				position: "relative",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: 26,
				height: 26,
				padding: 0,
				marginRight,
				background,
				border: "none",
				color,
				cursor: disabled ? "default" : "pointer",
				borderRadius: 5,
				flexShrink: 0,
				opacity: disabled ? 0.6 : 1,
				transition: "color 0.3s, background 0.3s",
			}}
			onMouseEnter={enter}
			onMouseLeave={leave}
		>
			{children}
		</button>
	);
}

function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
	return (
		<span
			style={{
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				display: "block",
				minWidth: 0,
				lineHeight: 1.35,
				direction: "rtl",
				textAlign: "left",
				...style,
			}}
		>
			<span style={{ unicodeBidi: "plaintext" }}>{text}</span>
		</span>
	);
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
	const [mounted, setMounted] = useState(open);
	const [visible, setVisible] = useState(open);

	useEffect(() => {
		let frame: number | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		if (open) {
			setMounted(true);
			setVisible(false);
			frame = window.requestAnimationFrame(() => {
				frame = window.requestAnimationFrame(() => setVisible(true));
			});
		} else {
			setVisible(false);
			timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
		}

		return () => {
			if (frame !== undefined) window.cancelAnimationFrame(frame);
			if (timeout) clearTimeout(timeout);
		};
	}, [open]);

	if (!mounted) return null;

	return (
		<div
			style={{
				...style,
				opacity: visible ? 1 : 0,
				transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
				transformOrigin: "top center",
				transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
				pointerEvents: open ? "auto" : "none",
			}}
		>
			{children}
		</div>
	);
}

interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
	const byId = new Map<string, SessionTreeNode>();
	for (const s of sessions) {
		byId.set(s.id, { session: s, children: [] });
	}

	// Build a map of parentSessionId chains so we can resolve missing ancestors
	const parentOf = new Map<string, string>();
	for (const s of sessions) {
		if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
	}

	// Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
	function resolveAncestor(id: string): string | null {
		let cur = parentOf.get(id);
		const visited = new Set<string>();
		while (cur) {
			if (visited.has(cur)) return null; // cycle guard
			visited.add(cur);
			if (byId.has(cur)) return cur;
			cur = parentOf.get(cur);
		}
		return null;
	}

	const roots: SessionTreeNode[] = [];
	for (const node of byId.values()) {
		const ancestor = resolveAncestor(node.session.id);
		if (ancestor) {
			byId.get(ancestor)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	// Sort each level by modified desc
	const sort = (nodes: SessionTreeNode[]) => {
		nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
		nodes.forEach(n => sort(n.children));
	};
	sort(roots);
	return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
	const [display, setDisplay] = useState(target);
	const frameRef = useRef<number | null>(null);
	const iterRef = useRef(0);

	useEffect(() => {
		if (!running) {
			setDisplay(target);
			return;
		}
		iterRef.current = 0;
		const totalFrames = target.length * 4;

		const step = () => {
			iterRef.current += 1;
			const progress = iterRef.current / totalFrames;
			const resolved = Math.floor(progress * target.length);

			setDisplay(
				target
					.split("")
					.map((char, i) => {
						if (char === " ") return " ";
						if (i < resolved) return char;
						return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
					})
					.join(""),
			);

			if (iterRef.current < totalFrames) {
				frameRef.current = requestAnimationFrame(step);
			} else {
				setDisplay(target);
			}
		};

		frameRef.current = requestAnimationFrame(step);
		return () => {
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
		};
	}, [target, running]);

	return display;
}

/**
 * Hover-revealed project header menu (⋯): destructive project-scoped actions.
 * Deleting sessions only removes transcripts; "sessions + project entry" also
 * drops the workspace group row for this session.
 */
function ProjectHeaderMenu({
	project,
	count,
	onConfirmDelete,
	onRenameAlias,
	onTogglePin,
	pinned,
}: {
	project: string;
	count: number;
	onConfirmDelete: (project: string, count: number) => void;
	onRenameAlias: (project: string) => void;
	onTogglePin: (project: string) => void;
	pinned: boolean;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);
	return (
		<div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
			<button
				onClick={() => setOpen(v => !v)}
				title={t("sidebar.worktreeMenu")}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 20,
					height: 20,
					marginRight: 8,
					padding: 0,
					background: "none",
					border: "none",
					borderRadius: 5,
					color: "var(--text-dim)",
					cursor: "pointer",
					opacity: open ? 1 : 0,
					transition: "opacity 0.12s",
				}}
				onMouseEnter={e => {
					e.currentTarget.style.opacity = "1";
				}}
				onMouseLeave={e => {
					// Bug fix: without this reset the ⋯ stayed visible forever after
					// its first hover (open menus keep it shown via `open`).
					if (!open) e.currentTarget.style.opacity = "0";
				}}
			>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="5" cy="12" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="19" cy="12" r="1.8" />
				</svg>
			</button>
			{open && (
				<div
					style={{
						position: "absolute",
						top: "calc(100% + 2px)",
						right: 8,
						zIndex: 220,
						minWidth: 190,
						background: "var(--bg-elevated, var(--bg))",
						border: "1px solid var(--border)",
						borderRadius: 8,
						boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
						padding: 4,
					}}
				>
					<button
						onClick={() => {
							setOpen(false);
							onTogglePin(project);
						}}
						disabled={count === 0}
						style={{
							display: "block",
							width: "100%",
							textAlign: "left",
							padding: "6px 8px",
							fontSize: 12,
							color: count === 0 ? "var(--text-dim)" : "var(--status-error)",
							background: "none",
							border: "none",
							borderRadius: 5,
							cursor: count === 0 ? "default" : "pointer",
							whiteSpace: "nowrap",
						}}
					>
						{pinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
					</button>
					<button
						onClick={() => {
							setOpen(false);
							onRenameAlias(project);
						}}
						disabled={count === 0}
						style={{
							display: "block",
							width: "100%",
							textAlign: "left",
							padding: "6px 8px",
							fontSize: 12,
							color: count === 0 ? "var(--text-dim)" : "var(--status-error)",
							background: "none",
							border: "none",
							borderRadius: 5,
							cursor: count === 0 ? "default" : "pointer",
							whiteSpace: "nowrap",
						}}
					>
						{t("sidebar.renameProject")}
					</button>
					<button
						onClick={() => {
							setOpen(false);
							onConfirmDelete(project, count);
						}}
						disabled={count === 0}
						style={{
							display: "block",
							width: "100%",
							textAlign: "left",
							padding: "6px 8px",
							fontSize: 12,
							color: count === 0 ? "var(--text-dim)" : "var(--status-error)",
							background: "none",
							border: "none",
							borderRadius: 5,
							cursor: count === 0 ? "default" : "pointer",
							whiteSpace: "nowrap",
						}}
					>
						{t("sidebar.deleteProjectSessions")}
					</button>
				</div>
			)}
		</div>
	);
}

function ZetaWebTitle() {
	const [showVersion, setShowVersion] = useState(false);
	const [scrambling, setScrambling] = useState(false);
	const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const target = showVersion
		? `v${process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.NEXT_PUBLIC_ZETA_VERSION ?? "0.0.0"}`
		: "Zeta Web";
	const display = useScramble(target, scrambling);

	const triggerScramble = useCallback((toVersion: boolean) => {
		setShowVersion(toVersion);
		setScrambling(true);
		setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
	}, []);

	const handleClick = useCallback(() => {
		if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

		const next = !showVersion;
		triggerScramble(next);

		if (next) {
			revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
		}
	}, [showVersion, triggerScramble]);

	useEffect(
		() => () => {
			if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
		},
		[],
	);

	const { isStarfield } = useTheme();

	return (
		<div style={{ display: "flex", alignItems: "center", gap: 7 }}>
			{isStarfield && <StarfieldEmblem size={20} />}
			<button
				onClick={handleClick}
				style={{
					background: "none",
					border: "none",
					padding: 0,
					cursor: "default",
					fontWeight: 800,
					fontSize: isStarfield ? 14 : 15,
					letterSpacing: isStarfield ? "0.12em" : "-0.01em",
					color: showVersion ? "var(--accent)" : "var(--text)",
					fontFamily: isStarfield ? "var(--font-display, 'Orbitron', sans-serif)" : "var(--font-mono)",
					minWidth: "6ch",
					textTransform: isStarfield ? "uppercase" : "none",
				}}
			>
				{display}
			</button>
		</div>
	);
}

export function SessionSidebar({
	selectedSessionId,
	onSelectSession,
	onNewSession,
	initialSessionId,
	skipInitialProjectSelection,
	onInitialRestoreDone,
	refreshKey,
	onSessionDeleted,
	selectedCwd: selectedCwdProp,
	onCwdChange,
	onOpenSkills,
	onOpenFile,
	explorerRefreshKey,
	onExplorerRefresh,
	onAtMention,
	onAtMentions,
	planCard,
}: Props) {
	const { t } = useI18n();
	const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
	const [showBotSessions, setShowBotSessions] = useState(false);
	const [sessionSearch, setSessionSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const multiSelect = useSessionMultiSelect();
	const [pinnedIds, setPinnedIds] = useState<string[]>(() => loadPinnedSessionIds());
	const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([]);
	const [confirmProjectDelete, setConfirmProjectDelete] = useState<{
		project: string;
		count: number;
	} | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	// P2 unified prefs: a bumped counter re-renders after every updatePrefs write.
	const [prefsVersion, setPrefsVersion] = useState(0);
	const prefs = useMemo(() => {
		void prefsVersion;
		return loadSidebarPrefs();
	}, [prefsVersion]);
	const collapsedProjects = useMemo(() => {
		const collapsed = new Set<string>();
		for (const [path, meta] of Object.entries(prefs.projectMeta)) {
			if (meta.collapsed === true) collapsed.add(path);
		}
		return collapsed;
	}, [prefs]);
	// cwd → display alias (UI-only rename; never touches disk) — P2 source.
	const projectAliases = useMemo(() => {
		const aliases: Record<string, string> = {};
		for (const [path, meta] of Object.entries(prefs.projectMeta)) {
			if (meta.name) aliases[path] = meta.name;
		}
		return aliases;
	}, [prefs]);
	// Pinned project roots, pinned-first order — P2 source.
	const pinnedProjects = useMemo(
		() =>
			Object.entries(prefs.projectMeta)
				.filter(([, meta]) => meta.pinned === true)
				.sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
				.map(([path]) => path),
		[prefs],
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
	const [homeDir, setHomeDir] = useState<string>("");
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [projectFilter, setProjectFilter] = useState("");
	const [folderPickerModalOpen, setFolderPickerModalOpen] = useState(false);
	const [customPathOpen, setCustomPathOpen] = useState(false);
	const [customPathValue, setCustomPathValue] = useState("");
	const [customPathError, setCustomPathError] = useState<string | null>(null);
	const [customPathValidating, setCustomPathValidating] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	// Worktree switcher state
	const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
	const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
	const [wtNewOpen, setWtNewOpen] = useState(false);
	const [wtNewBranch, setWtNewBranch] = useState("");
	const [wtError, setWtError] = useState<string | null>(null);
	const [wtBusy, setWtBusy] = useState(false);
	const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
	const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
	const wtDropdownRef = useRef<HTMLDivElement>(null);
	const wtNewInputRef = useRef<HTMLInputElement>(null);
	const [explorerOpen, setExplorerOpen] = useState(false);
	const [explorerKey, setExplorerKey] = useState(0);
	const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
	const [changesCount, setChangesCount] = useState(0);
	const [changesCollapsed, setChangesCollapsed] = useState(true);
	const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
	const [wtFilter, setWtFilter] = useState("");
	const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
	const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
	// Once polling has delivered a snapshot it is the source of truth for
	// running state; late /api/sessions responses must not overwrite it.
	const runningPollAuthoritativeRef = useRef(false);
	const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fileExplorerRef = useRef<FileExplorerHandle>(null);
	// Sidebar extras: today's usage micro-line from the stats dashboard.
	// Fails silently — the section hides when the stats service is down.
	const [usage, setUsage] = useState<{
		totalCost: number;
		totalTokens: number;
		totalRequests: number;
	} | null>(null);

	// Temp-session section fold (default collapsed)
	const [tempOpen, setTempOpen] = useState(false);

	// P2 interaction port: unified palette + floating menus + sort modes.
	const [searchDialogOpen, setSearchDialogOpen] = useState(false);
	// Temp-section sort: read from and written back to P2 sessionView.sort.
	const [tempSort, setTempSort] = useState<SessionSort>(() => loadSidebarPrefs().sessionView.sort);
	const [projSort, setProjSort] = useState<ProjectSort>(() => loadSidebarPrefs().projectSort);
	const [rowMenu, setRowMenu] = useState<{
		session: SessionInfo;
		point: { x: number; y: number } | null;
		anchorRect: DOMRect | null;
	} | null>(null);
	const [projMenu, setProjMenu] = useState<{
		project: string;
		point: { x: number; y: number } | null;
		anchorRect: DOMRect | null;
	} | null>(null);
	const [tempSortMenu, setTempSortMenu] = useState<{
		anchorRect: DOMRect | null;
	} | null>(null);
	const [projSortMenu, setProjSortMenu] = useState<{
		anchorRect: DOMRect | null;
	} | null>(null);
	// Two-level confirmation for every destructive action (delete/archive/clear).
	const [dangerConfirm, setDangerConfirm] = useState<{
		title: string;
		body: string;
		detail?: string;
		confirmLabel: string;
		action: () => Promise<void> | void;
	} | null>(null);

	// Mod+K opens the aggregated search palette.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setSearchDialogOpen(v => !v);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const res = await fetch("/api/stats/overview?range=today");
				if (!res.ok) return;
				const data = (await res.json()) as {
					overall?: {
						totalCost?: number;
						totalInputTokens?: number;
						totalOutputTokens?: number;
						totalRequests?: number;
					};
				};
				const o = data.overall;
				if (!cancelled && o) {
					setUsage({
						totalCost: o.totalCost ?? 0,
						totalTokens: (o.totalInputTokens ?? 0) + (o.totalOutputTokens ?? 0),
						totalRequests: o.totalRequests ?? 0,
					});
				}
			} catch {
				// Stats service unreachable: keep the section hidden.
			}
		};
		void load();
		const timer = setInterval(load, 30_000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	const loadSessions = useCallback(async (showLoading = false) => {
		try {
			if (showLoading) setLoading(true);
			const res = await fetch("/api/sessions");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as {
				sessions: SessionInfo[];
				runningSessionIds?: string[];
			};
			setAllSessions(data.sessions);
			// Treat the fetched running set as an initial fallback only. Once the
			// lightweight poll is live, a slow session-list fetch cannot overwrite it.
			if (!runningPollAuthoritativeRef.current) {
				setRunningSessionIds(new Set(data.runningSessionIds ?? []));
			}
			// Drop unread markers for sessions that no longer exist (e.g. deleted).
			const existingIds = new Set(data.sessions.map(s => s.id));
			setUnreadSessionIds(prev => {
				if (prev.size === 0) return prev;
				const next = new Set([...prev].filter(id => existingIds.has(id)));
				return next.size === prev.size ? prev : next;
			});
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			if (showLoading) setLoading(false);
		}
	}, []);

	const initialLoadDone = useRef(false);
	useEffect(() => {
		const isFirst = !initialLoadDone.current;
		initialLoadDone.current = true;
		loadSessions(isFirst);
		// Whether the sidebar shows relay/bot default-space sessions (web.yml
		// `remote.showBotSessions`; default false = hidden).
		fetch("/api/web-config")
			.then(res => (res.ok ? res.json() : null))
			.then(config => {
				if (config?.remote?.showBotSessions === true) setShowBotSessions(true);
			})
			.catch(() => {});
	}, [loadSessions, refreshKey]);

	// Persist unread markers so they survive a browser refresh before the user
	// has actually opened the completed session.
	useEffect(() => {
		saveUnreadSessionIds(unreadSessionIds);
	}, [unreadSessionIds]);

	useEffect(() => {
		// Running status via a lightweight poll of /api/agent/running. Pauses when
		// the tab is hidden; aborted in-flight requests when switching visibility.
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined = undefined;
		let controller: AbortController | null = null;

		const clearTimer = () => {
			clearTimeout(timer);
			timer = undefined;
		};

		const schedule = () => {
			clearTimer();
			if (stopped || document.visibilityState !== "visible") return;
			timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
		};

		const poll = async () => {
			if (stopped || document.visibilityState !== "visible") return;
			const current = new AbortController();
			controller?.abort();
			controller = current;
			try {
				const res = await fetch("/api/agent/running", {
					cache: "no-store",
					signal: current.signal,
				});
				if (!res.ok) return;
				const data = (await res.json()) as { runningSessionIds?: string[] };
				if (stopped || controller !== current) return;
				runningPollAuthoritativeRef.current = true;
				setRunningSessionIds(new Set(data.runningSessionIds ?? []));
			} catch {
				// Keep the last known state; the next visible-tab poll retries.
			} finally {
				if (controller === current) controller = null;
				schedule();
			}
		};

		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void poll();
				return;
			}
			clearTimer();
			controller?.abort();
			controller = null;
		};

		void poll();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			stopped = true;
			clearTimer();
			controller?.abort();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	useEffect(() => {
		const previous = previousRunningSessionIdsRef.current;
		const completedInBackground = [...previous].filter(id => !runningSessionIds.has(id) && id !== selectedSessionId);
		const newlyRunning = [...runningSessionIds];

		if (completedInBackground.length > 0 || newlyRunning.length > 0) {
			setUnreadSessionIds(prev => {
				const next = new Set(prev);
				newlyRunning.forEach(id => next.delete(id));
				completedInBackground.forEach(id => next.add(id));
				return next;
			});
		}
		// Refresh the session list whenever the running set changes: new sessions
		// become visible without a manual refresh, including the just-selected one
		// (previously excluded here, which left brand-new sessions invisible).
		if (completedInBackground.length > 0 || newlyRunning.length > 0) {
			loadSessions(false);
		}

		previousRunningSessionIdsRef.current = runningSessionIds;
	}, [runningSessionIds, selectedSessionId, loadSessions]);

	useEffect(() => {
		if (!selectedSessionId) return;
		setUnreadSessionIds(prev => {
			if (!prev.has(selectedSessionId)) return prev;
			const next = new Set(prev);
			next.delete(selectedSessionId);
			return next;
		});
	}, [selectedSessionId]);

	useEffect(() => {
		if (explorerRefreshKey !== undefined) setExplorerKey(k => k + 1);
	}, [explorerRefreshKey]);

	useEffect(() => {
		fetch("/api/home")
			.then(r => r.json())
			.then((d: { home?: string }) => {
				if (d.home) setHomeDir(d.home);
			})
			.catch(() => {});
	}, []);

	const restoredRef = useRef(false);

	/** Resolve the project root for a cwd from the freshest data available */
	const projectRootFor = useCallback(
		(cwd: string | null): string | null => {
			if (!cwd) return null;
			if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
			// Any path in the loaded worktree list belongs to that project — covers
			// worktrees without sessions, so switching to them keeps the row mounted.
			if (worktreeState?.worktrees.some(w => w.path === cwd)) return worktreeState.projectRoot;
			const match = allSessions.find(s => s.cwd === cwd);
			return match?.projectRoot ?? cwd;
		},
		[worktreeState, allSessions],
	);

	// Notify parent only when the effective cwd actually changes (not when
	// projectRootFor identity changes due to session/worktree refreshes).
	const lastNotifiedCwdRef = useRef<string | null>(null);
	useEffect(() => {
		if (lastNotifiedCwdRef.current === selectedCwd) return;
		lastNotifiedCwdRef.current = selectedCwd;
		onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
	}, [selectedCwd, onCwdChange, projectRootFor]);

	// Sync the worktree switcher to the selected session's cwd. Sessions of all
	// worktrees in a project share one list, so clicking a session from another
	// worktree should move the effective cwd there. Only fires when the prop
	// value changes, so a manual switcher change is not snapped back.
	const lastSyncedCwdPropRef = useRef<string | null>(null);
	useEffect(() => {
		if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
			lastSyncedCwdPropRef.current = selectedCwdProp;
			setSelectedCwd(selectedCwdProp);
		}
	}, [selectedCwdProp]);

	// Load worktrees for the current effective cwd
	const [wtRefreshKey, setWtRefreshKey] = useState(0);
	useLayoutEffect(() => {
		if (!selectedCwd) {
			setWorktreeState(null);
			setWorktreeLoadingCwd(null);
			return;
		}
		let cancelled = false;
		setWorktreeLoadingCwd(selectedCwd);
		fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
			.then(r => r.json())
			.then(
				(d: {
					projectRoot?: string;
					isGit?: boolean;
					isTopLevel?: boolean;
					worktrees?: WorktreeEntry[];
					error?: string;
				}) => {
					if (cancelled) return;
					setWorktreeLoadingCwd(null);
					if (d.error || !d.projectRoot) {
						setWorktreeState(null);
						return;
					}
					setWorktreeState({
						forCwd: selectedCwd,
						projectRoot: d.projectRoot,
						isGit: d.isGit ?? false,
						isTopLevel: d.isTopLevel ?? false,
						worktrees: d.worktrees ?? [],
					});
				},
			)
			.catch(() => {
				if (!cancelled) {
					setWorktreeLoadingCwd(null);
					setWorktreeState(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selectedCwd, wtRefreshKey, refreshKey]);

	// Auto-select cwd and restore session from URL on first load
	useEffect(() => {
		if (allSessions.length === 0 || skipInitialProjectSelection) return;

		if (selectedCwd === null) {
			// If restoring a session, set cwd to match that session
			if (initialSessionId && !restoredRef.current) {
				restoredRef.current = true;
				const target = allSessions.find(s => s.id === initialSessionId);
				if (target) {
					setSelectedCwd(target.cwd);
					onSelectSession(target, true);
					return;
				}
				// Session not found — notify parent so it can show the placeholder
				onInitialRestoreDone?.();
			}
			const projects = getRecentProjects(allSessions);
			if (projects.length > 0) setSelectedCwd(projects[0]);
		}
	}, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

	const commitCustomPath = useCallback(
		async (candidate?: string) => {
			const path = (candidate ?? customPathValue).trim();
			if (!path || customPathValidating) return;

			setCustomPathValidating(true);
			setCustomPathError(null);
			try {
				const res = await fetch("/api/cwd/validate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cwd: path }),
				});
				const data = (await res.json().catch(() => ({}))) as {
					cwd?: string;
					error?: string;
				};
				if (!res.ok || data.error) {
					setCustomPathError(data.error ?? `HTTP ${res.status}`);
					return;
				}
				setSelectedCwd(data.cwd ?? path);
				setCustomPathOpen(false);
				setCustomPathValue("");
				setDropdownOpen(false);
			} catch (e) {
				setCustomPathError(e instanceof Error ? e.message : String(e));
			} finally {
				setCustomPathValidating(false);
			}
		},
		[customPathValue, customPathValidating],
	);

	const handleCustomPathClick = useCallback(() => {
		setCustomPathOpen(true);
		setCustomPathError(null);
		setDropdownOpen(false);
	}, []);
	const handleDefaultCwd = useCallback(async () => {
		try {
			const res = await fetch("/api/default-cwd", { method: "POST" });
			const data = (await res.json()) as { cwd?: string; error?: string };
			if (data.cwd) {
				setSelectedCwd(data.cwd);
				setCustomPathOpen(false);
				setCustomPathValue("");
				setCustomPathError(null);
				setDropdownOpen(false);
			}
		} catch {
			// ignore
		}
	}, []);

	const handleCreateWorktree = useCallback(async () => {
		const branch = wtNewBranch.trim();
		if (!branch || wtBusy || !worktreeState) return;
		setWtBusy(true);
		setWtError(null);
		try {
			const res = await fetch("/api/worktrees", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				path?: string;
				error?: string;
			};
			if (!res.ok || data.error || !data.path) {
				setWtError(data.error ?? `HTTP ${res.status}`);
				return;
			}
			setWtNewOpen(false);
			setWtNewBranch("");
			setWtDropdownOpen(false);
			// Optimistically register the new worktree so projectRootFor() resolves
			// it to the main repo before the refetch lands (keeps AppShell from
			// treating the new cwd as a different project).
			setWorktreeState(prev =>
				prev
					? {
							...prev,
							forCwd: data.path!,
							worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
						}
					: prev,
			);
			setSelectedCwd(data.path);
			setWtRefreshKey(k => k + 1);
		} catch (e) {
			setWtError(e instanceof Error ? e.message : String(e));
		} finally {
			setWtBusy(false);
		}
	}, [wtNewBranch, wtBusy, worktreeState]);

	const handleRemoveWorktree = useCallback(
		async (path: string, force: boolean) => {
			if (!worktreeState || wtBusy) return;
			setWtBusy(true);
			setWtError(null);
			try {
				const res = await fetch("/api/worktrees", {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
				});
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
					dirty?: boolean;
				};
				if (!res.ok) {
					if (data.dirty && !force) {
						// Dirty worktree — ask the user to confirm a force removal
						setWtConfirmRemove(path);
						return;
					}
					setWtError(data.error ?? `HTTP ${res.status}`);
					return;
				}
				setWtConfirmRemove(null);
				if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
				setWtRefreshKey(k => k + 1);
			} catch (e) {
				setWtError(e instanceof Error ? e.message : String(e));
			} finally {
				setWtBusy(false);
			}
		},
		[worktreeState, wtBusy, selectedCwd],
	);

	// Close dropdowns on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setDropdownOpen(false);
				setProjectFilter("");
			}
			if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
				setWtDropdownOpen(false);
				setWtNewOpen(false);
				setWtNewBranch("");
				setWtError(null);
				setWtConfirmRemove(null);
				setWtFilter("");
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	// Clicking a session moves the effective cwd to that session's worktree.
	// Done on the click path (not via the selectedCwd prop sync) so it also
	// works when the prop value won't change — e.g. re-clicking the already
	// open session after manually switching worktrees.
	const handleSelectSessionFromList = useCallback(
		(s: SessionInfo) => {
			if (s.cwd) setSelectedCwd(s.cwd);
			onSelectSession(s);
		},
		[onSelectSession],
	);

	const tempId = useCallback(
		() =>
			typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
		[],
	);

	/**
	 * D2 draft-direct new session: resolve the draft cwd (entry hint → selected
	 * project → default workspace) and hand it to the shell. The session is
	 * only created when the first message is sent (unchanged semantics).
	 */
	const startNewSession = useCallback(
		async (cwdHint?: string | null) => {
			let cwd = cwdHint ?? projectRootFor(selectedCwd) ?? selectedCwd ?? null;
			if (!cwd) {
				let home = homeDir;
				if (!home) {
					try {
						const res = await fetch("/api/home");
						// Gateway JSON payload; shape is owned by /api/home.
						const data = (await res.json()) as { home?: string };
						home = typeof data.home === "string" ? data.home : "";
					} catch {
						home = "";
					}
				}
				if (home) cwd = defaultWorkspacePath(home);
			}
			onNewSession?.(tempId(), cwd);
		},
		[selectedCwd, homeDir, projectRootFor, onNewSession, tempId],
	);

	// Project presentation prefs write straight to P2 (single source of truth).
	const toggleProjectCollapsed = useCallback((project: string) => {
		collapseProject(project, !loadSidebarPrefs().projectMeta[project]?.collapsed);
		setPrefsVersion(v => v + 1);
	}, []);

	// Sessions of every worktree in the selected project are shown together
	const selectedProject = projectRootFor(selectedCwd);
	const visibleSessions = showBotSessions
		? allSessions
		: allSessions.filter(s => s.tag !== "relay" && s.tag !== "bot");
	const nonTempSessions = visibleSessions.filter(s => !s.temp);
	const tempSessions = visibleSessions.filter(s => s.temp === true);
	// D5: stale empty sessions (0 msgs, >24h, not running/pinned) leave the
	// regular lists and surface in the per-group EmptySessionsFold instead.
	const foldableEmptyIds = useMemo(() => {
		const ids = new Set<string>();
		for (const s of nonTempSessions) {
			if (isFoldableEmptySession(s, { now: Date.now(), isRunning: runningSessionIds.has(s.id), isPinned: pinnedIds.includes(s.id) })) {
				ids.add(s.id);
			}
		}
		return ids;
	}, [nonTempSessions, runningSessionIds, pinnedIds]);
	const activeNonTempSessions = useMemo(
		() => nonTempSessions.filter(s => !foldableEmptyIds.has(s.id)),
		[nonTempSessions, foldableEmptyIds],
	);
	const emptySessionsByProject = useMemo(() => {
		const byProject = new Map<string, SessionInfo[]>();
		for (const s of nonTempSessions) {
			if (!foldableEmptyIds.has(s.id)) continue;
			const root = s.projectRoot ?? s.cwd;
			const list = byProject.get(root) ?? [];
			list.push(s);
			byProject.set(root, list);
		}
		return byProject;
	}, [nonTempSessions, foldableEmptyIds]);
	// The default workspace is always listed — even before any session exists
	// there — so a fresh install shows its anchor workspace (D2 fallback cwd).
	const defaultWorkspace = homeDir ? defaultWorkspacePath(homeDir) : null;
	const recentProjects = withDefaultWorkspace(getRecentProjects(activeNonTempSessions), defaultWorkspace);
 	const showProjectFilter = recentProjects.length > 8;
	// The dropdown already opens with a dedicated default-workspace button, so
	// the plain project list beneath it skips the seeded entry.
	const visibleProjects = (
		projectFilter.trim()
			? recentProjects.filter(p => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
			: recentProjects
	).filter(p => !defaultWorkspace || !isSameWorkspacePath(p, defaultWorkspace));
	const filteredSessions = selectedProject
		? activeNonTempSessions.filter(s => (s.projectRoot ?? s.cwd) === selectedProject)
		: activeNonTempSessions;
	const purgeTempSessions = useCallback(async () => {
		const byCwd = new Set<string>();
		for (const s of tempSessions) byCwd.add(s.cwd);
		for (const cwd of byCwd) {
			try {
				await deleteProjectSessions(cwd);
			} catch {
				// leave the group; user can retry
			}
		}
	}, [tempSessions]);

	// Temp-section ordering: the header ↑↓ menu writes P2 sessionView.sort and
	// the rows actually follow it (was a dead control before).
	const sortedTempSessions = useMemo(() => {
		const rows = tempSessions.map(s => ({
			session: s,
			id: s.id,
			title: s.name ?? s.firstMessage,
			projectKey: s.projectRoot ?? s.cwd,
			updatedAt: Date.parse(s.modified) || 0,
			createdAt: Date.parse(s.created) || 0,
		}));
		return sortSessions(rows, tempSort, id => loadSidebarPrefs().sessionMeta[id]).map(
			r => r.session,
		);
	}, [tempSessions, tempSort]);

	const requestProjectDelete = useCallback(
		(project: string) => {
			setConfirmProjectDelete({
				project,
				count: filteredSessions.length,
			});
		},
		[filteredSessions.length],
	);

	const setProjectAlias = useCallback(
		(project: string) => {
			const current = projectAliases[project] ?? "";
			const next = window.prompt("Project display name", current);
			if (next === null) return;
			setProjectAliasPref(project, next.trim() === "" ? null : next.trim());
			setPrefsVersion(v => v + 1);
		},
		[projectAliases],
	);

	const toggleProjectPin = useCallback((project: string) => {
		pinProject(project, !loadSidebarPrefs().projectMeta[project]?.pinned);
		setPrefsVersion(v => v + 1);
	}, []);
	const showWorktreeSwitcher = Boolean(
		worktreeState?.isGit && worktreeState.isTopLevel && selectedCwd && selectedProject === worktreeState.projectRoot,
	);
	const worktreeGuide =
		selectedCwd && worktreeState && selectedProject === worktreeState.projectRoot && !showWorktreeSwitcher
			? worktreeState.isGit
				? {
						label: t("sidebar.openRepoRoot"),
						title: t("sidebar.openRepoRootTitle"),
					}
				: {
						label: t("sidebar.gitRepoRootOnly"),
						title: t("sidebar.gitRepoRootOnlyTitle"),
					}
			: null;
	const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
	const inactiveWorktreeSelector =
		worktreeGuide ??
		(worktreeLoading && !showWorktreeSwitcher
			? {
					label: t("sidebar.worktrees"),
					title: t("sidebar.checkingWorktrees"),
				}
			: null);
	// All known workspaces, current first — the sidebar lists every workspace
	// with its own session group (reference-project layout).
	const workspaceGroups = useMemo(() => {
		const counts = new Map<string, number>();
		for (const project of recentProjects) {
			counts.set(project, activeNonTempSessions.filter(s => (s.projectRoot ?? s.cwd) === project).length);
		}
		let ordered: string[];
		const firstSeen = new Map<string, number>();
		allSessions.forEach((s, idx) => {
			const root = s.projectRoot ?? s.cwd;
			if (root && !firstSeen.has(root)) firstSeen.set(root, idx);
		});
		switch (projSort) {
			case "name":
				ordered = [...recentProjects].sort((a, b) => a.localeCompare(b));
				break;
			case "created":
				// First session appearance order (stable per id order in allSessions).
				ordered = [...recentProjects].sort((a, b) => (firstSeen.get(a) ?? 1e9) - (firstSeen.get(b) ?? 1e9));
				break;
			case "oldest": {
				ordered = [...recentProjects].sort((a, b) => (firstSeen.get(b) ?? 1e9) - (firstSeen.get(a) ?? 1e9));
				break;
			}
			case "recent": {
				// Most recently modified session first.
				const latest = new Map<string, number>();
				for (const s of allSessions) {
					const root = s.projectRoot ?? s.cwd;
					if (!root) continue;
					const t = new Date(s.modified).getTime();
					if (!latest.has(root) || t > (latest.get(root) ?? 0)) latest.set(root, t);
				}
				ordered = [...recentProjects].sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
				break;
			}
			case "manual": {
				// Pinned first (prefs order), then current project, then recency.
				const prefsNow = loadSidebarPrefs();
				const pinRank = (p: string) => {
					const m = prefsNow.projectMeta[p];
					return m?.pinned ? (m.order ?? 0) : 1e9;
				};
				ordered = [...recentProjects].sort(
					(a, b) => pinRank(a) - pinRank(b) || (a === selectedProject ? -1 : b === selectedProject ? 1 : 0),
				);
				break;
			}
			default:
				ordered = [...recentProjects];
		}
		// The seeded default workspace outranks every sort mode.
		const orderedProjects = defaultWorkspace
			? [defaultWorkspace, ...ordered.filter(p => !isSameWorkspacePath(p, defaultWorkspace))]
			: ordered;
		return orderedProjects.map(project => ({
			project,
			count: counts.get(project) ?? 0,
			isDefault: defaultWorkspace !== null && isSameWorkspacePath(project, defaultWorkspace),
		}));
	}, [recentProjects, selectedProject, activeNonTempSessions, projSort, allSessions, defaultWorkspace]);

	// Local session search (data is fully in memory — no backend round trip).
	const searchQuery = sessionSearch.trim().toLowerCase();
	const searchedSessions = useMemo(() => {
		if (!searchQuery) return filteredSessions;
		return filteredSessions.filter(s => {
			const title = (s.name || s.firstMessage || s.id).toLowerCase();
			const cwd = (s.cwd ?? "").toLowerCase();
			return title.includes(searchQuery) || cwd.includes(searchQuery);
		});
	}, [filteredSessions, searchQuery]);
	const searchTree = buildSessionTree(searchedSessions);
	const searching = searchQuery.length > 0;

	// Per-project session trees: EVERY project renders its own conversations
	// inline as children of the project row (parent folds → children hide).
	// Flat within the group — no time-bucket headers (D6).
	const projectTrees = useMemo(() => {
		const byProject = new Map<string, SessionInfo[]>();
		for (const s of activeNonTempSessions) {
			const root = s.projectRoot ?? s.cwd;
			const list = byProject.get(root) ?? [];
			list.push(s);
			byProject.set(root, list);
		}
		const trees = new Map<string, SessionTreeNode[]>();
		for (const [project, sessions] of byProject) {
			trees.set(project, buildSessionTree(sessions));
		}
		return trees;
	}, [activeNonTempSessions]);

	// ── Pin / archive / bulk-selection glue ──
	const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
	const togglePin = useCallback((id: string) => {
		setPinnedIds(prev => {
			const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev];
			savePinnedSessionIds(next);
			return next;
		});
	}, []);
	// All session ids visible in the list (across buckets), for shift-range
	// selection and select-all.
	const visibleSessionIds = useMemo(() => filteredSessions.map(s => s.id), [filteredSessions]);
	const handleArchiveOne = useCallback(
		async (id: string) => {
			try {
				await archiveSession(id);
				await Promise.all([loadSessions(), loadArchived()]);
			} catch {
				// keep the row in place on failure
			}
		},
		[loadSessions],
	);
	// D5: empty-session deletion (single + batch) — both go through the shared
	// two-step danger confirm and only ever touch foldable empty sessions.
	const handleEmptySessionsCleanup = useCallback(
		async (targets: SessionInfo[]) => {
			if (targets.length === 0) return;
			try {
				await deleteSessions(targets.map(s => s.id));
				await loadSessions();
			} catch {
				// keep the fold in place on failure
			}
		},
		[loadSessions],
	);
	const confirmEmptySessionDelete = useCallback(
		(s: SessionInfo) => {
			setDangerConfirm({
				title: t("sidebar.deleteSessionTitle"),
				body: t("sidebar.deleteSessionConfirm", { name: sessionDisplayTitle(s, t) }),
				detail: s.id,
				confirmLabel: t("sidebar.delete"),
				action: () => handleEmptySessionsCleanup([s]),
			});
		},
		[handleEmptySessionsCleanup, t],
	);
	const confirmEmptySessionsCleanup = useCallback(
		(targets: SessionInfo[]) => {
			setDangerConfirm({
				title: t("sidebar.emptySessionCleanup"),
				body: t("sidebar.deleteSelectedConfirm", { count: targets.length }),
				confirmLabel: t("sidebar.delete"),
				action: () => handleEmptySessionsCleanup(targets),
			});
		},
		[handleEmptySessionsCleanup, t],
	);
	const loadArchived = useCallback(async () => {
		try {
			setArchivedSessions(await fetchArchivedSessions());
		} catch {
			setArchivedSessions([]);
		}
	}, []);
	useEffect(() => {
		void loadArchived();
	}, [loadArchived, refreshKey]);
	// Drop selection/pins that no longer resolve to live sessions.
	useEffect(() => {
		const existing = new Set(allSessions.map(s => s.id));
		multiSelect.prune(existing);
	}, [allSessions, multiSelect]);
	const handleBulkDelete = useCallback(async () => {
		const ids = [...multiSelect.selectedIds];
		if (ids.length === 0) return;
		if (!window.confirm(t("sidebar.deleteSelectedConfirm", { count: ids.length }))) return;
		try {
			if (ids.length > 5) {
				// Large selections collapse to one project-scoped call per project.
				const byProject = new Map<string, string[]>();
				for (const s of allSessions) {
					if (multiSelect.selectedIds.has(s.id)) {
						const root = s.projectRoot ?? s.cwd;
						byProject.set(root, [...(byProject.get(root) ?? []), s.id]);
					}
				}
				for (const [root, projectIds] of byProject) {
					if (projectIds.length > 5) await deleteProjectSessions(root);
					else await deleteSessions(projectIds);
				}
			} else {
				await deleteSessions(ids);
			}
			multiSelect.clear();
			await loadSessions();
		} catch {
			// leave selection intact on failure
		}
	}, [multiSelect, allSessions, loadSessions, t]);
	const handleBulkArchive = useCallback(async () => {
		const ids = [...multiSelect.selectedIds];
		try {
			for (const id of ids) await archiveSession(id);
			multiSelect.clear();
			await Promise.all([loadSessions(), loadArchived()]);
		} catch {
			// keep selection on failure
		}
	}, [multiSelect, loadSessions, loadArchived]);
	const pinnedSessions = useMemo(
		() =>
			pinnedIds
				.map(id => allSessions.find(s => s.id === id))
				.filter((s): s is SessionInfo => Boolean(s))
				.filter(s => filteredSessions.some(f => f.id === s.id)),
		[pinnedIds, allSessions, filteredSessions],
	);
	const stalePinnedIds = useMemo(
		() => pinnedIds.filter(id => !allSessions.some(s => s.id === id)),
		[pinnedIds, allSessions],
	);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			{customPathOpen && (
				<DirectoryPicker
					busy={customPathValidating}
					error={customPathError}
					onCancel={() => {
						setCustomPathOpen(false);
						setCustomPathError(null);
					}}
					onSelect={path => void commitCustomPath(path)}
				/>
			)}
			{/* Header */}
			<div
				style={{
					padding: "12px 10px 10px",
					borderBottom: "1px solid var(--border)",
					flexShrink: 0,
				}}
			>
				<SidebarHeader
					title={<ZetaWebTitle />}
					searchOpen={searchOpen}
					editMode={multiSelect.enabled}
					onToggleSearch={() =>
						setSearchOpen(v => {
							const next = !v;
							if (!next) setSessionSearch("");
							return next;
						})
					}
					onToggleEditMode={() => multiSelect.setEnabled(!multiSelect.enabled)}
					projectSort={projSort}
					onProjectSortChange={mode => {
						setProjSort(mode);
						updatePrefs(p => {
							p.projectSort = mode;
						});
					}}
				/>

				{/* Active plan card — only when the selected session has a live plan */}
				{planCard && (
					<div style={{ padding: "0 10px 6px", flexShrink: 0 }}>
						<button
							onClick={planCard.onOpen}
							title={planCard.title}
							style={{
								width: "100%",
								display: "flex",
								alignItems: "center",
								gap: 7,
								padding: "7px 9px",
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								cursor: "pointer",
								textAlign: "left",
							}}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--accent)"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ flexShrink: 0 }}
							>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
								<polyline points="14 2 14 8 20 8" />
								<line x1="16" y1="13" x2="8" y2="13" />
								<line x1="16" y1="17" x2="8" y2="17" />
							</svg>
							<span
								style={{
									flex: 1,
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									fontSize: 11.5,
									color: "var(--text)",
								}}
							>
								{planCard.title}
							</span>
							<span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
								{t("sidebar.planCard")}
							</span>
						</button>
					</div>
				)}

				{/* Search row — toggled from the tools row, Esc clears/closes */}
				{searchOpen && !loading && !error && (
					<div style={{ padding: "4px 10px 6px" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								height: 28,
								padding: "0 8px",
								background: "var(--bg-panel)",
								border: "1px solid var(--border)",
								borderRadius: 6,
							}}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--text-dim)"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ flexShrink: 0 }}
							>
								<circle cx="11" cy="11" r="8" />
								<line x1="21" y1="21" x2="16.65" y2="16.65" />
							</svg>
							<input
								ref={searchInputRef}
								value={sessionSearch}
								onChange={e => setSessionSearch(e.target.value)}
								onKeyDown={e => {
									if (e.key === "Escape") {
										if (sessionSearch) setSessionSearch("");
										else setSearchOpen(false);
									}
								}}
								placeholder={t("sidebar.display.searchPlaceholder")}
								aria-label={t("sidebar.display.searchPlaceholder")}
								style={{
									flex: 1,
									minWidth: 0,
									border: "none",
									outline: "none",
									background: "transparent",
									color: "var(--text)",
									fontSize: 12,
								}}
							/>
							{searching && (
								<button
									onClick={() => setSessionSearch("")}
									aria-label={t("sidebar.display.searchClear")}
									title={t("sidebar.display.searchClear")}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: 16,
										height: 16,
										padding: 0,
										flexShrink: 0,
										background: "none",
										border: "none",
										color: "var(--text-dim)",
										cursor: "pointer",
									}}
								>
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.4"
										strokeLinecap="round"
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							)}
							{searching && (
								<span
									style={{
										fontSize: 10,
										color: "var(--text-dim)",
										flexShrink: 0,
									}}
								>
									{searchTree.length}
								</span>
							)}
						</div>
					</div>
				)}
			</div>
			{/* PINNED — order-preserving pinned sessions, stale ids grayed out */}
			<PinnedSection
				pinnedSessions={pinnedSessions}
				stalePinnedIds={stalePinnedIds}
				selectedSessionId={selectedSessionId}
				runningSessionIds={runningSessionIds}
				unreadSessionIds={unreadSessionIds}
				editMode={multiSelect.enabled}
				selectedIds={multiSelect.selectedIds}
				onSelectSession={handleSelectSessionFromList}
				onToggleSelect={multiSelect.toggleItem}
				visibleIds={visibleSessionIds}
				onUnpin={togglePin}
				onArchive={id => void handleArchiveOne(id)}
				onDeleted={id => {
					onSessionDeleted?.(id);
					loadSessions();
				}}
			/>
			{/* RUNNING — live sessions pinned above the tree */}
			{runningSessionIds.size > 0 && (
				<div
					style={{
						flexShrink: 0,
						borderBottom: "1px solid var(--border)",
						padding: "6px 8px",
					}}
				>
					<div
						style={{
							fontSize: 10,
							fontWeight: 600,
							letterSpacing: "0.08em",
							color: "var(--text-dim)",
							marginBottom: 4,
						}}
					>
						{t("sidebar-running")}
					</div>
					{allSessions
						.filter(s => runningSessionIds.has(s.id))
						.slice(0, 6)
						.map(s => (
							<button
								key={s.id}
								onClick={() => handleSelectSessionFromList(s)}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									width: "100%",
									padding: "3px 4px",
									background: "none",
									border: "none",
									borderRadius: 5,
									color: "var(--text)",
									cursor: "pointer",
									fontSize: 11.5,
									textAlign: "left",
								}}
								title={sessionDisplayTitle(s, t)}
							>
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: "50%",
										flexShrink: 0,
										background: "var(--accent, #22c55e)",
										boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent, #22c55e) 22%, transparent)",
									}}
								/>
								<span
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{sessionDisplayTitle(s, t)}
								</span>
							</button>
						))}
				</div>
			)}
			{/* USAGE — today's cost/token micro-line; hidden while stats is down */}
			{usage && (
				<button
					onClick={() => window.open("/stats/", "_blank")}
					style={{
						flexShrink: 0,
						display: "flex",
						gap: 10,
						alignItems: "baseline",
						padding: "5px 12px",
						background: "none",
						border: "none",
						borderTop: "1px solid var(--border)",
						cursor: "pointer",
						color: "var(--text-muted)",
						fontSize: 10.5,
						textAlign: "left",
					}}
					title={t("sidebar-usage-open")}
				>
					<span style={{ fontWeight: 600, color: "var(--text-dim)" }}>{t("sidebar-usage-today")}</span>
					<span>${usage.totalCost.toFixed(2)}</span>
					<span>
						{usage.totalTokens >= 1000 ? `${(usage.totalTokens / 1000).toFixed(1)}k` : usage.totalTokens} tok
					</span>
					<span>
						{usage.totalRequests} {t("sidebar-usage-requests")}
					</span>
				</button>
			)}
			{/* Session list (projects; temp lives at the tail of the scroll area) */}
			<div
				style={{
					// flex-basis 0 + minHeight 0: the list must shrink to the space
					// below the header. With basis auto the natural content height
					// overflows the column and visually collides with the bottom bar.
					flex: "1 1 0",
					overflowY: "auto",
					padding: "0",
					minHeight: 0,
				}}
			>
				{!loading && !error && (
					<ProjectsSection
						onOpenWorkspace={() => setDropdownOpen(true)}
						onNewSession={() => void startNewSession(null)}
					/>
				)}
				{loading && (
					<div
						style={{
							padding: "16px 14px",
							color: "var(--text-muted)",
							fontSize: 12,
						}}
					>
						Loading...
					</div>
				)}
				{error && (
					<div
						style={{
							padding: "12px 14px",
							color: "var(--status-error-foreground)",
							fontSize: 12,
						}}
					>
						{error}
					</div>
				)}

				{!loading && !error && filteredSessions.length === 0 && (
					<div
						style={{
							padding: "16px 14px",
							color: "var(--text-muted)",
							fontSize: 12,
						}}
					>
						No sessions found
					</div>
				)}
				{!loading && !error && filteredSessions.length > 0 && searching && searchTree.length === 0 && (
					<div
						style={{
							padding: "16px 14px",
							color: "var(--text-muted)",
							fontSize: 12,
						}}
					>
						No sessions match &ldquo;{sessionSearch.trim()}&rdquo;
					</div>
				)}
				{!loading && !error && !searching ? (
					<SidebarProjectsList
						groups={workspaceGroups}
						selectedProject={selectedProject}
						collapsedProjects={collapsedProjects}
						onToggleCollapse={toggleProjectCollapsed}
						projectAliases={projectAliases}
						branchFor={project => {
							const wt = worktreeState;
							if (wt && wt.projectRoot === project) {
								const cur = wt.worktrees.find(w => w.path === selectedCwd) ?? wt.worktrees.find(w => w.isMain);
								return cur?.branch ?? null;
							}
							return null;
						}}
						onNewSessionInProject={project => void startNewSession(project)}
						onProjectContextMenu={(e, project) => {
							e.preventDefault();
							setProjMenu({ project, point: { x: e.clientX, y: e.clientY }, anchorRect: null });
						}}
						onProjectSortClick={e =>
							setProjSortMenu({ anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
						}
						onDeleteProjectSessions={project => requestProjectDelete(project)}
						onOpenTerminal={project => {
							void fetch("/api/open", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ target: "terminal", path: project }),
							}).catch(() => {});
						}}
						onSwitchProject={project => {
							setSelectedCwd(project);
							setDropdownOpen(false);
						}}
						renderProjectMenu={project =>
							confirmProjectDelete === null ? (
								<ProjectHeaderMenu
									project={project}
									count={visibleSessions.filter(s => (s.projectRoot ?? s.cwd) === project).length}
									onRenameAlias={project => setProjectAlias(project)}
									onTogglePin={project => toggleProjectPin(project)}
									pinned={pinnedProjects.includes(project)}
									onConfirmDelete={(p, count) => setConfirmProjectDelete({ project: p, count })}
								/>
							) : null
						}
						renderProjectSessions={project => (
							<SessionGroupSection
								nodes={projectTrees.get(project) ?? []}
								selectedSessionId={selectedSessionId}
								runningSessionIds={runningSessionIds}
								unreadSessionIds={unreadSessionIds}
								editMode={multiSelect.enabled}
								selectedIds={multiSelect.selectedIds}
								onSelectSession={handleSelectSessionFromList}
								onRenamed={loadSessions}
								onSessionDeleted={id => {
									onSessionDeleted?.(id);
									loadSessions();
								}}
								onToggleSelect={multiSelect.toggleItem}
								visibleIds={visibleSessionIds}
								onArchive={id => void handleArchiveOne(id)}
								pinnedIds={pinnedIdSet}
								onPinToggle={togglePin}
								onRowContextMenu={(e, session) =>
									setRowMenu({ session, point: { x: e.clientX, y: e.clientY }, anchorRect: null })
								}
							/>
						)}
						renderProjectFooter={project => (
							<EmptySessionsFold
								sessions={emptySessionsByProject.get(project) ?? []}
								onDelete={confirmEmptySessionDelete}
								onCleanup={confirmEmptySessionsCleanup}
							/>
						)}
					/>
				) : (
					!loading &&
					!error && (
						<SessionGroupSection
							nodes={searchTree}
							showCwd
							selectedSessionId={selectedSessionId}
							runningSessionIds={runningSessionIds}
							unreadSessionIds={unreadSessionIds}
							editMode={multiSelect.enabled}
							selectedIds={multiSelect.selectedIds}
							onSelectSession={handleSelectSessionFromList}
							onRenamed={loadSessions}
							onSessionDeleted={id => {
								onSessionDeleted?.(id);
								loadSessions();
							}}
							onToggleSelect={multiSelect.toggleItem}
							visibleIds={visibleSessionIds}
							onArchive={id => void handleArchiveOne(id)}
							pinnedIds={pinnedIdSet}
							onPinToggle={togglePin}
							onRowContextMenu={(e, session) =>
								setRowMenu({ session, point: { x: e.clientX, y: e.clientY }, anchorRect: null })
							}
						/>
					)
				)}
				{/* TEMP — throwaway sessions, collapsed by default, after the project groups */}
				{tempSessions.length > 0 && !searching && (
					<TempSection
						open={tempOpen}
						onToggleOpen={() => setTempOpen(v => !v)}
						sessions={sortedTempSessions}
						selectedSessionId={selectedSessionId}
						runningSessionIds={runningSessionIds}
						unreadSessionIds={unreadSessionIds}
						pinnedIds={pinnedIdSet}
						onSortMenu={rect => setTempSortMenu({ anchorRect: rect })}
						onNewSession={() => void startNewSession(tempSessions[0]?.cwd ?? null)}
						onClear={() =>
							setDangerConfirm({
								title: t("sidebar.tempClear"),
								body: t("sidebar.tempClearConfirm", { count: tempSessions.length }),
								confirmLabel: t("sidebar.tempClear"),
								action: () => purgeTempSessions(),
							})
						}
						onSelect={s => {
							setSelectedCwd(s.cwd);
							onSelectSession(s, false);
						}}
						onRenamed={loadSessions}
						onSessionDeleted={id => {
							onSessionDeleted?.(id);
							loadSessions();
						}}
						onArchive={id => void handleArchiveOne(id)}
						onPinToggle={togglePin}
						onRowMenu={(session, rect) =>
							setRowMenu({ session, point: null, anchorRect: rect })
						}
					/>
				)}
			</div>
			{/* Bulk action bar (edit mode, non-empty selection) */}
			<BulkActionBar
				count={multiSelect.selectedIds.size}
				visibleCount={visibleSessionIds.length}
				onSelectAllVisible={() => multiSelect.selectAll(visibleSessionIds)}
				onBulkDelete={() => void handleBulkDelete()}
				onBulkArchive={() => void handleBulkArchive()}
				onExit={() => multiSelect.setEnabled(false)}
			/>
			{/* ARCHIVED — in-sidebar collapsed archive with restore/delete */}
			<ArchiveSection
				archivedSessions={archivedSessions}
				onChanged={() => void Promise.all([loadSessions(), loadArchived()])}
			/>
			{/* File Explorer section */}
			{(selectedCwdProp || selectedCwd) && (
				<div
					style={{
						borderTop: "1px solid var(--border)",
						display: "flex",
						flexDirection: "column",
						flex: explorerOpen ? "1 1 0" : "0 0 auto",
						minHeight: 0,
						overflow: "hidden",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
						<button
							onClick={() => setExplorerOpen(v => !v)}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								flex: 1,
								padding: "6px 10px",
								background: "none",
								border: "none",
								color: "var(--text-muted)",
								cursor: "pointer",
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: "0.05em",
								textTransform: "uppercase",
								textAlign: "left",
							}}
						>
							<svg
								width="9"
								height="9"
								viewBox="0 0 10 10"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{
									transform: explorerOpen ? "rotate(90deg)" : "none",
									transition: "transform 0.15s",
									flexShrink: 0,
								}}
							>
								<polyline points="3 2 7 5 3 8" />
							</svg>
							Explorer
						</button>
						{explorerOpen && changesCount > 0 && (
							<ToolbarIconButton
								onClick={() => setChangesCollapsed(v => !v)}
								title={t("sidebar.changedFiles", { count: changesCount })}
								ariaPressed={!changesCollapsed}
								color={changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
								background={changesCollapsed ? "none" : "var(--bg-selected)"}
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<circle cx="12" cy="12" r="3" />
									<path d="M3 12h6" />
									<path d="M15 12h6" />
								</svg>
							</ToolbarIconButton>
						)}
						{explorerOpen && (
							<ToolbarIconButton
								onClick={() => fileExplorerRef.current?.openUploadPicker()}
								disabled={explorerUploadBusy}
								title={t("sidebar.uploadFilesTitle")}
								color="var(--text-dim)"
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
									<path d="m17 8-5-5-5 5" />
									<path d="M12 3v12" />
								</svg>
							</ToolbarIconButton>
						)}
						<ToolbarIconButton
							onClick={() => {
								if (onExplorerRefresh) onExplorerRefresh();
								else setExplorerKey(k => k + 1);
								setExplorerRefreshDone(true);
								if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
								explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
							}}
							title={t("sidebar.refreshExplorer")}
							skipHover={explorerRefreshDone}
							color={explorerRefreshDone ? "var(--status-success)" : "var(--text-dim)"}
							background={explorerRefreshDone ? "var(--status-success-background)" : "none"}
							marginRight={6}
						>
							{explorerRefreshDone ? (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="var(--status-success)"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : (
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
									<path d="M3 3v5h5" />
								</svg>
							)}
						</ToolbarIconButton>
					</div>
					{explorerOpen && (
						<div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
							<FileExplorer
								ref={fileExplorerRef}
								cwd={selectedCwd ?? selectedCwdProp!}
								onOpenFile={onOpenFile ?? (() => {})}
								refreshKey={explorerKey}
								onAtMention={onAtMention}
								onAtMentions={onAtMentions}
								onUploadBusyChange={setExplorerUploadBusy}
								changesCollapsed={changesCollapsed}
								onChangesCountChange={setChangesCount}
							/>
						</div>
					)}
				</div>
			)}
			{confirmProjectDelete && (
				<div
					role="dialog"
					aria-modal="true"
					onClick={() => setConfirmProjectDelete(null)}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 400,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "var(--surface-overlay)",
					}}
				>
					<div
						onClick={e => e.stopPropagation()}
						style={{
							minWidth: 320,
							maxWidth: 420,
							background: "var(--bg-elevated, var(--bg))",
							border: "1px solid var(--border)",
							borderRadius: 10,
							padding: 16,
							boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
							{t("sidebar.deleteProjectSessions")}
						</div>
						<div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
							{t("sidebar.deleteProjectConfirm", { count: confirmProjectDelete.count })}
							<div
								title={confirmProjectDelete.project}
								style={{
									marginTop: 4,
									fontFamily: "var(--font-mono)",
									fontSize: 11,
									color: "var(--text-dim)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{confirmProjectDelete.project}
							</div>
						</div>
						<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
							<button
								onClick={() => setConfirmProjectDelete(null)}
								style={{
									padding: "6px 12px",
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 6,
									color: "var(--text-muted)",
									fontSize: 12,
									cursor: "pointer",
								}}
							>
								{t("cancel")}
							</button>
							<button
								onClick={() => {
									const target = confirmProjectDelete.project;
									setConfirmProjectDelete(null);
									void deleteProjectSessions(target)
										.then(() => loadSessions())
										.catch(() => {});
								}}
								style={{
									padding: "6px 12px",
									background: "var(--status-error)",
									border: "none",
									borderRadius: 6,
									color: "var(--status-error-foreground)",
									fontSize: 12,
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								{t("sidebar.delete")}
							</button>
						</div>
					</div>
				</div>
			)}
			{dangerConfirm && (
				<div
					role="dialog"
					aria-modal="true"
					onClick={() => setDangerConfirm(null)}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 410,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "var(--surface-overlay)",
					}}
				>
					<div
						onClick={e => e.stopPropagation()}
						style={{
							minWidth: 320,
							maxWidth: 420,
							background: "var(--bg-elevated, var(--bg))",
							border: "1px solid var(--border)",
							borderRadius: 10,
							padding: 16,
							boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
						}}
					>
						<div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
							{dangerConfirm.title}
						</div>
						<div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
							{dangerConfirm.body}
							{dangerConfirm.detail && (
								<div
									title={dangerConfirm.detail}
									style={{
										marginTop: 4,
										fontFamily: "var(--font-mono)",
										fontSize: 11,
										color: "var(--text-dim)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{dangerConfirm.detail}
								</div>
							)}
						</div>
						<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
							<button
								onClick={() => setDangerConfirm(null)}
								style={{
									padding: "6px 12px",
									background: "var(--bg-hover)",
									border: "1px solid var(--border)",
									borderRadius: 6,
									color: "var(--text-muted)",
									fontSize: 12,
									cursor: "pointer",
								}}
							>
								{t("cancel")}
							</button>
							<button
								className="ze-btn"
								onClick={() => {
									const action = dangerConfirm.action;
									setDangerConfirm(null);
									void action();
								}}
								style={{
									padding: "6px 12px",
									borderRadius: 6,
									fontSize: 12,
									color: "var(--status-error)",
									borderColor: "color-mix(in srgb, var(--status-error) 50%, var(--border))",
								}}
							>
								{dangerConfirm.confirmLabel}
							</button>
						</div>
					</div>
				</div>
			)}
			<FolderPickerModal
				open={folderPickerModalOpen}
				initialPath={selectedCwd}
				onSelect={path => {
					setFolderPickerModalOpen(false);
					void commitCustomPath(path);
				}}
				onClose={() => setFolderPickerModalOpen(false)}
			/>{" "}
			{/* Open-workspace dialog — project list + source actions (replaces the permanent path picker) */}
			{dropdownOpen && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Open workspace"
					onMouseDown={e => {
						if (e.target === e.currentTarget) setDropdownOpen(false);
					}}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 90,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "color-mix(in srgb, var(--bg) 55%, transparent)",
						backdropFilter: "blur(2px)",
					}}
				>
					<div
						style={{
							width: 420,
							maxWidth: "calc(100vw - 32px)",
							maxHeight: "min(70vh, 560px)",
							display: "flex",
							flexDirection: "column",
							background: "var(--bg)",
							border: "1px solid var(--border)",
							borderRadius: 10,
							boxShadow: "var(--surface-shadow)",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								padding: "10px 12px",
								borderBottom: "1px solid var(--border)",
								fontSize: 12.5,
								fontWeight: 600,
								color: "var(--text)",
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}
						>
							{t("sidebar.openWorkspace")}
							<button
								aria-label="Close"
								onClick={() => setDropdownOpen(false)}
								style={{
									background: "none",
									border: "none",
									color: "var(--text-dim)",
									cursor: "pointer",
									fontSize: 14,
									lineHeight: 1,
									padding: 2,
								}}
							>
								✕
							</button>
						</div>

						{showProjectFilter && (
							<div
								style={{
									padding: "6px 8px",
									borderBottom: "1px solid var(--border)",
								}}
							>
								<input
									value={projectFilter}
									onChange={e => setProjectFilter(e.target.value)}
									onKeyDown={e => {
										if (e.key === "Escape") {
											setProjectFilter("");
											setDropdownOpen(false);
										}
									}}
									placeholder={t("filter-projects")}
									autoFocus
									style={{
										width: "100%",
										fontSize: 11,
										fontFamily: "var(--font-mono)",
										padding: "5px 8px",
										border: "1px solid var(--border)",
										borderRadius: 5,
										outline: "none",
										background: "var(--bg)",
										color: "var(--text)",
										boxSizing: "border-box",
									}}
								/>
							</div>
						)}
						{/* Default workspace — always the first entry */}
						<button
							onClick={e => {
								e.stopPropagation();
								void handleDefaultCwd();
								setDropdownOpen(false);
							}}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 7,
								width: "100%",
								padding: "7px 10px",
								background: "var(--bg)",
								border: "none",
								borderBottom: "1px solid var(--border)",
								color: "var(--text)",
								cursor: "pointer",
								textAlign: "left",
							}}
							title={t("sidebar.default-workspace")}
						>
							<svg
								width="11"
								height="11"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--accent)"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ flexShrink: 0 }}
							>
								<path d="M3 9.5L12 3l9 6.5V21H3z" />
							</svg>
							<span style={{ fontSize: 11.5, fontWeight: 600 }}>{t("sidebar.default-workspace")}</span>
						</button>
						<div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
							{visibleProjects.map(project => {
								const active = project === selectedProject;
								return (
									<button
										key={project}
										onClick={() => {
											setSelectedCwd(project);
											setProjectFilter("");
											setCustomPathOpen(false);
											setCustomPathValue("");
											setCustomPathError(null);
											setDropdownOpen(false);
										}}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 7,
											width: "100%",
											padding: "7px 10px",
											background: active ? "var(--bg-selected)" : "var(--bg)",
											border: "none",
											borderBottom: "1px solid var(--border)",
											color: active ? "var(--text)" : "var(--text-muted)",
											cursor: "pointer",
											textAlign: "left",
										}}
										title={project}
									>
										<span style={{ width: 10, flexShrink: 0, display: "flex" }}>
											{active && (
												<svg
													width="10"
													height="10"
													viewBox="0 0 10 10"
													fill="none"
													stroke="var(--accent)"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<polyline points="1.5 5 4 7.5 8.5 2.5" />
												</svg>
											)}
										</span>
										<span
											style={{
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 1,
											}}
										>
											<span
												style={{
													fontSize: 11.5,
													fontWeight: 600,
													color: "var(--text)",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{getFileName(project)}
											</span>
											<PathLabel
												text={displayCwd(project, homeDir)}
												style={{ fontSize: 10, color: "var(--text-muted)" }}
											/>
										</span>
									</button>
								);
							})}
							{visibleProjects.length === 0 && projectFilter.trim() && (
								<div
									style={{
										padding: "8px 10px",
										fontSize: 11,
										color: "var(--text-dim)",
									}}
								>
									{t("no-matching-projects")}
								</div>
							)}
						</div>

						{/* Workspace source actions — compact single row */}
						<div
							style={{
								display: "flex",
								borderTop: "1px solid var(--border)",
								background: "var(--bg)",
							}}
						>
							{[
								{
									key: "default",
									label: t("use-default-directory"),
									visible: !customPathOpen,
									color: "var(--text-muted)" as string,
									icon: (
										<svg
											width="10"
											height="10"
											viewBox="0 0 10 10"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.1"
											strokeLinecap="round"
											strokeLinejoin="round"
											style={{ flexShrink: 0 }}
										>
											<path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
										</svg>
									),
									onClick: (e: React.MouseEvent) => {
										e.stopPropagation();
										void handleDefaultCwd();
									},
								},
								{
									key: "browse",
									label: t("browse-folder-ide-style"),
									visible: !customPathOpen,
									color: "var(--accent)" as string,
									icon: (
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
											style={{ flexShrink: 0 }}
										>
											<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
										</svg>
									),
									onClick: (e: React.MouseEvent) => {
										e.stopPropagation();
										setDropdownOpen(false);
										setFolderPickerModalOpen(true);
									},
								},
								{
									key: "custom",
									label: t("custom-path"),
									visible: true,
									color: "var(--text-muted)" as string,
									icon: (
										<svg
											width="10"
											height="10"
											viewBox="0 0 10 10"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.1"
											strokeLinecap="round"
											style={{ flexShrink: 0 }}
										>
											<line x1="5" y1="1" x2="5" y2="9" />
											<line x1="1" y1="5" x2="9" y2="5" />
										</svg>
									),
									onClick: (e: React.MouseEvent) => {
										e.stopPropagation();
										handleCustomPathClick();
									},
								},
							]
								.filter(action => action.visible)
								.map(action => (
									<button
										key={action.key}
										onClick={action.onClick}
										title={action.label}
										style={{
											flex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											gap: 5,
											padding: "7px 4px",
											background: "none",
											border: "none",
											color: action.color,
											cursor: "pointer",
											fontSize: 10.5,
											minWidth: 0,
										}}
									>
										{action.icon}
										<span
											style={{
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{action.label}
										</span>
									</button>
								))}
						</div>
					</div>
				</div>
			)}
			{/* P2 floating menus + palette + hover card (portal-rendered) */}
			<FloatingMenu
				open={rowMenu !== null}
				point={rowMenu?.point ?? null}
				anchorRect={rowMenu?.anchorRect ?? null}
				onClose={() => setRowMenu(null)}
				label={t("sidebar.worktreeMenu")}
				items={(() => {
					const s = rowMenu?.session;
					if (!s) return [] as FloatingMenuItem[];
					return [
						{
							key: "rename",
							label: t("sidebar.rename"),
							onSelect: () =>
								void renameSession(s.id, s.name ?? "")
									.then(() => loadSessions())
									.catch(() => {}),
						},
						{
							key: "pin",
							label: pinnedIdSet.has(s.id) ? t("sidebar.unpin") : t("sidebar.pin"),
							onSelect: () => togglePin(s.id),
						},
						{
							key: "archive",
							label: t("sidebar.archive"),
							onSelect: () =>
								setDangerConfirm({
									title: t("sidebar.archiveSession"),
									body: t("sidebar.archiveSessionConfirm", { name: sessionDisplayTitle(s, t) }),
									confirmLabel: t("sidebar.archive"),
									action: () => handleArchiveOne(s.id),
								}),
						},
						{
							key: "copyid",
							label: t("sidebar.copySessionId"),
							onSelect: () => void navigator.clipboard?.writeText(s.id).catch(() => {}),
						},
						{
							key: "delete",
							label: t("sidebar.delete"),
							danger: true,
							onSelect: () =>
								setDangerConfirm({
									title: t("sidebar.deleteSessionTitle"),
									body: t("sidebar.deleteSessionConfirm", { name: sessionDisplayTitle(s, t) }),
									detail: s.id,
									confirmLabel: t("sidebar.delete"),
									action: async () => {
										await deleteSessions([s.id]);
										onSessionDeleted?.(s.id);
										await loadSessions();
									},
								}),
						},
					];
				})()}
			/>
			<FloatingMenu
				open={projMenu !== null}
				point={projMenu?.point ?? null}
				anchorRect={projMenu?.anchorRect ?? null}
				onClose={() => setProjMenu(null)}
				label={t("sidebar.worktreeMenu")}
				items={(() => {
					const project = projMenu?.project;
					if (!project) return [] as FloatingMenuItem[];
					return [
						{
							key: "terminal",
							label: t("sidebar.openTerminal"),
							onSelect: () =>
								void fetch("/api/open", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({ target: "terminal", path: project }),
								}).catch(() => {}),
						},
						{ key: "rename", label: t("sidebar.renameProject"), onSelect: () => setProjectAlias(project) },
						{
							key: "pin",
							label: pinnedProjects.includes(project) ? t("sidebar.unpinProject") : t("sidebar.pinProject"),
							onSelect: () => toggleProjectPin(project),
						},
						{
							key: "delete",
							label: t("sidebar.deleteProjectSessions"),
							danger: true,
							onSelect: () => requestProjectDelete(project),
						},
					];
				})()}
			/>
			<FloatingMenu
				open={tempSortMenu !== null}
				anchorRect={tempSortMenu?.anchorRect ?? null}
				onClose={() => setTempSortMenu(null)}
				label={t("sidebar.sessionSort")}
				items={(["recent", "created", "oldest", "name"] as SessionSort[]).map(mode => ({
					key: mode,
					label: t(`sidebar.sort.${mode}`),
					checked: tempSort === mode,
					onSelect: () => {
						setTempSort(mode);
						updatePrefs(p => {
							p.sessionView.sort = mode;
						});
					},
				}))}
			/>
			<FloatingMenu
				open={projSortMenu !== null}
				anchorRect={projSortMenu?.anchorRect ?? null}
				onClose={() => setProjSortMenu(null)}
				label={t("sidebar.display.projectSort")}
				items={(["recent", "created", "oldest", "name", "manual"] as ProjectSort[]).map(mode => ({
					key: mode,
					label: t(`sidebar.sort.${mode}`),
					checked: projSort === mode,
					onSelect: () => {
						setProjSort(mode);
						updatePrefs(p => {
							p.projectSort = mode;
						});
					},
				}))}
			/>
			<SearchDialog
				open={searchDialogOpen}
				sessions={allSessions}
				commands={[
					{ key: "workspace", label: t("sidebar.openWorkspace"), run: () => setDropdownOpen(true) },
					...(onOpenSkills ? [{ key: "skills", label: t("skills"), run: () => onOpenSkills() }] : []),
					{ key: "draft", label: t("sidebar.newTempSession"), run: () => void startNewSession(tempSessions[0]?.cwd ?? null) },
				]}
				onClose={() => setSearchDialogOpen(false)}
				onSelectSession={s => {
					setSelectedCwd(s.cwd);
					onSelectSession(s, false);
				}}
				onNewSession={() => void startNewSession(selectedProject)}
			/>
		</div>
	);
}

/**
 * Temp-session section (D7): collapsed by default, pinned after the project
 * groups. Header actions (↑↓ sort / + new / clear) surface on hover like the
 * project group headers; rows reuse SessionNodeItem so rename/delete/pin/
 * archive behave identically to project rows.
 */
function TempSection({
	open,
	onToggleOpen,
	sessions,
	selectedSessionId,
	runningSessionIds,
	unreadSessionIds,
	pinnedIds,
	onSortMenu,
	onNewSession,
	onClear,
	onSelect,
	onRenamed,
	onSessionDeleted,
	onArchive,
	onPinToggle,
	onRowMenu,
}: {
	open: boolean;
	onToggleOpen: () => void;
	sessions: SessionInfo[];
	selectedSessionId: string | null;
	runningSessionIds: ReadonlySet<string>;
	unreadSessionIds: ReadonlySet<string>;
	pinnedIds: ReadonlySet<string>;
	onSortMenu: (rect: DOMRect) => void;
	onNewSession: () => void;
	onClear: () => void;
	onSelect: (s: SessionInfo) => void;
	onRenamed: () => void;
	onSessionDeleted: (id: string) => void;
	onArchive: (id: string) => void;
	onPinToggle: (id: string) => void;
	onRowMenu: (session: SessionInfo, rect: DOMRect) => void;
}) {
	const { t } = useI18n();
	const [active, setActive] = useState(false);
	return (
		<div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
			<div
				onMouseEnter={() => setActive(true)}
				onMouseLeave={() => setActive(false)}
				onFocus={() => setActive(true)}
				onBlur={e => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) setActive(false);
				}}
				style={{ display: "flex", alignItems: "center", width: "100%" }}
			>
				<button
					onClick={onToggleOpen}
					aria-expanded={open}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flex: 1,
						minWidth: 0,
						padding: "6px 0 6px 14px",
						background: "none",
						border: "none",
						color: "var(--text-dim)",
						cursor: "pointer",
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textAlign: "left",
					}}
				>
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.12s", flexShrink: 0 }}
					>
						<polyline points="2.5 3.5 5 6.5 7.5 3.5" />
					</svg>
					{t("sidebar.tempSection")}
					<span>({sessions.length})</span>
				</button>
				<span
					style={{
						display: "flex",
						alignItems: "center",
						gap: 2,
						marginRight: 8,
						flexShrink: 0,
						opacity: active ? 1 : 0,
						transition: "opacity 0.12s",
						pointerEvents: active ? "auto" : "none",
					}}
					onClick={e => e.stopPropagation()}
				>
					<button
						aria-label={t("sidebar.sessionSort")}
						title={t("sidebar.sessionSort")}
						style={{ fontSize: 10, padding: "1px 5px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
						onClick={e => {
							e.stopPropagation();
							onSortMenu(e.currentTarget.getBoundingClientRect());
						}}
					>
						↑↓
					</button>
					<button
						aria-label={t("sidebar.actions.newSession")}
						title={t("sidebar.actions.newSession")}
						style={{ padding: "1px 6px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
						onClick={e => {
							e.stopPropagation();
							onNewSession();
						}}
					>
						+
					</button>
					<button
						aria-label={t("sidebar.tempClear")}
						title={t("sidebar.tempClear")}
						style={{ padding: "1px 4px", background: "none", border: "none", color: "var(--status-error)", cursor: "pointer", fontSize: 10.5 }}
						onClick={e => {
							e.stopPropagation();
							onClear();
						}}
					>
						{t("sidebar.tempClear")}
					</button>
				</span>
			</div>
			{open && (
				<div style={{ maxHeight: "30vh", overflowY: "auto" }}>
					{sessions.map(s => (
						<SessionNodeItem
							key={s.id}
							session={s}
							isSelected={s.id === selectedSessionId}
							isRunning={runningSessionIds.has(s.id)}
							isUnread={unreadSessionIds.has(s.id)}
							onClick={() => onSelect(s)}
							onRenamed={onRenamed}
							onDeleted={onSessionDeleted}
							onArchive={() => onArchive(s.id)}
							pinned={pinnedIds.has(s.id)}
							onPinToggle={() => onPinToggle(s.id)}
							onRowContextMenu={e => onRowMenu(s, e.currentTarget.getBoundingClientRect())}
						/>
					))}
				</div>
			)}
		</div>
	);
}
