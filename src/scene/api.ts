// Puente entre la interfaz (HTML) y la escena 3D. La escena registra estas funciones.

export interface SceneApi {
  /** Punto de la mesa (mm) bajo un punto de la pantalla, o null si está fuera del lienzo. */
  screenToTable: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** Centro de la vista actual sobre la mesa. */
  viewCenter: () => { x: number; y: number };
  zoomBy: (factor: number) => void;
  fit: () => void;
  rotateView: (dir: 1 | -1) => void;
  /** Vuelve a la vista isométrica más cercana. */
  isoView: () => void;
  /** Arrastre que empieza fuera del lienzo (desde la biblioteca). */
  externalDrag: (id: number | null, clientX?: number, clientY?: number) => void;
  /** Punto de la pantalla donde se ve un punto de la mesa (para pruebas automáticas). */
  toScreen: (p: [number, number, number]) => { x: number; y: number };
}

const noop = () => {};
export const sceneApi: SceneApi = {
  screenToTable: () => null,
  viewCenter: () => ({ x: 0, y: 0 }),
  zoomBy: noop,
  fit: noop,
  rotateView: noop,
  isoView: noop,
  externalDrag: noop,
  toScreen: () => ({ x: 0, y: 0 }),
};

/** Elementos HTML que la escena mueve en cada cuadro: botones flotantes y ejes. */
export const overlay: { partTools: HTMLElement | null; cableTools: HTMLElement | null; axes: SVGSVGElement | null } = {
  partTools: null,
  cableTools: null,
  axes: null,
};
