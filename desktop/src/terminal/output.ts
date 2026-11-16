import { StringDecoder } from "node:string_decoder";

export const TERMINAL_BATCH_MS = 8;
export const TERMINAL_BUFFER_BYTES = 2 * 1024 * 1024;

/** Coalesces real Host output only; the raw PTY wire has no ACK protocol. */
export class TerminalOutput {
	readonly #decoder = new StringDecoder("utf8");
	readonly #deliver: (data: string, bytes: number) => void;
	#parts: string[] = [];
	#bytes = 0;
	#timer: NodeJS.Timeout | undefined;
	#closed = false;

	constructor(deliver: (data: string, bytes: number) => void) {
		this.#deliver = deliver;
	}

	append(chunk: Uint8Array | string): void {
		if (this.#closed) return;
		this.#append(typeof chunk === "string" ? this.#decoder.write(Buffer.from(chunk, "utf8")) : this.#decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
	}

	#append(text: string): void {
		if (!text) return;
		this.#parts.push(text);
		this.#bytes += Buffer.byteLength(text, "utf8");
		if (this.#bytes >= TERMINAL_BUFFER_BYTES) this.flush();
		else this.#timer ??= setTimeout(() => this.flush(), TERMINAL_BATCH_MS);
	}

	flush(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		if (!this.#parts.length) return;
		const data = this.#parts.length === 1 ? this.#parts[0]! : this.#parts.join("");
		const bytes = this.#bytes;
		this.#parts = [];
		this.#bytes = 0;
		this.#deliver(data, bytes);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#append(this.#decoder.end());
		this.flush();
	}
}
