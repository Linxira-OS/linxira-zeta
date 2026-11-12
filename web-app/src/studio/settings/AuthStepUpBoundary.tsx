/**
 * Global 2FA step-up boundary.
 *
 * The server answers `403 {"error":"totp_required"}` **before** executing any
 * operation, so answering that challenge and replaying the request once cannot
 * produce a duplicate write. This module owns that protocol for the whole app:
 *
 * 1. a fetch wrapper notices the challenge;
 * 2. the boundary renders a code prompt (TOTP or recovery code);
 * 3. `POST /api/auth/2fa/verify` unlocks the caller's window;
 * 4. the original request is replayed **exactly once**.
 *
 * Replay-once is per fetch invocation: the wrapper never calls itself recursively
 * for a retry, so one call gets at most one replay and a still-refused retry is
 * returned to the caller unchanged. Independent calls are not marked: a later
 * challenge (for example after the verify window expires) prompts again.
 *
 * Wire it once, high in the tree:
 *
 * ```tsx
 * <AuthStepUpBoundary>{children}</AuthStepUpBoundary>
 * ```
 *
 * The wrapper is exported separately so a caller with its own transport can
 * reuse the protocol without rendering the UI.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { verifyTwoFactor } from "./securityApi";
import { defaultGatewayFetch, type GatewayFetch } from "./gatewayRequest";

export type StepUpPrompt = () => Promise<string | null>;

type PromptResult = string | null;

export interface PromptRequest {
	readonly resolve: (value: PromptResult) => void;
}

/** One prompt at a time; later challenges queue behind the open one. */
let prompter: ((request: PromptRequest) => void) | null = null;
const queue: PromptRequest[] = [];
let active = false;

function requestCode(): Promise<PromptResult> {
	const { promise, resolve } = Promise.withResolvers<PromptResult>();
	const request: PromptRequest = { resolve };
	if (prompter === null) {
		// No UI mounted: fail closed rather than hang a request forever.
		resolve(null);
		return promise;
	}
	if (active) {
		queue.push(request);
		return promise;
	}
	active = true;
	prompter(request);
	return promise;
}

function settle(result: PromptResult): void {
	const next = queue.shift();
	if (next === undefined) {
		active = false;
		return;
	}
	prompter?.({ resolve: next.resolve });
	if (result === null) {
		// Cancel drains the queue so nothing waits on a prompt that is gone.
		while (queue.length > 0) queue.shift()?.resolve(null);
		active = false;
	}
}

interface TotpChallenge {
	readonly error: string;
	readonly stepUp?: boolean;
}

async function readChallenge(response: Response): Promise<TotpChallenge | null> {
	if (response.status !== 403) return null;
	try {
		const body: unknown = await response.clone().json();
		if (body === null || typeof body !== "object" || !("error" in body)) return null;
		if (body.error !== "totp_required") return null;
		return { error: "totp_required", ...("stepUp" in body && body.stepUp === true ? { stepUp: true } : {}) };
	} catch {
		return null;
	}
}

/**
 * Whether a request body can be sent twice.
 *
 * A stream is consumed by the first attempt; replaying it would re-send an
 * empty or a doubled body. Everything the app actually sends (JSON strings,
 * URL-encoded forms, blobs, buffers) is replayable.
 */
function replayableBody(init: RequestInit | undefined): boolean {
	const body = init?.body;
	if (body === undefined || body === null) return true;
	return (
		typeof body === "string" ||
		body instanceof URLSearchParams ||
		body instanceof Blob ||
		body instanceof ArrayBuffer ||
		ArrayBuffer.isView(body) ||
		body instanceof FormData
	);
}

export interface StepUpFetchOptions {
	/** Prompt implementation; production uses the mounted React boundary. */
	readonly prompt?: StepUpPrompt;
}

/**
 * Wrap a fetcher with the challenge → verify → replay-once protocol.
 *
 * Replay safety: a `Request` input is cloned **before** the first attempt, so
 * the original body is still unread for the retry. A streaming `init.body` is
 * never replayed — the challenge is returned as-is instead of risking a
 * duplicate or a truncated write.
 *
 * Replay-once is local to this invocation. There is deliberately no process-
 * wide "already retried" set: one successful step-up must not suppress a later
 * challenge from an independent request, and URL-keyed global markers would
 * grow without bound.
 */
