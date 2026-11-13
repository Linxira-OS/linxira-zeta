/**
 * Terminal recordings owned by the desktop shell.
 *
 * The PTY belongs to the gateway, so the desktop records the same bytes the
 * renderer receives: a `.studiocast` JSONL file (`{studiocast:1,...}` header
 * followed by `[ms,{"t":"output","data":...}]` frames). Playback is served by
 * the `zeta-artifact://` protocol; export copies the finished file through the
 * native save dialog.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Same 32 MiB playback bound the renderer enforces. */
const RECORDING_MAX_BYTES = 32 * 1024 * 1024;

export type RecordingState = "idle" | "recording" | "saving" | "saved" | "failed";

export interface RecordingStatus {
	readonly terminalId: string;
	readonly state: RecordingState;
	readonly elapsedMs: number;
	readonly bytes: number;
	readonly artifactId?: string;
	readonly notice?: string;
}

interface Recording {
	readonly terminalId: string;
	readonly file: string;
	readonly startedAt: number;
	readonly cols: number;
	readonly rows: number;
	state: RecordingState;
	bytes: number;
	notice?: string;
}

export function recordingFileName(terminalId: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	return `recording-${stamp}-${terminalId.replace(/[^A-Za-z0-9-]/g, "")}.studiocast`;
}

export class TerminalRecorder {
	readonly #dir: string;
	readonly #recordings = new Map<string, Recording>();

	constructor(userData: string) {
		this.#dir = path.join(userData, "recordings");
		fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
	}

	start(input: { terminalId: string; cols: number; rows: number; title: string }): RecordingStatus {
		const current = this.#recordings.get(input.terminalId);
		if (current?.state === "recording") return this.#status(current);
		const file = path.join(this.#dir, recordingFileName(input.terminalId));
		const header = {
			studiocast: 1,
			cols: Math.max(2, Math.min(500, Math.round(input.cols) || 80)),
			rows: Math.max(2, Math.min(200, Math.round(input.rows) || 24)),
			title: input.title.slice(0, 200),
		};
		fs.writeFileSync(file, `${JSON.stringify(header)}\n`, { encoding: "utf8", mode: 0o600 });
		const recording: Recording = {
			terminalId: input.terminalId,
			file,
			startedAt: Date.now(),
			cols: header.cols,
			rows: header.rows,
			state: "recording",
			bytes: Buffer.byteLength(JSON.stringify(header)) + 1,
		};
		this.#recordings.set(input.terminalId, recording);
		return this.#status(recording);
	}

	append(terminalId: string, data: string): void {
		const recording = this.#recordings.get(terminalId);
		if (!recording || recording.state !== "recording" || data === "") return;
		const frame = `${JSON.stringify([Date.now() - recording.startedAt, { t: "output", data }])}\n`;
		const size = Buffer.byteLength(frame);
		if (recording.bytes + size > RECORDING_MAX_BYTES) {
			recording.notice = "录制已达到 32 MiB 上限，已停止保存。";
			this.stop(terminalId);
			return;
		}
		try {
			fs.appendFileSync(recording.file, frame, "utf8");
			recording.bytes += size;
		} catch (error) {
			recording.state = "failed";
			recording.notice = error instanceof Error ? error.message : String(error);
		}
	}

	stop(terminalId: string): RecordingStatus {
		const recording = this.#recordings.get(terminalId);
		if (!recording) return { terminalId, state: "idle", elapsedMs: 0, bytes: 0 };
		if (recording.state === "recording") recording.state = "saving";
		recording.state = "saved";
		return this.#status(recording);
	}

	status(terminalId: string): RecordingStatus {
		const recording = this.#recordings.get(terminalId);
		return recording ? this.#status(recording) : { terminalId, state: "idle", elapsedMs: 0, bytes: 0 };
	}

	/** Absolute path for an artifact name, or null outside the recordings dir. */
	artifactPath(name: string): string | null {
		const base = path.basename(name);
		if (base !== name) return null;
		const candidate = path.resolve(this.#dir, base);
		return candidate.startsWith(`${path.resolve(this.#dir)}${path.sep}`) && fs.existsSync(candidate) ? candidate : null;
	}

	exportTo(artifactId: string, destination: string): void {
		const source = this.artifactPath(artifactId);
		if (!source) throw new Error("Recording not found");
		fs.copyFileSync(source, destination);
	}

	#status(recording: Recording): RecordingStatus {
		return {
			terminalId: recording.terminalId,
			state: recording.state,
			elapsedMs: Date.now() - recording.startedAt,
			bytes: recording.bytes,
			...(recording.state === "saved" ? { artifactId: path.basename(recording.file) } : {}),
			...(recording.notice ? { notice: recording.notice } : {}),
		};
	}
}
