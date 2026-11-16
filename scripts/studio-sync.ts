#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const OFFICIAL = "https://github.com/the-snowpear/omp-studio.git";
const SHARED = /^(?:client|client-contract|studio-protocol|platform|testkit|transport-web)$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
type BlobEntry = { mode: string; oid: string };
export type SyncStatus =
	| "current"
	| "local-preserved"
	| "adapted-addition"
	| "contract-review"
	| "ready-add"
	| "ready-merge"
	| "ready-delete"
	| "conflict"
	| "delete-review"
	| "missing-review"
	| "binary-review"
	| "mode-review"
	| "configuration-review"
	| "host-adaptation"
	| "repository-review";
export interface SyncRow {
	upstream: string;
	local?: string;
	change: string;
	status: SyncStatus;
	beforeHash?: string;
	afterHash?: string;
	applied?: boolean;
	reason?: string;
}
export interface SyncOptions {
	from: string;
	tag: string;
	out: string;
	apply: boolean;
	offline: boolean;
	root: string;
}

export function mappedStudioPath(upstream: string): string | undefined {
	if (upstream.startsWith("apps/renderer/src/")) return `web-app/src/studio/${upstream.slice(18)}`;
	if (upstream.startsWith("apps/renderer/")) return `web-app/${upstream.slice(14)}`;
	const match = /^packages\/([^/]+)\/(.+)$/.exec(upstream);
	return match && SHARED.test(match[1]!) ? `web-app/src/vendor/${match[1]}/${match[2]}` : undefined;
}

/** Only already-established import/bridge names; never persisted storage keys or prose. */
export function normalizeStudioText(text: string): string {
	return text
		.replaceAll("\r\n", "\n")
		.replaceAll("@omp-studio/client-contract", "@linxiraos/studio-contract")
		.replaceAll("@omp-studio/studio-protocol", "@linxiraos/studio-protocol")
		.replace(
			/@omp-studio\/(client|platform|testkit|transport-web|transport-desktop|runtime-installer)(?=[/\"'`\s]|$)/g,
			"@linxiraos/studio-$1",
		)
		.replace(
			/\bompStudio(Chrome|Terminal|Remote|Dictation|FileViewer|FloatingWindows|ComputerFrames)\b/g,
			"zetaStudio$1",
		);
}

async function git(root: string, args: string[]): Promise<string> {
	const result = await $`git ${args}`.cwd(root).quiet().nothrow();
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
}
async function tree(root: string, ref: string): Promise<Map<string, BlobEntry>> {
	const entries = new Map<string, BlobEntry>();
	for (const row of (await git(root, ["ls-tree", "-rz", ref])).split("\0")) {
		if (!row) continue;
		const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
		if (match) entries.set(match[3]!, { mode: match[1]!, oid: match[2]! });
	}
	return entries;
}
async function blobs(root: string, oids: string[]): Promise<Map<string, Buffer>> {
	if (oids.length === 0) return new Map();
	const input = [...new Set(oids)].join("\n") + "\n";
	const child = Bun.spawn(["git", "cat-file", "--batch"], {
		cwd: root,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});
	child.stdin.write(input);
	child.stdin.end();
	const [output, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).arrayBuffer().then(bytes => Buffer.from(bytes)),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`git cat-file: ${stderr}`);
	const result = new Map<string, Buffer>();
	let position = 0;
	while (position < output.length) {
		const newline = output.indexOf(10, position);
		const header = output.subarray(position, newline).toString().split(" ");
		if (header[1] !== "blob" || !/^\d+$/.test(header[2] ?? ""))
			throw new Error("invalid git cat-file batch response");
		const size = Number(header[2]);
		result.set(header[0]!, output.subarray(newline + 1, newline + 1 + size));
		position = newline + 2 + size;
	}
	return result;
}
function hash(bytes: Uint8Array | null): string {
	return bytes === null ? "absent" : new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
async function readLocal(root: string, local: string): Promise<Buffer | null> {
	const absolute = path.join(root, local);
	// Never follow a symlink/junction at the destination or any parent.
	for (let current = absolute; current !== root; current = path.dirname(current)) {
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`symbolic-link destination: ${local}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	try {
		return Buffer.from(await Bun.file(absolute).bytes());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function verifiedTag(root: string, tag: string, offline: boolean): Promise<string> {
	if (!TAG.test(tag)) throw new Error(`expected an explicit release tag, received ${tag}`);
	const local = (await git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`])).trim();
	if (offline) return local;
	const refs = (await git(root, ["ls-remote", "--tags", OFFICIAL, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]))
		.trim()
		.split("\n");
	const remote = (
		refs.find(row => row.endsWith(`refs/tags/${tag}^{}`)) ?? refs.find(row => row.endsWith(`refs/tags/${tag}`))
	)?.split(/\s+/)[0];
	if (remote !== local)
		throw new Error(`official ${tag} is ${remote ?? "absent"}; local is ${local}; refusing a moved/unverified tag`);
	return local;
}
function configuration(upstream: string): boolean {
	return /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|\.gitignore)$/.test(upstream);
}
function contractBoundary(upstream: string): boolean {
	return (
		/^packages\/(?:client|client-contract|studio-protocol|transport-web)\/src\//.test(upstream) ||
		/^apps\/renderer\/src\/(?:workspaces\/remote|workbench\/AppShell|conversationWorkspace\/client)/.test(upstream)
	);
}

