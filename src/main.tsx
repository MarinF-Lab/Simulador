import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./ui/App";

// Ganchos para pruebas automáticas, solo con #test en la dirección.
if (location.hash === "#test") {
  void Promise.all([import("./scene/api"), import("./store/project")]).then(([a, p]) => {
    (window as unknown as Record<string, unknown>).__k = { api: a.sceneApi, store: p.useProject };
  });
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
