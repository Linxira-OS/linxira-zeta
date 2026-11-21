/**
 * Studio page operations → Zeta gateway endpoints.
 *
 * The ported Studio components call `client.query(name)` / `client.command(name)`
 * with Studio's operation names. This module is the **only** place those names
 * become HTTP: every handler is a plain `fetch` against a gateway family the
 * Next.js rewrites / request-time proxies already publish.
 *
 * Two rules:
 *  1. A name whose data Zeta does not have is **absent** from the map; the
 *     client then raises `UnsupportedStudioOperationError`, which is how a
 *     surface disappears instead of painting fixtures.
 *  2. Read models are Studio's shapes, built from Zeta DTOs. Fields Zeta does
 *     not compute stay neutral and are called out in the handler comment.
 */

import type {
	CommandHandle,
	CommandInput,
	CommandName,
	CommandReceipt,
	CommandRequestId,
	GitBranchListReadModel,
	GitDiffReadModel,
	GitExecuteInput,
	GitFileChange,
	GitFileState,
	GitLogListReadModel,
	GitLogRef,
	GitOperationResult,
	GitRepositoryReadModel,
	GitWorktreeListReadModel,
	GitWorktreeRecord,
	HistoryEntryId,
	PluginRecord,
	QueryName,
	SessionHistoryEntry,
	SessionHistoryReadModel,
	SkillRecord,
	StatsDashboardReadModel,
	ThreadId,
	WorkspaceId,
} from "@/lib/studio-protocol/contract";
import type { CommandHandler, QueryHandler } from "@/lib/studio-client";

/** The subset of the client transport handlers need. */
export interface PagesTransport {
	get<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
	post<T>(path: string, body?: unknown): Promise<T>;
	requestJson<T>(method: string, path: string, body?: unknown): Promise<T>;
	readonly cwd: string | null;
	readonly sessionId: string | null;
}

/** Where a command handler parks its terminal receipt for `waitReceipt`. */
export interface ReceiptStore {
	record<TName extends CommandName>(name: TName, result: unknown): CommandHandle<TName>;
	fail<TName extends CommandName>(name: TName, error: unknown): CommandHandle<TName>;
}

// ---------------------------------------------------------------------------
// Zeta DTOs (mirrors of the gateway responses this module reads)
// ---------------------------------------------------------------------------

interface GitStatusFileDto {
	filePath: string;
	status: string;
	code?: string;
	indexStatus?: string;
	worktreeStatus?: string;
}

interface GitStatusDto {
	isGitRepository: boolean;
	repositoryRoot: string | null;
	files: GitStatusFileDto[];
	additions: number;
	deletions: number;
}

interface GitBranchDto {
	name: string;
	current: boolean;
}

interface GitLogDto {
	commits?: ReadonlyArray<{
		sha?: string;
		oid?: string;
		subject?: string;
		author?: string;
		authorName?: string;
		date?: string;
		authorDate?: string;
		parents?: readonly string[];
		refs?: readonly string[];
	}>;
}

interface WorktreeDto {
	path: string;
	branch: string | null;
	isMain: boolean;
}

interface WorktreesDto {
	projectRoot: string;
	isGit: boolean;
	isTopLevel: boolean;
	worktrees: WorktreeDto[];
}

interface SessionDto {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage?: string;
}

interface SkillDto {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
	sourceInfo?: { source?: string; scope?: string };
	install?: { scope?: string };
}

interface SkillsDto {
	skills: SkillDto[];
	diagnostics?: ReadonlyArray<{ type: string; message: string }>;
}

interface PluginResourceDto {
	kind: "extension" | "skill" | "prompt" | "theme";
	name: string;
}

interface PluginPackageDto {
	source: string;
	scope: "global" | "project";
	disabled: boolean;
	packageName?: string;
	version?: string;
	status: "loaded" | "installed" | "missing" | "disabled";
	counts: { extensions: number; skills: number; prompts: number; themes: number };
	resources: PluginResourceDto[];
}

