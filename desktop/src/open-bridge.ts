import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const EDITOR_COMMANDS = {
	vscode: { command: "code", label: "VS Code" },
	cursor: { command: "cursor", label: "Cursor" },
	codium: { command: "codium", label: "VSCodium" },
	windsurf: { command: "windsurf", label: "Windsurf" },
	zed: { command: "zed", label: "Zed" },
} as const;

export type EditorId = keyof typeof EDITOR_COMMANDS;
export type OpenTargetId = "file-manager" | `editor:${EditorId}`;

export interface DesktopOpenTarget {
	id: OpenTargetId;
	label: string;
}

export interface GatewayOpenPath {
	path: string;
	token: string;
}

export interface ValidatedOpenTarget {
	targetId: OpenTargetId;
	path: string;
}

export function createGatewayOpenToken(targetPath: string, secret: string): string {
	return crypto.createHmac("sha256", secret).update(targetPath).digest("hex");
}

export function editorCommand(editorId: EditorId): string {
	return EDITOR_COMMANDS[editorId].command;
}

export function openTargetLabel(editorId: EditorId): string {
	return EDITOR_COMMANDS[editorId].label;
}

export function isOpenTargetId(value: unknown): value is OpenTargetId {
	if (value === "file-manager") return true;
	if (typeof value !== "string" || !value.startsWith("editor:")) return false;
	const editorId = value.slice("editor:".length);
	return Object.hasOwn(EDITOR_COMMANDS, editorId);
}

function isSafeAbsolutePath(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 32_768 && !value.includes("\0") && path.isAbsolute(value);
}

function isPathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Validate the gateway capability before any platform opener is invoked. */
export function validateGatewayOpenTarget(
	targetId: unknown,
	value: unknown,
	workspacePath: string,
	secret: string,
	realpath: (targetPath: string) => string = fs.realpathSync.native,
): ValidatedOpenTarget | null {
	if (!isOpenTargetId(targetId) || !value || typeof value !== "object") return null;
	const candidate = value as Partial<GatewayOpenPath>;
	if (!isSafeAbsolutePath(candidate.path) || typeof candidate.token !== "string") return null;
	const expectedToken = createGatewayOpenToken(candidate.path, secret);
	const candidateToken = Buffer.from(candidate.token);
	const expectedTokenBytes = Buffer.from(expectedToken);
	if (candidateToken.length !== expectedTokenBytes.length || !crypto.timingSafeEqual(candidateToken, expectedTokenBytes)) return null;

	try {
		const workspace = realpath(workspacePath);
		const targetPath = realpath(candidate.path);
		if (!isPathWithin(workspace, targetPath) || !fs.statSync(targetPath).isDirectory()) return null;
		return { targetId, path: targetPath };
	} catch {
		return null;
	}
}

export function listHostOpenTargets(
	platform: NodeJS.Platform = process.platform,
	commandAvailable: (command: string) => boolean = (command) => {
		const lookup = platform === "win32" ? "where.exe" : "which";
		return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
	},
): DesktopOpenTarget[] {
	if (!(platform === "win32" || platform === "darwin" || platform === "linux")) return [];
	const targets: DesktopOpenTarget[] = [{ id: "file-manager", label: "File manager" }];
	for (const [editorId, editor] of Object.entries(EDITOR_COMMANDS)) {
		if (commandAvailable(editor.command)) targets.push({ id: `editor:${editorId}` as OpenTargetId, label: editor.label });
	}
	return targets;
}

export function editorIdFromTarget(targetId: OpenTargetId): EditorId | null {
	if (!targetId.startsWith("editor:")) return null;
	const editorId = targetId.slice("editor:".length);
	return Object.hasOwn(EDITOR_COMMANDS, editorId) ? editorId as EditorId : null;
}
