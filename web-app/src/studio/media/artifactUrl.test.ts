import { afterEach, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { StudioClient } from "@linxiraos/studio-contract";
import {
  resolveArtifactContext,
  resolveArtifactUrl,
  useArtifactResource,
} from "./artifactUrl";

function fake(resourceUrl: string) {
  const query = vi.fn(async (name: string, input: unknown) => {
    if (name === "artifacts.resource") return { url: resourceUrl };
    throw new Error(`Unexpected query ${name} ${JSON.stringify(input)}`);
  });
  return { client: { query } as unknown as StudioClient, query };
}

afterEach(() => vi.unstubAllGlobals());

it("uses the relative authenticated resource URL in the browser", async () => {
  const { client, query } = fake(
    "/api/v1/artifacts/opaque%2Fid?contextId=ctx%2B1",
  );
  await expect(
    resolveArtifactUrl(client, "opaque/id", null),
  ).resolves.toBe("/api/v1/artifacts/opaque%2Fid?contextId=ctx%2B1");
  expect(query).toHaveBeenCalledWith("artifacts.resource", {
    artifactId: "opaque/id",
  });
});

it("routes Desktop playback through the opaque id and exact target", async () => {
  vi.stubGlobal("zetaStudioChrome", { exportArtifact: vi.fn() });
  const { client } = fake(
    "/api/v1/artifacts/opaque%2Fid?contextId=ctx%2B1",
  );
  await expect(
    resolveArtifactUrl(client, "opaque/id", "remote-1"),
  ).resolves.toBe(
    "zeta-artifact://library/opaque%2Fid?contextId=ctx%2B1&targetId=remote-1",
  );
  await expect(resolveArtifactUrl(client, "opaque/id", null)).resolves.toBe(
    "zeta-artifact://library/opaque%2Fid?contextId=ctx%2B1",
  );
});

it("reads the selected context through the actual client", async () => {
  const query = vi.fn(async () => ({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    contextId: "context-1",
  }));
  await expect(
    resolveArtifactContext({ query } as unknown as StudioClient),
  ).resolves.toEqual({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    contextId: "context-1",
  });
  expect(query).toHaveBeenCalledWith("artifacts.context", {});
});

it.each([
  "https://example.test/api/v1/artifacts/a?contextId=c",
  "/api/v1/artifacts/a",
  "/api/v1/artifacts/a?contextId=c&token=secret",
  "//example.test/api/v1/artifacts/a?contextId=c",
  "/api/v1/artifacts/../a?contextId=c",
  "/api/v1/artifacts/a?contextId=c#fragment",
])("rejects a resource URL outside the Host contract: %s", async (url) => {
  const { client } = fake(url);
  await expect(resolveArtifactUrl(client, "a")).rejects.toThrow();
});

it("never republishes a resource URL after the selection changes", async () => {
  const pending = new Map<
    string,
    { resolve: (value: { url: string }) => void }
  >();
  const query = vi.fn(async (_name: string, input: { artifactId: string }) => {
    const { promise, resolve } = Promise.withResolvers<{ url: string }>();
    pending.set(input.artifactId, { resolve });
    return promise;
  });
  const client = { query } as unknown as StudioClient;
  const { result, rerender } = renderHook(
    ({ id, session }: { id: string; session: string }) =>
      useArtifactResource(client, id, null, session),
    { initialProps: { id: "first", session: "session-1" } },
  );
  await waitFor(() => expect(pending.has("first")).toBe(true));
  rerender({ id: "second", session: "session-1" });
  await waitFor(() => expect(pending.has("second")).toBe(true));
  pending
    .get("second")!
    .resolve({ url: "/api/v1/artifacts/second?contextId=context-1" });
  await waitFor(() =>
    expect(result.current.url).toBe(
      "/api/v1/artifacts/second?contextId=context-1",
    ),
  );
  pending
    .get("first")!
    .resolve({ url: "/api/v1/artifacts/first?contextId=context-1" });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(result.current.url).toBe(
    "/api/v1/artifacts/second?contextId=context-1",
  );
});