interface PluginsDto {
	packages: PluginPackageDto[];
	diagnostics?: ReadonlyArray<{ type: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Git mapping
// ---------------------------------------------------------------------------

const GIT_STATE_BY_CHAR: Record<string, GitFileState> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "copied",
	U: "conflicted",
	T: "modified",
};

function stateOf(code: string | undefined): GitFileState {
	if (!code) return "unmodified";
	return GIT_STATE_BY_CHAR[code.trim().charAt(0).toUpperCase()] ?? "unmodified";
}

/** Zeta reports one status per file; split it into Studio's index/worktree pair. */
function toChange(file: GitStatusFileDto): GitFileChange {
	const conflicted = file.status === "conflict";
	if (conflicted) return { path: file.filePath.replaceAll("\\", "/"), index: "conflicted", worktree: "conflicted", conflicted };
	if (file.status === "untracked") {
		return { path: file.filePath.replaceAll("\\", "/"), index: "unmodified", worktree: "untracked", conflicted: false };
	}
	return {
		path: file.filePath.replaceAll("\\", "/"),
		index: stateOf(file.indexStatus),
		worktree: stateOf(file.worktreeStatus),
		conflicted: false,
	};
}

async function readRepository(t: PagesTransport, workspaceId: WorkspaceId): Promise<GitRepositoryReadModel> {
	const cwd = String(workspaceId);
	const [status, branches] = await Promise.all([
		t.get<GitStatusDto>("/api/git/status", { cwd }),
		t.get<{ current?: string | null }>("/api/git/branches", { cwd }).catch(() => ({ current: null })),
	]);
	const branch = branches.current ?? undefined;
	return {
		workspaceId,
		isRepository: status.isGitRepository,
		...(status.repositoryRoot ? { repositoryId: status.repositoryRoot as never } : {}),
		...(branch ? { branch } : {}),
		detached: status.isGitRepository && branch === undefined,
		unborn: false,
		// `/api/git/status` carries working-tree line totals but no upstream
		// divergence or stash count, so those stay at zero rather than guess.
		ahead: 0,
		behind: 0,
		stashCount: 0,
		changes: status.files.map(toChange),
		insertions: status.additions,
		deletions: status.deletions,
		...(status.isGitRepository ? {} : { unavailableReason: "not a git repository" }),
	};
}

function splitRefs(refs: ReadonlyArray<string> | undefined): GitLogRef[] {
	if (!refs) return [];
	return refs
		.map(ref => ref.trim())
		.filter(Boolean)
		.map(ref => ({
			name: ref.replace(/^HEAD -> /, "").replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, ""),
			kind: ref.startsWith("tag:") ? ("tag" as const) : ref.includes("/") ? ("remote" as const) : ("local" as const),
			current: ref.startsWith("HEAD"),
		}));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Build the query handlers for one transport.
 *
 * Operations Zeta cannot answer are absent on purpose:
 *   `git.commit.changes`, `git.commit.diff`, `git.remotes.list`,
 *   `git.toolchain.get`, `github.*`, `mcp.*`, `models.get`, `usage.get`,
 *   `environment.get`, `diagnostics.get`.
 */
export function createQueries(t: PagesTransport): Partial<Record<QueryName, QueryHandler>> {
	return {
		"git.repository.get": (async input => readRepository(t, input.workspaceId)) as QueryHandler<"git.repository.get">,

		"git.diff.get": (async input => {
			const cwd = String(input.workspaceId);
			const absolute = /^[A-Za-z]:[\\/]|^\//.test(input.path) ? input.path : `${cwd}/${input.path}`;
			const body = await t.get<{ supported: boolean; patch?: string }>("/api/git/diff", { cwd, path: absolute });
			const patch = body.patch ?? "";
			return {
				workspaceId: input.workspaceId,
				path: input.path,
				// `/api/git/diff` diffs the file against HEAD — the union of staged
				// and working changes — so both Studio targets read from it.
				target: input.target,
				patch,
				binary: false,
				truncated: false,
				revision: "",
			} satisfies GitDiffReadModel;
		}) as QueryHandler<"git.diff.get">,

		"git.branches.list": (async input => {
			const body = await t.get<{ isGitRepository?: boolean; branches?: GitBranchDto[] }>("/api/git/branches", {
				cwd: String(input.workspaceId),
			});
			return {
				workspaceId: input.workspaceId,
				branches: (body.branches ?? []).map(branch => ({
					name: branch.name,
					remote: false,
					current: branch.current,
					// The endpoint answers names only and the OID is not displayed,
					// so it stays empty instead of being invented.
					headOid: "",
					ahead: 0,
					behind: 0,
				})),
			} satisfies GitBranchListReadModel;
		}) as QueryHandler<"git.branches.list">,

		"git.worktrees.list": (async input => {
			const cwd = String(input.workspaceId);
			const body = await t.get<WorktreesDto>("/api/worktrees", { cwd });
			const worktrees: GitWorktreeRecord[] = body.worktrees.map(entry => ({
				worktreeId: entry.path as never,
				name: entry.path.replaceAll("\\", "/").split("/").pop() ?? entry.path,
				...(entry.branch ? { branch: entry.branch } : {}),
				current: entry.path === cwd,
				detached: entry.branch === null,
				bare: false,
				locked: false,
				prunable: false,
				workspaceId: entry.path as never,
			}));
			return { workspaceId: input.workspaceId, rootConfigured: body.isGit, worktrees } satisfies GitWorktreeListReadModel;
		}) as QueryHandler<"git.worktrees.list">,

		// `/api/git/log` answers `{ commits: [{ sha, subject }], hasMore }` from
		// `git log --oneline`: one row per commit with no parents/refs, so the
		// graph draws a straight lane and the commit detail panes stay absent.
		"git.log.list": (async input => {
			const body = await t.get<GitLogDto>("/api/git/log", {
				cwd: String(input.workspaceId),
				limit: input.limit ?? 80,
				skip: input.skip ?? 0,
			});
			const commits = (body.commits ?? []).map(commit => ({
				oid: commit.oid ?? commit.sha ?? "",
				parents: commit.parents ?? [],
				subject: commit.subject ?? "",
				authorName: commit.authorName ?? commit.author ?? "",
				authorDate: commit.authorDate ?? commit.date ?? "",
				refs: splitRefs(commit.refs),
				relation: "common" as const,
			}));
			return {
				workspaceId: input.workspaceId,
				commits,
				truncated: false,
				...(commits[0] ? { headOid: commits[0].oid } : {}),
				ahead: 0,
				behind: 0,
			} satisfies GitLogListReadModel;
		}) as QueryHandler<"git.log.list">,

		"history.list": (async input => {
			const status = input.status ?? "active";
			const list =
				status === "archived"
					? await t.get<{ sessions?: SessionDto[] }>("/api/sessions/archived").then(body => body.sessions ?? [])
					: await t.get<{ sessions?: SessionDto[] }>("/api/sessions").then(body => body.sessions ?? []);
			const entries: SessionHistoryEntry[] = list
				.filter(row => (input.workspaceId ? row.cwd === String(input.workspaceId) : true))
				.map(row => ({
					historyId: row.path as HistoryEntryId,
					threadId: row.id as ThreadId,
					environmentId: row.cwd as never,
					sessionId: row.id as never,
					...(row.name ? { title: row.name } : {}),
					...(row.firstMessage ? { summary: row.firstMessage } : {}),
					startedAt: row.created,
					lastActiveAt: row.modified,
					messageCount: row.messageCount,
					status,
				}))
				.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
			return { entries: input.limit ? entries.slice(0, input.limit) : entries, total: entries.length } satisfies SessionHistoryReadModel;
		}) as QueryHandler<"history.list">,

		"skills.get": (async () => {
			const cwd = t.cwd ?? undefined;
			const [skillsBody, pluginsBody] = await Promise.all([
				t.get<SkillsDto>("/api/skills", { cwd }).catch(() => ({ skills: [] }) as SkillsDto),
				t.get<PluginsDto>("/api/plugins", { cwd }).catch(() => ({ packages: [] }) as PluginsDto),
			]);
			const skills: SkillRecord[] = skillsBody.skills.map(skill => ({
				name: skill.name,
				desc: skill.description,
				scope: skill.install?.scope === "project" ? "workspace" : "global",
				sourceKind: skill.install ? "managed" : "native",
				sourceLabel: skill.sourceInfo?.source ?? skill.sourceInfo?.scope ?? (skill.install ? "managed" : "native"),
				enabled: !skill.disableModelInvocation,
				hide: false,
			}));
			const plugins: PluginRecord[] = pluginsBody.packages.map(entry => {
				const of = (kind: PluginResourceDto["kind"]) =>
					entry.resources.filter(resource => resource.kind === kind).map(resource => resource.name);
				return {
					name: entry.packageName ?? entry.source,
					version: entry.version ?? "",
					// Zeta's plugin loader reads npm/link package sources and does not
					// distinguish marketplace or git installs.
					sourceKind: "npm",
					srcLabel: entry.scope,
					enabled: !entry.disabled,
					status: entry.status === "missing" ? "error" : "configured",
					tools: entry.counts.extensions,
					commands: entry.counts.prompts,
					hooks: 0,
					ui: entry.resources.some(resource => resource.kind === "theme"),
					toolItems: of("extension"),
					commandItems: of("prompt"),
					hookItems: [],
					uiItems: of("theme"),
				};
			});
			return {
				skills,
				plugins,
				warnings: [
					...(skillsBody.diagnostics ?? []).map(entry => entry.message),
					...(pluginsBody.diagnostics ?? []).map(entry => entry.message),
				],
				generatedAt: new Date().toISOString(),
			};
		}) as QueryHandler<"skills.get">,

		"stats.dashboard": (async () => {
			const body = await t.get<{ url?: string }>("/api/webui/stats-url");
			return (body.url
				? { available: true, url: body.url }
				: { available: false, reason: "stats dashboard is not running" }) satisfies StatsDashboardReadModel;
		}) as QueryHandler<"stats.dashboard">,
	} as Partial<Record<QueryName, QueryHandler>>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const GIT_OPERATION_PATH: Partial<Record<GitExecuteInput["operation"]["kind"], string>> = {
	stage: "/api/git/stage",
	unstage: "/api/git/unstage",
	commit: "/api/git/commit",
	fetch: "/api/git/fetch",
	pull: "/api/git/pull",
	push: "/api/git/push",
	checkout: "/api/git/checkout",
	"branch.create": "/api/git/branch",
	"branch.switch": "/api/git/checkout",
};

/** Body translation per operation. Only fields the gateway handlers read. */
function gitOperationBody(operation: GitExecuteInput["operation"]): Record<string, unknown> {
	switch (operation.kind) {
		case "stage":
		case "unstage":
			return { paths: operation.paths };
		case "commit":
			return { message: operation.message, ...(operation.amend ? { amend: true } : {}) };
		case "branch.create":
			return { name: operation.name };
		case "branch.switch":
			return { branch: operation.name };
		case "checkout":
			return { branch: operation.ref };
		case "fetch":
			return { ...(operation.remote ? { remote: operation.remote } : {}), ...(operation.prune ? { prune: true } : {}) };
		case "pull":
			// `/api/git/pull` is fast-forward-only by contract; the strategy field
			// the panel would send is not accepted, so it is dropped here.
			return {
				...(operation.remote ? { remote: operation.remote } : {}),
				...(operation.branch ? { branch: operation.branch } : {}),
			};
		case "push":
			return {
				...(operation.remote ? { remote: operation.remote } : {}),
				...(operation.branch ? { branch: operation.branch } : {}),
			};
		default:
			return {};
	}
}

/**
 * Build the command handlers for one transport + receipt sink.
 *
 * Unsupported operation kinds fail the receipt (never silently succeed):
 * `discard`, `init`, `clone`, `branch.rename`, `branch.delete`,
 * `worktree.*`, `remote.*`, `stash.*`, `tag.*`, `merge`, `rebase`,
 * `cherry-pick`, `revert`, `reset`, `continue`, `abort`, `cancel`.
 */
export function createCommands(
	t: PagesTransport,
	store: ReceiptStore,
): Partial<Record<CommandName, CommandHandler>> {
	const run = async <TName extends CommandName>(name: TName, work: () => Promise<unknown>) => {
		try {
			return store.record(name, await work());
		} catch (error) {
			return store.fail(name, error);
		}
	};

	return {
		"git.execute": (input =>
			run("git.execute", async () => {
				const { operation, workspaceId } = input as CommandInput<"git.execute">;
				const path = GIT_OPERATION_PATH[operation.kind];
				if (!path) throw new Error(`git operation has no Zeta endpoint: ${operation.kind}`);
				const cwd = String(workspaceId ?? t.cwd ?? "");
				if (!cwd) throw new Error("no workspace to run git in");
				await t.post(path, { cwd, ...gitOperationBody(operation) });
				// `branch.create` without checkout is one call; with checkout the
				// gateway's branch route leaves HEAD alone, so switch separately.
				if (operation.kind === "branch.create" && operation.checkout) {
					await t.post("/api/git/checkout", { cwd, branch: operation.name });
				}
				return {
					operation: operation.kind,
					message: `${operation.kind} completed`,
					repository: await readRepository(t, cwd as WorkspaceId),
					workspaceId: cwd as WorkspaceId,
				} satisfies GitOperationResult;
			})) as CommandHandler<"git.execute">,

		"session.archive": (input =>
			run("session.archive", async () => {
				await t.post(`/api/sessions/${encodeURIComponent(String(input.threadId))}/archive`);
				return { applied: true, runtimeEffect: "immediate" as const };
			})) as CommandHandler<"session.archive">,

		"session.unarchive": (input =>
			run("session.unarchive", async () => {
				await t.post(`/api/sessions/${encodeURIComponent(String(input.threadId))}/unarchive`);
				return { applied: true, runtimeEffect: "immediate" as const };
			})) as CommandHandler<"session.unarchive">,

		"models.provider.test": (input =>
			run("models.provider.test", async () => {
				const body = input as CommandInput<"models.provider.test">;
				const response = await t.post<{ ok?: boolean; latencyMs?: number; responseText?: string; error?: string }>(
					"/api/models-config/test",
					{
						providerName: body.providerId,
						provider: { api: body.api, baseUrl: body.endpointUrl, apiKey: body.apiKey },
						model: { id: body.providerId },
					},
				);
				return {
					ok: response.ok === true,
					latencyMs: response.latencyMs ?? 0,
					detail: response.responseText ?? response.error ?? "",
				};
			})) as CommandHandler<"models.provider.test">,

		"models.provider.probe": (input =>
			run("models.provider.probe", async () => {
				const body = input as CommandInput<"models.provider.probe">;
				const response = await t.post<{
					ok?: boolean;
					models?: ReadonlyArray<{ id: string; name?: string }>;
					error?: string;
					latencyMs?: number;
				}>("/api/models-config/discover", {
					baseUrl: body.endpointUrl,
					api: body.api,
					apiKey: body.apiKey,
				});
				const models = (response.models ?? []).map(model => ({ id: model.id, name: model.name ?? model.id }));
				return {
					ok: response.ok === true,
					found: models.length,
					usable: models.length,
					models,
					latencyMs: response.latencyMs ?? 0,
					detail: response.error ?? `${models.length} models`,
				};
			})) as CommandHandler<"models.provider.probe">,

		"models.login.start": (input =>
			run("models.login.start", async () => {
				const body = input as CommandInput<"models.login.start">;
				await t.post(`/api/auth/login/${encodeURIComponent(String(body.providerId))}`, {});
				return { applied: true, runtimeEffect: "immediate" as const };
			})) as CommandHandler<"models.login.start">,

		"models.login.logout": (input =>
			run("models.login.logout", async () => {
				const body = input as CommandInput<"models.login.logout">;
				await t.requestJson("POST", `/api/auth/logout/${encodeURIComponent(String(body.providerId))}`, {});
				return { applied: true, runtimeEffect: "immediate" as const };
			})) as CommandHandler<"models.login.logout">,
	} as Partial<Record<CommandName, CommandHandler>>;
}

// ---------------------------------------------------------------------------
// Default (same-origin) transport + receipts
// ---------------------------------------------------------------------------

async function readJson<T>(response: Response, path: string): Promise<T> {
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(payload.error ?? `${path}: HTTP ${response.status}`);
	}
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

export const defaultTransport: PagesTransport = {
	cwd: null,
	sessionId: null,
	async get<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== null && value !== undefined) params.set(key, String(value));
		}
		const suffix = params.size ? `?${params.toString()}` : "";
		return readJson<T>(await fetch(`${path}${suffix}`, { cache: "no-store" }), path);
	},
	async post<T>(path: string, body?: unknown): Promise<T> {
		const response = await fetch(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body ?? {}),
		});
		return readJson<T>(response, path);
	},
	async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await fetch(path, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return readJson<T>(response, path);
	},
};

