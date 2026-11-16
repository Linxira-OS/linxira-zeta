import { createHash } from "node:crypto";
import type { OAuthAccountSummary, ResetCreditAccountStatus, UsageReport } from "@linxiraos/pi-ai";
import { resolveCredentialIdentityKey } from "@linxiraos/pi-ai";
import { resolveUsedFraction } from "@linxiraos/pi-ai/usage";
import { computePolicyDiagnostics } from "../../../cli/usage-cli";
import type { OAuthAccountPools } from "../../../config/account-pools";
import type { AgentSession } from "../../../session/agent-session";
import { cfgRetryUsageReservePct } from "../../../session/settings";
import { cfgTaskAgentAccountPools } from "../../../task/settings";
import { StudioOpError as SessionControlError } from "../errors.js";
import type {
	AccountQuotaScope,
	AccountQuotaWindow,
	AccountResetStatus,
	AccountStatusResult,
	StudioAccountStatus,
} from "../protocol/contracts/accounts.js";

const clean = (value: string) =>
	value
		.replace(/[\u0000-\u001f]/gu, " ")
		.trim()
		.slice(0, 512);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const accountId = (provider: string, identity: string) =>
	"account-" +
	createHash("sha256")
		.update(provider + ":" + identity)
		.digest("hex")
		.slice(0, 32);

export const ACCOUNT_ID_PATTERN = /^account-[a-f0-9]{32}$/u;

export function accountMatchesReport(account: OAuthAccountSummary, report: UsageReport): boolean {
	const metadata = report.metadata ?? {};
	if (typeof metadata.orgId === "string" && metadata.orgId !== account.orgId) return false;
	if (typeof metadata.accountId === "string") return metadata.accountId === account.accountId;
	if (typeof metadata.email === "string") return metadata.email === account.email;
	return false;
}

export function projectQuota(report: UsageReport, details = false): AccountQuotaWindow[] {
	return report.limits.slice(0, 64).map(limit => {
		const fraction = resolveUsedFraction(limit);
		const scope: AccountQuotaScope = { provider: clean(limit.scope.provider) };
		for (const key of ["accountId", "projectId", "orgId", "modelId", "tier", "windowId", "sharedGroup"] as const) {
			const value = limit.scope[key];
			if (value && clean(value)) scope[key] = clean(value);
		}
		if (limit.scope.shared !== undefined) scope.shared = limit.scope.shared;
		const notes = limit.notes?.slice(0, 16).map(clean).filter(Boolean);
		const resetsAt = limit.window?.resetsAt;
		const resetLabel = limit.window?.resetLabel && clean(limit.window.resetLabel);
		return {
			id: clean(limit.id) || "quota",
			...(details
				? {
						scope,
						...(notes?.length ? { notes } : {}),
						...(resetLabel ? { resetLabel } : {}),
					}
				: {}),
			label: clean(limit.label) || "Quota",
			status: limit.status ?? (finite(fraction) ? (fraction >= 1 ? "exhausted" : "ok") : "unknown"),
			...(finite(fraction) ? { usedFraction: fraction } : {}),
			...(finite(resetsAt) ? { resetsAt } : {}),
			...(limit.scope.modelId ? { model: clean(limit.scope.modelId) } : {}),
		};
	});
}

function resetStatus(status: ResetCreditAccountStatus | undefined, fetched: boolean): AccountResetStatus {
	if (!status || status.error) return { state: fetched ? "unavailable" : "unfetched", credits: [] };
	return {
		state: "available",
		availableCount: status.availableCount,
		...(status.redeemableCount === undefined ? {} : { redeemableCount: status.redeemableCount }),
		...(status.eligible === undefined ? {} : { eligible: status.eligible }),
		credits: (status.credits ?? []).slice(0, 64).map(credit => ({
			title: clean(credit.title ?? credit.program ?? "Saved reset"),
			...(credit.status ? { status: clean(credit.status) } : {}),
			...(credit.expiresAt ? { expiresAt: clean(credit.expiresAt) } : {}),
			...(finite(credit.remainingCount) ? { remainingCount: credit.remainingCount } : {}),
			...(credit.usable === undefined ? {} : { usable: credit.usable }),
			...(credit.requiresLimit === undefined ? {} : { requiresLimit: credit.requiresLimit }),
			clears: (credit.clears ?? []).slice(0, 32).map(clean),
		})),
	};
}