/** Reports every tag-delta path; only conflict-free mapped regular files can be written. */
export async function syncStudio(
	options: SyncOptions,
): Promise<{ rows: SyncRow[]; report: string; counts: Record<string, number> }> {
	const root = path.resolve(options.root);
	const out = path.resolve(root, options.out);
	const relativeOut = path.relative(path.join(root, "temp"), out);
	if (relativeOut === "") throw new Error("--out must name a new report directory below temp/");
	try {
		await fs.lstat(out);
		throw new Error("--out already exists; use a new directory to preserve previous evidence/backups");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (relativeOut.startsWith("..") || path.isAbsolute(relativeOut))
		throw new Error("--out must be inside this worktree's temp/");
	if (options.apply && options.offline)
		throw new Error("--offline is report-only; apply requires live official tag verification");
	if (options.apply) {
		const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
		const gitDir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
		const common = path.resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim());
		if (branch === "main" || branch === "HEAD" || path.resolve(gitDir) === common)
			throw new Error("apply requires a named branch in an isolated worktree");
	}
	const from = await verifiedTag(root, options.from, options.offline);
	const tag = await verifiedTag(root, options.tag, options.offline);
	await git(root, ["merge-base", "--is-ancestor", from, tag]);
	const [baseTree, targetTree] = await Promise.all([tree(root, from), tree(root, tag)]);
	const delta = (await git(root, ["diff", "--name-status", "--no-renames", "-z", from, tag, "--"])).split("\0");
	const paths: Array<{ change: string; upstream: string }> = [];
	for (let index = 0; index + 1 < delta.length; index += 2)
		paths.push({ change: delta[index]!, upstream: delta[index + 1]! });
	const objectIds = paths
		.filter(row => mappedStudioPath(row.upstream) !== undefined && !configuration(row.upstream))
		.flatMap(row =>
			[baseTree.get(row.upstream)?.oid, targetTree.get(row.upstream)?.oid].filter(
				(oid): oid is string => oid !== undefined,
			),
		);
	const objects = await blobs(root, objectIds);
	const rows: SyncRow[] = [];
	const writes: Array<{ row: SyncRow; before: Buffer | null; after: Buffer | null }> = [];
	await fs.mkdir(out, { recursive: true });
	for (const changed of paths) {
		const local = mappedStudioPath(changed.upstream);
		const row: SyncRow = { ...changed, ...(local === undefined ? {} : { local }), status: "repository-review" };
		rows.push(row);
		if (local === undefined) {
			if (changed.upstream.startsWith("apps/desktop/") || changed.upstream.startsWith("packages/") || changed.upstream.startsWith("omp-patch/"))
				row.status = "host-adaptation";
			continue;
		}
		if (configuration(changed.upstream)) {
			row.status = "configuration-review";
			continue;
		}
		const baseEntry = baseTree.get(changed.upstream),
			targetEntry = targetTree.get(changed.upstream);
		if ([baseEntry, targetEntry].some(entry => entry !== undefined && entry.mode !== "100644")) {
			row.status = "mode-review";
			continue;
		}
		const before = await readLocal(root, local);
		const base = baseEntry === undefined ? null : objects.get(baseEntry.oid)!;
		const target = targetEntry === undefined ? null : objects.get(targetEntry.oid)!;
		row.beforeHash = hash(before);
		const binary = [base, target, before].some(bytes => bytes?.includes(0));
		const normalize = (bytes: Buffer | null) =>
			bytes === null ? null : binary ? bytes : Buffer.from(normalizeStudioText(bytes.toString()));
		const ours = normalize(before),
			ancestor = normalize(base),
			theirs = normalize(target);
		const equal = (left: Buffer | null, right: Buffer | null) =>
			left === null ? right === null : right !== null && left.equals(right);
		if (equal(ours, theirs)) {
			row.status = "current";
			continue;
		}
		if (equal(ancestor, theirs)) {
			row.status = "local-preserved";
			continue;
		}
		if (contractBoundary(changed.upstream)) {
			row.status = "contract-review";
			row.reason = "Zeta Host/transport/validation boundary; text-clean is not contract acceptance";
			continue;
		}
		if (binary) {
			row.status = "binary-review";
			continue;
		}
		let after: Buffer | null;
		if (theirs === null) {
			if (!equal(ours, ancestor)) {
				row.status = "delete-review";
				continue;
			}
			row.status = "ready-delete";
			after = null;
		} else if (ancestor === null) {
			if (ours !== null) {
				row.status = "adapted-addition";
				row.reason = "upstream-added file is already present with local adaptations; not an outstanding add";
				continue;
			}
			row.status = "ready-add";
			after = theirs;
		} else if (ours === null) {
			row.status = "missing-review";
			continue;
		} else if (equal(ours, ancestor)) {
			row.status = "ready-merge";
			after = theirs;
		} else {
			const prefix = path.join(out, "threeway", local);
			await Promise.all([
				Bun.write(prefix + ".base", ancestor),
				Bun.write(prefix + ".ours", ours),
				Bun.write(prefix + ".theirs", theirs),
			]);
			const merge = await $`git merge-file --diff3 -p ${prefix + ".ours"} ${prefix + ".base"} ${prefix + ".theirs"}`
				.cwd(root)
				.quiet()
				.nothrow();
			if (merge.exitCode > 127 || merge.exitCode < 0) throw new Error(merge.stderr.toString());
			await Bun.write(prefix + ".merged", merge.stdout);
			if (merge.exitCode !== 0) {
				row.status = "conflict";
				continue;
			}
			after = merge.stdout;
			if (after.equals(ours)) {
				row.status = "local-preserved";
				continue;
			}
			row.status = "ready-merge";
		}
		row.afterHash = hash(after);
		writes.push({ row, before, after });
	}
	if (options.apply) {
		// Back up the entire safe batch before its first write. Recheck all preimages.
		for (const { row, before } of writes) {
			if (hash(await readLocal(root, row.local!)) !== row.beforeHash)
				throw new Error(`concurrent change: ${row.local}`);
			if (before !== null) await Bun.write(path.join(out, "backup", row.local!), before);
		}
		await Bun.write(
			path.join(out, "apply-plan.json"),
			JSON.stringify(
				writes.map(({ row }) => row),
				null,
				2,
			) + "\n",
		);
		if ((await verifiedTag(root, options.tag, false)) !== tag) throw new Error("target tag moved during planning");
		for (const { row } of writes) {
			if (hash(await readLocal(root, row.local!)) !== row.beforeHash)
				throw new Error(`concurrent change: ${row.local}`);
		}
		for (const { row, after } of writes) {
			if (hash(await readLocal(root, row.local!)) !== row.beforeHash)
				throw new Error(`concurrent change: ${row.local}`);
			if (after === null) await fs.unlink(path.join(root, row.local!));
			else await Bun.write(path.join(root, row.local!), after);
			row.applied = true;
		}
	}
	const counts: Record<string, number> = {};
	for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
	const report = path.join(out, "report.json");
	await Bun.write(
		report,
		JSON.stringify(
			{
				schemaVersion: 1,
				from: { tag: options.from, commit: from },
				target: { tag: options.tag, commit: tag },
				remoteVerified: !options.offline,
				applied: options.apply,
				generatedAt: new Date().toISOString(),
				counts,
				rows,
			},
			null,
			2,
		) + "\n",
	);
	await Bun.write(
		path.join(out, "pending.tsv"),
		rows
			.filter(row => !["current", "local-preserved"].includes(row.status) && !row.applied)
			.map(row => `${row.status}\t${row.upstream}\t${row.local ?? "semantic review"}`)
			.join("\n") + "\n",
	);
	return { rows, report, counts };
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		console.log(
			"bun scripts/studio-sync.ts --from <official-tag> --tag <official-tag> [--apply] [--offline] [--out temp/<report-dir>]",
		);
		return;
	}
	const options: SyncOptions = {
		from: "",
		tag: "",
		out: `temp/studio-sync-${Date.now()}`,
		apply: false,
		offline: false,
		root: path.resolve(import.meta.dir, ".."),
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "--apply") options.apply = true;
		else if (arg === "--offline") options.offline = true;
		else if (arg === "--from" || arg === "--tag" || arg === "--out") {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
			options[arg.slice(2) as "from" | "tag" | "out"] = value;
		} else throw new Error(`unknown argument: ${arg}`);
	}
	if (!options.from || !options.tag)
		throw new Error("--from and --tag are required; branch names and SHAs are refused");
	const result = await syncStudio(options);
	console.log(
		JSON.stringify(
			{
				files: result.rows.length,
				counts: result.counts,
				applied: result.rows.filter(row => row.applied).length,
				report: result.report,
			},
			null,
			2,
		),
	);
}
if (import.meta.main)
	await main().catch(error => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 2;
	});
