import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/chakra-petch/latin-700.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import { App } from "./ui/App";
import { restoreSaved, startAutosave } from "./store/autosave";
import { listenInstall } from "./store/install";

// Ganchos para pruebas automáticas, solo con #test en la dirección.
if (location.hash === "#test") {
  void Promise.all([import("./scene/api"), import("./store/project"), import("./scene/cableCurve"), import("./core/persistence/examples"), import("./store/ui")]).then(([a, p, c, e, u]) => {
    (window as unknown as Record<string, unknown>).__k = { api: a.sceneApi, store: p.useProject, cableMid: c.cableMid, examples: e.EXAMPLES, ui: u.useUI };
  });
}

// Abre la última mesa guardada en este navegador y sigue guardando cada cambio.
restoreSaved();
startAutosave();

// App instalable: el service worker solo en la página publicada (https), no en el visor de claude.ai
// ni dentro de la app de Android (que ya trae todo).
const inClaude = /claude\.ai|claudeusercontent/.test(location.hostname) || window.top !== window || "Capacitor" in window;
if ("serviceWorker" in navigator && location.protocol === "https:" && !inClaude) {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}

listenInstall();

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
