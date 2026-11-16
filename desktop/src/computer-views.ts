import { join } from "node:path";
import type { PrivateSender, StudioPrivatePaths } from "./private-ipc";
import { COMPUTER_HASH, COMPUTER_UUID, COMPUTER_MEDIA_UNAVAILABLE, computerRecord, computerSession, readComputerJson } from "./computer-media-files";

interface Binding { sender: PrivateSender; frame: unknown; generation: number; scopeSessionId: string; leaseId: string; owner?: string; expiresAt: number }
const claimed = new Map<string, Binding>();
export interface ComputerViewGuard { readonly directory: string; readonly owner: string; readonly senderId: number; readonly leaseId: string; readonly scopeSessionId: string; valid(): boolean; confirm(): Promise<void> }
export class DesktopComputerViews {
	readonly #bindings = new Map<number, Map<string, Binding>>();
	readonly #generations = new Map<number, number>();
	#disposed = false;
	constructor(readonly options: { paths(): Promise<StudioPrivatePaths>; isActive(sender: PrivateSender): boolean }) {}
	#valid(binding: Binding): boolean {
		return !this.#disposed && this.#bindings.get(binding.sender.id)?.get(binding.leaseId) === binding && this.#generations.get(binding.sender.id) === binding.generation && binding.expiresAt > Date.now() && !binding.sender.isDestroyed() && binding.sender.mainFrame === binding.frame && this.options.isActive(binding.sender);
	}
	async #descriptor(binding: Binding, directory: string): Promise<Record<string, unknown>> {
		const row = computerRecord(await readComputerJson(directory, join(directory, "computer-views", binding.leaseId + ".json"), 4096, () => this.#valid(binding)), ["version", "leaseId", "owner", "scopeSessionId", "expiresAt"]);
		if (row.version !== 1 || row.leaseId !== binding.leaseId || row.scopeSessionId !== binding.scopeSessionId || typeof row.owner !== "string" || !COMPUTER_HASH.test(row.owner) || (binding.owner && binding.owner !== row.owner) || typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= Date.now() || row.expiresAt > Date.now() + 125_000) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		binding.expiresAt = row.expiresAt;
		return row;
	}
	async adopt(sender: PrivateSender, raw: unknown): Promise<void> {
		const row = computerRecord(raw, ["scopeSessionId", "leaseId", "origin"]);
		computerSession(row.scopeSessionId);
		if (row.origin !== "local" || typeof row.leaseId !== "string" || !COMPUTER_UUID.test(row.leaseId) || this.#disposed || !this.options.isActive(sender)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const bindings = this.#bindings.get(sender.id) ?? new Map<string, Binding>();
		for (const [id, binding] of bindings) if (!this.#valid(binding)) { bindings.delete(id); if (claimed.get(id) === binding) claimed.delete(id); }
		const old = bindings.get(row.leaseId);
		if (old && this.#valid(old)) { await this.guard(sender, row.scopeSessionId, row.leaseId); return; }
		const claim = claimed.get(row.leaseId);
		if (claim && (claim.sender.isDestroyed() || claim.sender.mainFrame !== claim.frame || claim.expiresAt <= Date.now())) claimed.delete(row.leaseId);
		if (claimed.has(row.leaseId) && claimed.get(row.leaseId)?.sender !== sender) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		if (!old && bindings.size >= 32) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		if (old && claimed.get(old.leaseId) === old) claimed.delete(old.leaseId);
		const generation = this.#generations.get(sender.id) ?? 0;
		this.#generations.set(sender.id, generation);
		const binding: Binding = { sender, frame: sender.mainFrame, generation, scopeSessionId: row.scopeSessionId, leaseId: row.leaseId, expiresAt: Date.now() + 125000 };
		bindings.set(binding.leaseId, binding); this.#bindings.set(sender.id, bindings); claimed.set(binding.leaseId, binding);
		try {
			const paths = await this.options.paths();
			const descriptor = await this.#descriptor(binding, paths.mediaDirectory);
			if (!this.#valid(binding)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			binding.owner = descriptor.owner as string;
			const current = await this.options.paths();
			if (current.mediaDirectory !== paths.mediaDirectory || !this.#valid(binding)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		} catch (error) {
			if (bindings.get(binding.leaseId) === binding) { bindings.delete(binding.leaseId); if (claimed.get(binding.leaseId) === binding) claimed.delete(binding.leaseId); }
			throw error;
		}
	}
	async guard(sender: PrivateSender, scopeSessionId: string, leaseId: string): Promise<ComputerViewGuard> {
		const binding = this.#bindings.get(sender.id)?.get(leaseId);
		if (!binding || binding.scopeSessionId !== scopeSessionId || !this.#valid(binding)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const paths = await this.options.paths();
		await this.#descriptor(binding, paths.mediaDirectory);
		if (!this.#valid(binding) || !binding.owner) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		return {
			directory: paths.mediaDirectory, scopeSessionId, owner: binding.owner, senderId: sender.id, leaseId: binding.leaseId,
			valid: () => this.#valid(binding),
			confirm: async () => {
				const current = await this.options.paths();
				if (current.mediaDirectory !== paths.mediaDirectory || !this.#valid(binding)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
				await this.#descriptor(binding, paths.mediaDirectory);
				if (!this.#valid(binding)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			},
		};
	}
	release(sender: PrivateSender, raw: unknown): void {
		const row = computerRecord(raw, ["scopeSessionId", "leaseId", "origin"]);
		computerSession(row.scopeSessionId);
		if (typeof row.leaseId !== "string" || !COMPUTER_UUID.test(row.leaseId)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const bindings = this.#bindings.get(sender.id), binding = bindings?.get(row.leaseId);
		if (binding && binding.scopeSessionId === row.scopeSessionId && row.origin === "local") {
			bindings!.delete(binding.leaseId);
			if (claimed.get(binding.leaseId) === binding) claimed.delete(binding.leaseId);
		}
	}
	releaseWindow(id: number): void {
		this.#generations.set(id, (this.#generations.get(id) ?? 0) + 1);
		for (const binding of this.#bindings.get(id)?.values() ?? []) if (claimed.get(binding.leaseId) === binding) claimed.delete(binding.leaseId);
		this.#bindings.delete(id);
	}
	dispose(): void { this.#disposed = true; for (const id of this.#bindings.keys()) this.releaseWindow(id); this.#generations.clear(); }
}
