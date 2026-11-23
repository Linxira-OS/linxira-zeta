/** Side panel entry: theme before first paint, a port to the worker for this window, then the app. */
import "@linxiraos/browser-panel/src/styles/tokens.css";
import "@linxiraos/browser-panel/src/styles/base.css";
import "@linxiraos/browser-panel/src/components/shell/shell.css";
import "@linxiraos/browser-panel/src/components/transcript/transcript.css";
import "./panel.css";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyMirroredTheme } from "./storage";
import { WorkerClient } from "./worker-client";

applyMirroredTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("panel.html has no #root");
const { id: windowId } = await chrome.windows.getCurrent();
if (windowId === undefined) throw new Error("The side panel is not attached to a window");
const worker = new WorkerClient(windowId);
window.addEventListener("pagehide", () => worker.close());
createRoot(root).render(<App worker={worker} windowId={windowId} />);
