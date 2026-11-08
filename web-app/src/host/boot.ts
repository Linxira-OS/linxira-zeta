/**
 * Host boot: Zeta mounts the unmodified Studio renderer.
 *
 * Studio's `mountRenderer(element, client)` takes the client from its host, so
 * this file is the whole browser-side integration: build Zeta's client, hand it
 * over. Nothing in `src/studio` is edited for this.
 */
import { mountRenderer } from "../studio/main";
import { StudioClientImpl } from "@linxiraos/studio-client";
import { BrowserWebClientTransport, type WebSocketLike } from "@linxiraos/studio-transport-web";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// The vendored client forwards every contract operation to the Studio host's
// /api/v1 surface. Loopback bootstrap auto-pairs; non-loopback still needs the
// pairing code. Keep same-origin fetch and the same-origin event socket.
const transport = new BrowserWebClientTransport({
	baseUrl: window.location.origin,
	webSocketFactory: (url: string) => new WebSocket(url) as unknown as WebSocketLike,
});
mountRenderer(root, new StudioClientImpl(transport));
