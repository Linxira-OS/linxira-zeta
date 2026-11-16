/** Validate the desktop terminal boundary before anything reaches the Host. */
export interface TerminalCommand {
	readonly shell: "bash" | "sh" | "zsh" | "powershell";
	readonly text: string;
}

export interface TerminalCreateInput {
	cols?: number;
	rows?: number;
	targetId?: string;
	workspaceId?: string;
	instanceId?: string;
	profileId?: string;
	cwd?: string;
	command?: TerminalCommand;
	flowControl?: boolean;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid terminal create input");
	return value as Record<string, unknown>;
}

export function terminalString(value: unknown, name: string, max = 4096): string {
	if (typeof value !== "string" || !value || value.length > max || value.includes("\0")) throw new Error(`Invalid ${name}`);
	return value;
}

export function terminalDimension(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 1000) {
		throw new Error(`${name} must be an integer in [2, 1000]`);
	}
	return value;
}

export function parseTerminalCreate(value: unknown): TerminalCreateInput & { cols: number; rows: number } {
	const input = value === undefined ? {} : record(value);
	const allowed: Record<string, true> = { cols: true, rows: true, targetId: true, workspaceId: true, instanceId: true, profileId: true, cwd: true, command: true, flowControl: true };
	for (const key of Object.keys(input)) if (!Object.hasOwn(allowed, key)) throw new Error(`Unexpected terminal create field: ${key}`);
	if (input.flowControl !== undefined && typeof input.flowControl !== "boolean") throw new Error("Invalid flowControl");
	if (input.flowControl === true) throw new Error("Terminal output flow control is unavailable on this Host");
	const result: TerminalCreateInput & { cols: number; rows: number } = {
		cols: input.cols === undefined ? 80 : terminalDimension(input.cols, "cols"),
		rows: input.rows === undefined ? 24 : terminalDimension(input.rows, "rows"),
	};
	for (const key of ["targetId", "workspaceId", "instanceId", "profileId", "cwd"] as const) {
		if (input[key] !== undefined) result[key] = terminalString(input[key], key);
	}
	if (result.instanceId && !/^[A-Za-z0-9._-]{1,64}$/.test(result.instanceId)) throw new Error("Invalid instanceId");
	if (input.command !== undefined) {
		const command = record(input.command);
		if (Object.keys(command).some(key => key !== "shell" && key !== "text")) throw new Error("Invalid terminal command fields");
		if (!["bash", "sh", "zsh", "powershell"].includes(String(command.shell))) throw new Error("Unsupported terminal command shell");
		const text = terminalString(command.text, "terminal command", 1_048_576);
		if (!text.trim() || Buffer.byteLength(text, "utf8") > 1_048_576) throw new Error("Terminal command must contain at most 1 MiB of UTF-8 text");
		if (result.profileId) throw new Error("Terminal command cannot be combined with a shell profile");
		result.command = { shell: command.shell as TerminalCommand["shell"], text };
	}
	return result;
}
