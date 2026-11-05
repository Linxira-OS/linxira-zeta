/**
 * Host boot: Zeta mounts the unmodified Studio renderer.
 *
 * Studio's `mountRenderer(element, client)` takes the client from its host, so
 * this file is the whole browser-side integration: build Zeta's client, hand it
 * over. Nothing in `src/studio` is edited for this.
 */
import { mountRenderer } from "../studio/main";
import { StudioClientImpl } from "../zeta";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

mountRenderer(root, new StudioClientImpl());
