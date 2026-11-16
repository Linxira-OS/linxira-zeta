import { useEffect, useRef } from "react";
import type { ClientBootstrap, StudioClient } from "@linxiraos/studio-contract";
import { useSurfaceChrome } from "../dock/SurfaceContext";
import { waitReceipt } from "../hostError";
import { usePreviewMode } from "../preview/PreviewContext";
import { browserHub } from "./browserSessions";

/** One owner per conversation root, independent of how many page panes it mounts. */
export function useManagedBrowserOwner({ client, sessionId, available, capabilities, remote }: {
  client?: StudioClient | undefined;
  sessionId: string | undefined;
  available: boolean;
  capabilities: ClientBootstrap["capabilityManifest"] | undefined;
  remote: boolean;
}): void {
  const api = useSurfaceChrome()?.managedBrowser;
  const { preview } = usePreviewMode();
  const queue = useRef(Promise.resolve());
  const supported = capabilities?.capabilities.some(row => row.id === "browser.managed.prepare" && row.grade !== "unavailable") === true;
  useEffect(() => {
    if (preview || remote || !available || !supported || !client || !sessionId || !api?.attach || !api.release) return;
    let live = true;
    let attached = false;
    const attach = api.attach.bind(api), release = api.release.bind(api);
    const browser = browserHub(false, api)?.session(sessionId);
    // Serialize reconnects with the prior owner's async attach/release. A stale
    // completion cannot release a newer lease for the same session.
    queue.current = queue.current.then(async () => {
      if (!live) return;
      try {
        await client.bootstrap();
        if (!live) return;
        const command = await client.command("browser.managed.prepare", { sessionId });
        const receipt = await waitReceipt<{ result: { sessionId: string; descriptorId: string } }>(client, command.requestId, 15_000);
        if (!live) return;
        if (receipt.result.sessionId !== sessionId) throw new Error("Managed browser session changed while preparing");
        const result = await attach(receipt.result);
        attached = result.ok;
        if (!result.ok) throw new Error(result.message ?? "Managed browser connection failed");
        if (live) browser?.setOwnerReady(true);
        if (live) await browser?.read();
      } catch (error) {
        if (live) browser?.reportError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      live = false;
      browser?.setOwnerReady(false);
      queue.current = queue.current.then(async () => {
        if (attached) await release({ sessionId });
      }).catch(() => {});
    };
  }, [api, client, sessionId, available, supported, remote, preview]);
}
