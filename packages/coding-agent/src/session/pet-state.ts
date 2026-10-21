/**
 * Passive state writer for the desktop pet (see `document/pet-interface.md`).
 *
 * The pet is installed separately: Zeta only mirrors the current agent
 * lifecycle into `<default workspace>/pet/state.json`. When the pet directory
 * does not exist this is a no-op — it is never created here — and every write
 * error is swallowed so a broken pet installation cannot affect a session.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentEvent } from "@linxiraos/pi-agent-core";

import { defaultCoordinatorWorkspace } from "../default-workspace";

/** States the pet understands; it degrades unknown values to `idle` itself. */
export type PetState = "idle" | "thinking" | "working" | "done" | "error";

export interface PetStateWriterOptions {
	/** Workspace holding `pet/`; defaults to the coordinator workspace. */
	workspaceDir?: string;
	/** Clock override (tests). */
	now?: () => number;
}

/** `state` derived from one agent event, or `undefined` when it changes nothing. */
export function petStateForAgentEvent(event: AgentEvent): PetState | undefined {
	switch (event.type) {
		case "agent_start":
			return "working";
		case "message_start":
			return event.message.role === "assistant" ? "thinking" : undefined;
		case "tool_execution_start":
			return "working";
		case "agent_end": {
			const lastAssistant = [...event.messages].reverse().find(message => message.role === "assistant");
			return lastAssistant?.stopReason === "error" ? "error" : "done";
		}
		default:
			return undefined;
	}
}

/** Absolute `state.json` path for a workspace. */
export function petStatePath(workspaceDir: string = defaultCoordinatorWorkspace()): string {
	return path.join(workspaceDir, "pet", "state.json");
}

/** Write one state atomically; a missing pet directory or any fault is ignored. */
export async function writePetState(state: PetState, options: PetStateWriterOptions = {}): Promise<void> {
	const target = petStatePath(options.workspaceDir);
	try {
		const stat = await fs.stat(path.dirname(target));
		if (!stat.isDirectory()) return;
	} catch {
		return;
	}
	const temporary = `${target}.${process.pid}.tmp`;
	try {
		const since = options.now?.() ?? Date.now();
		await fs.writeFile(temporary, JSON.stringify({ state, since }), { encoding: "utf-8", mode: 0o600 });
		await fs.rename(temporary, target);
	} catch {
		await fs.rm(temporary, { force: true }).catch(() => {});
	}
}

/**
 * Stateful writer: maps events to states, skips repeated states, and serializes
 * writes so an older write can never land after a newer one.
 */
export function createPetStateWriter(options: PetStateWriterOptions = {}): (event: AgentEvent) => void {
	let last: PetState | undefined;
	let tail: Promise<void> = Promise.resolve();
	return event => {
		const state = petStateForAgentEvent(event);
		if (!state || state === last) return;
		last = state;
		tail = tail.then(() => writePetState(state, options)).catch(() => {});
	};
}