/** One selectable OAuth identity for `task.agentAccountPools`. */
export interface PoolAccountOption {
	provider: string;
	identityKey: string;
	label: string;
}
export type ProviderAccountPools = Record<string, string[]>;
export type AgentAccountPools = Record<string, ProviderAccountPools | null>;
export interface AgentAccountPoolState {
	global: AgentAccountPools;
	effective: AgentAccountPools;
}

function copyPools(value: Record<string, Readonly<Record<string, readonly string[]>> | null>): AgentAccountPools {
	const result = Object.create(null) as AgentAccountPools;
	for (const [agent, pools] of Object.entries(value)) {
		if (pools === null) {
			result[agent] = null;
			continue;
		}
		const copied = Object.create(null) as ProviderAccountPools;
		for (const [provider, identityKeys] of Object.entries(pools)) copied[provider] = [...identityKeys];
		result[agent] = copied;
	}
	return result;
}

/**
 * Read-only quota/reset status plus the account-pool projections. Does not
 * call AgentSession's auto-redemption heartbeat or mutate credentials except
 * through {@link logout}'s single-row removal.
 */
export class StudioAccountStatusService {
	#reports: UsageReport[] = [];
	#generation = 0;
	#resets: ResetCreditAccountStatus[] = [];
	#refreshedAt: number | undefined;
	#usageUnavailable = false;
	#refreshing: Promise<void> | undefined;
	#abort: AbortController | undefined;

	constructor(readonly session: AgentSession) {}

	dispose(): void {
		this.#generation++;
		this.#abort?.abort();
	}