/** The general fetch shape this wrapper accepts. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const defaultInner: FetchLike = (input, init) =>
	typeof input === "string" ? defaultGatewayFetch(input, init) : fetch(input, init);

export function createStepUpFetch(inner: FetchLike = defaultInner, options: StepUpFetchOptions = {}): FetchLike {
	const ask = options.prompt ?? requestCode;
	return async (input, init) => {
		const primary: RequestInfo | URL = input instanceof Request ? input.clone() : input;
		const response = await inner(primary, init as RequestInit | undefined);
		const challenge = await readChallenge(response);
		if (challenge === null) return response;

		const replayable =
			(typeof input === "string" || input instanceof URL || input instanceof Request) &&
			replayableBody(init as RequestInit | undefined);
		if (!replayable) return response;

		const code = await ask();
		if (code === null) return response;
		try {
			// `verifyTwoFactor` speaks the gateway shape (a path string); adapt the
			// general fetcher once here instead of widening every settings pane.
			const gateway: GatewayFetch = (path, init) => inner(path, init);
			await verifyTwoFactor(gateway, { code });
		} catch {
			return Response.json({ error: "totp_required", retryable: true }, { status: 403 });
		}
		// Exactly one replay. The retry is not passed through the challenge
		// handler again; a second 403 is returned to the caller.
		return inner(input, init as RequestInit | undefined);
	};
}

/** Default wrapper installed for the app's settings panes. */
export const stepUpFetch = createStepUpFetch();

export interface AuthStepUpBoundaryProps {
	readonly children?: ReactNode;
	readonly labels?: {
		readonly title: string;
		readonly description: string;
		readonly code: string;
		readonly placeholder: string;
		readonly verify: string;
		readonly cancel: string;
	};
}

const DEFAULT_LABELS = {
	title: "输入二次验证码",
	description: "输入验证器中的 6 位验证码，或使用一个恢复码。验证后会继续刚才的操作。",
	code: "验证码",
	placeholder: "123 456",
	verify: "验证",
	cancel: "取消",
};

/**
 * Renders children plus the step-up prompt. Mount it once, above the surfaces
 * that can hit `totp_required` (chat, settings, device actions).
 */
export function AuthStepUpBoundary({ children, labels = DEFAULT_LABELS }: AuthStepUpBoundaryProps): ReactNode {
	const [open, setOpen] = useState(false);
	const [code, setCode] = useState("");
	const pending = useRef<PromptRequest | null>(null);

	useEffect(() => {
		prompter = request => {
			pending.current = request;
			setCode("");
			setOpen(true);
		};
		return () => {
			prompter = null;
			pending.current?.resolve(null);
			pending.current = null;
		};
	}, []);

	const close = useCallback((value: PromptResult) => {
		setOpen(false);
		const request = pending.current;
		pending.current = null;
		request?.resolve(value);
		settle(value);
	}, []);

	// The wrapper (`createStepUpFetch`) owns the single verify call. The
	// boundary only collects the code; verifying here would consume the step
	// before the wrapper replays the challenged request.
	const submit = useCallback(() => {
		const trimmed = code.trim();
		if (trimmed === "") return;
		close(trimmed);
	}, [close, code]);

	if (!open) return children ?? null;

	return (
		<>
			{children}
			<div className="modal-backdrop" role="presentation" data-auth-stepup>
				<section className="modal" role="dialog" aria-modal="true" aria-label={labels.title}>
					<h2>{labels.title}</h2>
					<p className="muted small">{labels.description}</p>
					<input
						className="input"
						inputMode="numeric"
						autoComplete="one-time-code"
						aria-label={labels.code}
						placeholder={labels.placeholder}
						value={code}
						autoFocus
						onChange={event => setCode(event.target.value)}
						onKeyDown={event => {
							if (event.key === "Enter") void submit();
							if (event.key === "Escape") close(null);
						}}
					/>
					<div className="sec-actions">
						<button type="button" className="btn small" disabled={code.trim() === ""} onClick={() => submit()}>
							{labels.verify}
						</button>
						<button type="button" className="btn small outline" onClick={() => close(null)}>
							{labels.cancel}
						</button>
					</div>
				</section>
			</div>
		</>
	);
}
