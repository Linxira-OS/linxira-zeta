/**
 * Child-process driver for the mesh integration tests.
 *
 * One process = one workspace with a single `Main` agent. The parent drives it
 * over stdin and reads JSON-tagged lines from stdout:
 *
 *   READY    {"workspaceId","address","pid"}
 *   DELIVERED{"id","from","to","body"}
 *   SEND     {"to","outcome","error"?}
 *   WAIT     {"kind":"message","message"} | {"kind":"status","status"} | {"kind":"timeout"}
 *   AGENTS   [...]
 *   INBOX    [...]
 *   STOPPED
 *
 * Flags: `--root <dir>` (required), `--mesh <dir>` (required), `--alias <name>`,
 * `--id <workspaceId>`, `--reply` (answer every message), `--deliver-log <file>`
 * (append one delivered envelope id per line).
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { MeshNode } from "../../src/mesh/mesh-node";
import { raceMutualWait } from "../../src/mesh/mutual-wait";
import type { MeshEnvelope } from "../../src/mesh/types";

interface Options {
	root: string;
	mesh: string;
	alias?: string;
	id?: string;
	reply: boolean;
	deliverLog?: string;
	ackMs?: number;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { root: "", mesh: "", reply: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		switch (arg) {
			case "--root":
				options.root = argv[++index] ?? "";
				break;
			case "--mesh":
				options.mesh = argv[++index] ?? "";
				break;
			case "--alias":
				options.alias = argv[++index];
				break;
			case "--id":
				options.id = argv[++index];
				break;
			case "--reply":
				options.reply = true;
				break;
			case "--deliver-log":
				options.deliverLog = argv[++index];
				break;
			case "--ack-ms":
				options.ackMs = Number(argv[++index]);
				break;
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.root || !options.mesh) {
	console.error("mesh-node-child: --root and --mesh are required");
	process.exit(2);
}

const received: MeshEnvelope[] = [];
/** Pending `wait` callers keyed by the sender address they filter on. */
const waiters = new Set<(envelope: MeshEnvelope) => void>();

function emit(tag: string, value: unknown): void {
	process.stdout.write(`${tag} ${JSON.stringify(value)}\n`);
}

let node: MeshNode;

async function main(): Promise<void> {
	node = await MeshNode.start({
		workspaceRoot: options.root,
		meshRoot: options.mesh,
		...(options.alias !== undefined && { workspaceAlias: options.alias }),
		...(options.id !== undefined && { workspaceId: options.id }),
		role: "main",
		// Test processes share this machine with the whole suite; a loaded
		// machine must not turn a live delivery into a false offline queue.
		ackTimeoutMs: options.ackMs ?? 15_000,
		localAgents: () => [{ id: "Main", role: "main", status: "idle" }],
		deliver: async envelope => {
			received.push(envelope);
			if (options.deliverLog) {
				fs.appendFileSync(options.deliverLog, `${envelope.id} ${envelope.from} ${JSON.stringify(envelope.body)}\n`);
			}
			emit("DELIVERED", {
				id: envelope.id,
				from: envelope.from,
				to: envelope.to,
				body: envelope.body,
			});
			for (const waiter of waiters) waiter(envelope);
			if (options.reply && envelope.kind === "message") {
				// A real recipient acknowledges delivery first and generates its
				// reply in a later turn; replying inline would keep the sender's
				// ack waiting for a second mesh round trip.
				const from = envelope.from;
				const replyTo = envelope.id;
				const body = `re: ${envelope.body}`;
				setTimeout(() => {
					void node.send({ from: "Main", to: from, body, replyTo });
				}, 0);
			}
			return { outcome: "injected" };
		},
	});
	emit("READY", { workspaceId: node.workspaceId, address: node.addressFor("Main"), pid: process.pid });

	const rl = readline.createInterface({ input: process.stdin });
	rl.on("line", line => {
		void handleEnvelope(line.trim()).catch(error => emit("ERROR", { error: String(error) }));
	});
	rl.on("close", () => {
		void shutdown();
	});
}

/** Sequence numbers already executed, so a retried write is not re-executed. */
const seenSequences = new Set<number>();

async function handleEnvelope(raw: string): Promise<void> {
	const match = /^#(\d+) (.*)$/s.exec(raw);
	const sequence = match ? Number(match[1]) : undefined;
	if (sequence !== undefined) {
		emit("GOT", { sequence, line: match![2] });
		if (seenSequences.has(sequence)) return;
		seenSequences.add(sequence);
	}
	await handle(match ? match[2]! : raw);
}

async function handle(line: string): Promise<void> {
	if (!line) return;
	const space = line.indexOf(" ");
	const command = space === -1 ? line : line.slice(0, space);
	const rest = space === -1 ? "" : line.slice(space + 1);
	switch (command) {
		case "send": {
			const separator = rest.indexOf(" ");
			const to = separator === -1 ? rest : rest.slice(0, separator);
			const body = separator === -1 ? "" : rest.slice(separator + 1);
			const result = await node.send({ from: "Main", to, body });
			emit("SEND", result);
			return;
		}
		case "wait": {
			const [from, timeoutText] = rest.split(" ");
			const timeoutMs = Number(timeoutText ?? 3000);
			let settle: ((envelope: MeshEnvelope) => void) | undefined;
			const message = new Promise<MeshEnvelope>(resolve => {
				settle = resolve;
				waiters.add(resolve);
			});
			const timer = setTimeout(() => {
				if (settle) waiters.delete(settle);
			}, timeoutMs);
			const timeout = new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), timeoutMs));
			const outcome = await raceMutualWait(node, "Main", from, Promise.race([message, timeout]));
			clearTimeout(timer);
			if (settle) waiters.delete(settle);
			if (outcome === "peer-waiting-on-you") emit("WAIT", { kind: "status", status: outcome });
			else if (outcome === "timeout") emit("WAIT", { kind: "timeout" });
			else emit("WAIT", { kind: "message", message: outcome });
			return;
		}
		case "agents":
			emit("AGENTS", await node.agents());
			return;
		case "inbox":
			emit(
				"INBOX",
				received.map(envelope => ({ id: envelope.id, from: envelope.from, body: envelope.body })),
			);
			return;
		case "stop":
			await shutdown();
			return;
		case "ping":
			emit("PONG", {});
			return;
		default:
			emit("ERROR", { error: `unknown command "${command}"` });
	}
}

let stopping = false;

async function shutdown(): Promise<void> {
	if (stopping) return;
	stopping = true;
	await node?.stop().catch(() => {});
	emit("STOPPED", {});
	process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => void shutdown());
}

void main().catch(error => {
	emit("ERROR", { error: String(error) });
	process.exit(1);
});
