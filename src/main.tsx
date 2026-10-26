import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./ui/App";
import { restoreSaved, startAutosave } from "./store/autosave";

// Ganchos para pruebas automáticas, solo con #test en la dirección.
if (location.hash === "#test") {
  void Promise.all([import("./scene/api"), import("./store/project"), import("./scene/cableCurve")]).then(([a, p, c]) => {
    (window as unknown as Record<string, unknown>).__k = { api: a.sceneApi, store: p.useProject, cableMid: c.cableMid };
  });
}

// Abre la última mesa guardada en este navegador y sigue guardando cada cambio.
restoreSaved();
startAutosave();

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
