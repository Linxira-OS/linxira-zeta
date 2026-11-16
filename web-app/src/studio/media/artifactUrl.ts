import { useEffect, useRef, useState } from "react";
import type { StudioClient } from "@linxiraos/studio-contract";

/**
 * Artifact payloads stay behind the Host's authenticated HTTP surface. The
 * `artifacts.resource` query returns a relative URL bound to the caller's
 * selected session; the renderer either uses that URL directly (browser) or
 * hands the opaque identity to the Desktop bridge (Electron), which resolves
 * the bytes through the exact same Host connection.
 */
const RESOURCE_PATH = "/api/v1/artifacts/";
const CONTEXT_PARAM = "contextId";
const MAX_OPAQUE_LENGTH = 1024;

export interface ArtifactContextInfo {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly contextId: string;
}

export interface ArtifactResourceState {
  readonly url?: string;
  readonly error?: string;
}

/** Opaque Host identities are non-empty, bounded and free of control bytes. */
function opaque(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_OPAQUE_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error(`Invalid artifact ${label}`);
  return value;
}

/** Query the live selected session/workspace/context from the actual client. */
export async function resolveArtifactContext(
  client: StudioClient,
): Promise<ArtifactContextInfo> {
  const value = await client.query("artifacts.context", {});
  return {
    sessionId: opaque(value.sessionId, "session"),
    workspaceId: opaque(value.workspaceId, "workspace"),
    contextId: opaque(value.contextId, "context"),
  };
}

/**
 * The resource URL is emitted by the Host: same-origin, relative, one opaque
 * artifact path and exactly one `contextId` parameter. Anything carrying a
 * scheme, credentials, a token or a private path is rejected.
 */
function relativeResourceUrl(value: unknown): {
  url: string;
  contextId: string;
} {
  const url = opaque(value, "resource URL");
  if (!url.startsWith(RESOURCE_PATH) || url.includes("\\") || url.includes("#"))
    throw new Error("Invalid artifact resource URL");
  const parsed = new URL(url, "http://artifact.invalid");
  if (
    parsed.origin !== "http://artifact.invalid" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.startsWith(RESOURCE_PATH)
  )
    throw new Error("Invalid artifact resource URL");
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== CONTEXT_PARAM)
    throw new Error("Invalid artifact resource scope");
  return {
    url,
    contextId: opaque(parsed.searchParams.get(CONTEXT_PARAM), "context"),
  };
}

/** Whether the renderer is running inside the Desktop shell bridge. */
export function hasDesktopArtifactBridge(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.zetaStudioChrome?.exportArtifact === "function"
  );
}

/**
 * Desktop fetch route: the native handler resolves the opaque artifact id over
 * the connection selected by `targetId` and the Host-issued `contextId`.
 * Local execution omits `targetId`.
 */
export function libraryArtifactUrl(
  artifactId: string,
  contextId: string,
  targetId?: string | null,
): string {
  const id = opaque(artifactId, "id");
  const context = opaque(contextId, "context");
  const params = new URLSearchParams({ [CONTEXT_PARAM]: context });
  if (targetId) params.set("targetId", opaque(targetId, "target"));
  return `zeta-artifact://library/${encodeURIComponent(id)}?${params.toString()}`;
}

/**
 * Resolve an artifact to something the renderer can render/fetch: a relative
 * HTTP URL in the browser, a `zeta-artifact://` URL in Desktop. No bytes are
 * read here; callers own their fetch/abort lifecycle.
 */
export async function resolveArtifactUrl(
  client: StudioClient,
  artifactId: string,
  targetId?: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const id = opaque(artifactId, "id");
  const resource = await client.query("artifacts.resource", { artifactId: id });
  if (signal?.aborted) {
    const error = new Error("Artifact resource request aborted");
    error.name = "AbortError";
    throw error;
  }
  const { url, contextId } = relativeResourceUrl(resource.url);
  return hasDesktopArtifactBridge()
    ? libraryArtifactUrl(id, contextId, targetId)
    : url;
}

type Resolution = {
  readonly client: StudioClient;
  readonly artifactId: string;
  readonly targetId: string | null | undefined;
  readonly sessionId: string | undefined;
  readonly url?: string;
  readonly error?: string;
};

/**
 * React lifecycle for one artifact resource. Every client/session/target
 * change and unmount invalidates the in-flight query, so a late answer can
 * never republish a URL for another selection.
 */
export function useArtifactResource(
  client: StudioClient | undefined,
  artifactId: string | undefined,
  targetId?: string | null,
  sessionId?: string | undefined,
): ArtifactResourceState {
  const [value, setValue] = useState<Resolution>();
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    if (!client || !artifactId) {
      setValue(undefined);
      return () => controller.abort();
    }
    void resolveArtifactUrl(
      client,
      artifactId,
      targetId,
      controller.signal,
    ).then(
      (url) => {
        if (generation.current === token)
          setValue({ client, artifactId, targetId, sessionId, url });
      },
      (cause) => {
        if (generation.current === token && !controller.signal.aborted)
          setValue({
            client,
            artifactId,
            targetId,
            sessionId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      },
    );
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [client, artifactId, targetId, sessionId]);
  if (
    !value ||
    value.client !== client ||
    value.artifactId !== artifactId ||
    value.targetId !== targetId ||
    value.sessionId !== sessionId
  )
    return {};
  return value.url !== undefined ? { url: value.url } : { error: value.error ?? "" };
}