	async logout(sessionId: string, id: string): Promise<{ loggedOut: true }> {
		if (sessionId !== this.session.sessionId) throw new SessionControlError("UNAVAILABLE", "Account session changed");
		if (!ACCOUNT_ID_PATTERN.test(id))
			throw new SessionControlError("INVALID_ARGUMENT", "The selected OAuth account is no longer available");
		const auth = this.session.modelRegistry.authStorage;
		for (const provider of new Set(auth.credentials.list().map(row => row.provider))) {
			const account = auth.oauth
				.accounts(provider, sessionId)
				.find(row => accountId(provider, String(row.credentialId)) === id);
			if (!account) continue;
			if (!(await auth.credentials.removeById(provider, account.credentialId)))
				throw new SessionControlError("UNAVAILABLE", "This account has already changed; refresh the account list");
			this.#generation++;
			this.#abort?.abort();
			this.#reports = this.#reports.filter(
				report => report.provider !== provider || !accountMatchesReport(account, report),
			);
			this.#resets = this.#resets.filter(
				row => row.provider !== provider || row.credentialId !== account.credentialId,
			);
			return { loggedOut: true };
		}
		throw new SessionControlError("INVALID_ARGUMENT", "The selected OAuth account is no longer available");
	}

	async get(refresh = false, details = false): Promise<AccountStatusResult> {
		const auth = this.session.modelRegistry.authStorage;
		if (refresh) {
			this.#refreshing ??= (async () => {
				const generation = this.#generation;
				const controller = new AbortController();
				this.#abort = controller;
				const timer = setTimeout(() => controller.abort(), 30000);
				try {
					const reports = auth.usage
						.invalidate(undefined, controller.signal)
						.then(() => auth.usage.reports({ signal: controller.signal }));
					const resets = Promise.all(
						["anthropic", "openai-codex"].map(provider =>
							auth.oauth.accounts(provider).length
								? auth.resets
										.list({ provider, sessionId: this.session.sessionId, signal: controller.signal })
										.catch(() => [])
								: Promise.resolve([]),
						),
					);
					const [usage, credits] = await Promise.allSettled([reports, resets]);
					if (generation !== this.#generation) return;
					this.#reports = usage.status === "fulfilled" ? (usage.value ?? []) : [];
					this.#usageUnavailable = usage.status === "rejected" || usage.value === null;
					this.#resets = credits.status === "fulfilled" ? credits.value.flat() : [];
					this.#refreshedAt = Date.now();
				} finally {
					clearTimeout(timer);
					this.#abort = undefined;
				}
			})().finally(() => {
				this.#refreshing = undefined;
			});
			await this.#refreshing;
		}
		const providers = new Set([
			...auth.credentials.list().map(row => row.provider),
			...this.session.modelRegistry.getAvailable("all").map(model => model.provider),
		]);
		const accounts: StudioAccountStatus[] = [];
		const assigned = new Set<UsageReport>();
		for (const provider of providers) {
			const native = auth.oauth.accounts(provider, this.session.sessionId);
			for (const account of native) {
				const matches = this.#reports.filter(
					report =>
						report.provider === provider &&
						accountMatchesReport(account, report) &&
						native.filter(candidate => accountMatchesReport(candidate, report)).length === 1,
				);
				const report = matches.sort((left, right) => right.fetchedAt - left.fetchedAt)[0];
				if (report) matches.forEach(item => assigned.add(item));
				accounts.push({
					policy: computePolicyDiagnostics(provider, account, report?.limits, {
						globalReservePct: cfgRetryUsageReservePct.get(this.session.settings),
						getAccountPolicy: (policyProvider, identity) => auth.oauth.policy(policyProvider, identity),
					}),
					id: accountId(provider, String(account.credentialId)),
					provider,
					label: clean(account.email ?? account.accountId ?? "Account " + (account.position + 1)),
					...(account.orgName ? { organization: clean(account.orgName) } : {}),
					source: "oauth",
					active: account.active,
					limits: report ? projectQuota(report, details) : [],
					...(report ? { reportedAt: report.fetchedAt } : {}),
					resets: resetStatus(
						this.#resets.find(item => item.provider === provider && item.credentialId === account.credentialId),
						this.#refreshedAt !== undefined,
					),
				});
			}
			const source = auth.keys.source(provider);
			if (!native.length && source)
				accounts.push({
					id: accountId(provider, "key"),
					provider,
					label: provider,
					source: source.concrete ? "api-key" : "ambient",
					active: this.session.model?.provider === provider,
					limits: [],
					resets: { state: "unfetched", credits: [] },
				});
		}
		const unassigned = this.#reports
			.filter(report => !assigned.has(report))
			.map(report => ({
				provider: report.provider,
				reportedAt: report.fetchedAt,
				limits: projectQuota(report, details),
			}));
		const result: AccountStatusResult = {
			accounts: accounts.slice(0, 200),
			unassigned: unassigned.slice(0, 200),
			...(this.#refreshedAt === undefined ? {} : { refreshedAt: this.#refreshedAt }),
			refreshing: this.#refreshing !== undefined,
			usageUnavailable: this.#usageUnavailable,
			truncated: accounts.length > 200 || unassigned.length > 200,
		};
		while (Buffer.byteLength(JSON.stringify(result)) > 800000) {
			result.truncated = true;
			if (result.unassigned.length) result.unassigned.pop();
			else result.accounts.pop();
		}
		return result;
	}

	/** OAuth identities the account-pool editor may assign to a subagent. */
	poolOptions(): { accounts: PoolAccountOption[]; truncated: boolean } {
		const accounts: PoolAccountOption[] = [];
		for (const { provider, credential } of this.session.modelRegistry.authStorage.credentials.list()) {
			if (credential.type !== "oauth") continue;
			const identityKey = resolveCredentialIdentityKey(provider, credential);
			if (!identityKey) continue;
			accounts.push({
				provider,
				identityKey,
				label: credential.orgName ? `${identityKey} · ${credential.orgName}` : identityKey,
			});
		}
		return { accounts: accounts.slice(0, 256), truncated: accounts.length > 256 };
	}

	/** Persisted global pools plus the effective merged map, exactly as tasks read it. */
	poolGet(): AgentAccountPoolState {
		const task = this.session.settings.getGlobalSettings().task as
			| { agentAccountPools?: AgentAccountPools }
			| undefined;
		const effective = cfgTaskAgentAccountPools.get(this.session.settings) as Record<string, OAuthAccountPools>;
		return { global: copyPools(task?.agentAccountPools ?? {}), effective: copyPools(effective) };
	}

	/** Write one agent's pool entry through the CLI's entry writer; never copies merged policy. */
	async poolSet(
		agent: string,
		pools?: Readonly<Record<string, readonly string[]>> | null,
	): Promise<AgentAccountPoolState> {
		cfgTaskAgentAccountPools.setEntry(this.session.settings, agent, pools ?? undefined);
		await this.session.settings.flush();
		return this.poolGet();
	}
}

const services = new WeakMap<AgentSession, StudioAccountStatusService>();

/** One resident status cache per live native session; refresh coalescing must span commands. */
export function studioAccountStatusService(session: AgentSession): StudioAccountStatusService {
	const existing = services.get(session);
	if (existing) return existing;
	const service = new StudioAccountStatusService(session);
	services.set(session, service);
	session.addDisposer(() => {
		if (services.get(session) === service) services.delete(session);
		service.dispose();
	});
	return service;
}
