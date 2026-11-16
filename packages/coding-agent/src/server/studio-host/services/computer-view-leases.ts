import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ComputerViewLease {
	readonly leaseId: string;
	readonly ownerId: string;
	readonly scopeSessionId: string;
	expiresAt: number;
	readonly isLive: () => boolean;
}
/** Opaque prepare receipts are the only Desktop adoption authority; owner identity stays private. */
export class ComputerViewLeases {
	readonly #leases = new Map<string, ComputerViewLease>();
	readonly #writes = new Map<string, Promise<void>>();
	#disposed = false;
	constructor(readonly directory: string) {}
	async publish(lease: ComputerViewLease): Promise<void> {
		if (this.#disposed || !lease.isLive()) throw new Error("Computer view closed");
		this.#leases.set(lease.leaseId, lease);
		const previous = this.#writes.get(lease.leaseId) ?? Promise.resolve();
		const write = previous
			.catch(() => {})
			.then(async () => {
				const folder = join(this.directory, "computer-views");
				await mkdir(folder, { recursive: true, mode: 0o700 });
				const destination = join(folder, lease.leaseId + ".json"),
					partial = destination + "." + randomUUID() + ".partial";
				try {
					if (this.#disposed || this.#leases.get(lease.leaseId) !== lease || !lease.isLive())
						throw new Error("Computer view closed");
					await writeFile(
						partial,
						JSON.stringify({
							version: 1,
							leaseId: lease.leaseId,
							owner: createHash("sha256").update(lease.ownerId).digest("hex"),
							scopeSessionId: lease.scopeSessionId,
							expiresAt: lease.expiresAt,
						}),
						{ flag: "wx", mode: 0o600 },
					);
					await rename(partial, destination);
					if (this.#disposed || this.#leases.get(lease.leaseId) !== lease || !lease.isLive()) {
						await unlink(destination).catch(() => {});
						throw new Error("Computer view closed");
					}
				} finally {
					await unlink(partial).catch(() => {});
				}
			});
		this.#writes.set(lease.leaseId, write);
		try {
			await write;
		} finally {
			if (this.#writes.get(lease.leaseId) === write) this.#writes.delete(lease.leaseId);
		}
	}
	async release(id: string): Promise<void> {
		this.#leases.delete(id);
		await this.#writes.get(id)?.catch(() => {});
		await unlink(join(this.directory, "computer-views", id + ".json")).catch(error => {
			if (error.code !== "ENOENT") throw error;
		});
	}
	async dispose(): Promise<void> {
		this.#disposed = true;
		await Promise.all([...this.#leases.keys()].map(id => this.release(id)));
	}
}
