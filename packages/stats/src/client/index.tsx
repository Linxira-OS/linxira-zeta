import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./App";

// The locale resolves when `./i18n` is first imported (the server stamps the
// host CLI's language into the page before this module runs), so the app is
// already rendering in the right language by the time React mounts.

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