/** A transport pinned to one workspace/session. */
export function transportFor(cwd: string | null, sessionId: string | null = null): PagesTransport {
	return { ...defaultTransport, cwd, sessionId };
}

export interface ReceiptLog {
	snapshot(): Record<string, CommandReceipt>;
	readonly issued: string[];
}

/** Terminal-receipt bookkeeping for a client instance. */
export function createReceiptStore(): ReceiptStore & ReceiptLog {
	const receipts = new Map<string, CommandReceipt>();
	const issued: string[] = [];
	const issue = (name: CommandName): CommandHandle<CommandName> => {
		const requestId = `zeta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as CommandRequestId;
		issued.push(requestId);
		return {
			requestId,
			commandName: name,
			status: "local_pending",
			idempotencyKey: requestId as never,
			issuedAt: new Date().toISOString(),
		} as CommandHandle<CommandName>;
	};
	return {
		issued,
		record<TName extends CommandName>(name: TName, result: unknown) {
			const handle = issue(name);
			receipts.set(handle.requestId, {
				requestId: handle.requestId,
				commandName: name,
				status: "completed",
				result,
				observedAt: new Date().toISOString(),
			} as CommandReceipt);
			return handle as CommandHandle<TName>;
		},
		fail<TName extends CommandName>(name: TName, error: unknown) {
			const handle = issue(name);
			const message = error instanceof Error ? error.message : String(error);
			receipts.set(handle.requestId, {
				requestId: handle.requestId,
				commandName: name,
				status: "failed",
				error: { code: "INTERNAL_ERROR", message },
				observedAt: new Date().toISOString(),
			} as CommandReceipt);
			return handle as CommandHandle<TName>;
		},
		snapshot() {
			return Object.fromEntries(receipts);
		},
	};
}

// ---------------------------------------------------------------------------
// Module-level maps (same-origin transport)
// ---------------------------------------------------------------------------

/**
 * Ready-to-register maps for a `StudioClientImpl` that has not been bound to a
 * workspace yet. Bound clients should use `createQueries`/`createCommands`
 * instead so `cwd` follows the shell selection.
 */
export const queries = createQueries(defaultTransport);
export const commands = createCommands(defaultTransport, createReceiptStore());
