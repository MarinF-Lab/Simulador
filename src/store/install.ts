// App instalable: guarda el aviso de instalación de Chrome para ofrecerlo desde el menú Proyecto.

import { create } from "zustand";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  /** Aviso que Chrome deja guardado cuando la app se puede instalar. */
  prompt: InstallPrompt | null;
  /** Ya corre como app instalada (o dentro de la app de Android). */
  installed: boolean;
}

const standalone = () => {
  try {
    return matchMedia("(display-mode: standalone)").matches || "Capacitor" in window;
  } catch {
    return false;
  }
};

export const useInstall = create<InstallState>(() => ({ prompt: null, installed: standalone() }));

export function listenInstall(): void {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPrompt });
  });
  addEventListener("appinstalled", () => useInstall.setState({ prompt: null, installed: true }));
}

/** Abre el aviso de Chrome. Devuelve true si la persona aceptó. */
export async function install(): Promise<boolean> {
  const p = useInstall.getState().prompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  useInstall.setState({ prompt: null });
  return outcome === "accepted";
}

/** Link fijo al APK más reciente que arma GitHub. */
export const APK_URL = "https://github.com/MarinF-Lab/Simulador/releases/latest/download/kinetic.apk";
