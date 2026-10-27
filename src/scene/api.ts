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
  /** Llamadas de dibujo y triángulos del último cuadro (para medir el rendimiento). */
  renderInfo: () => { calls: number; triangles: number; geometries: number; textures: number };
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
  renderInfo: () => ({ calls: 0, triangles: 0, geometries: 0, textures: 0 }),
};

/** Elementos HTML que la escena mueve en cada cuadro: botones flotantes y ejes. */
export const overlay: {
  partTools: HTMLElement | null; cableTools: HTMLElement | null; beltTools: HTMLElement | null;
  jointTools: HTMLElement | null; offerTools: HTMLElement | null; axes: SVGSVGElement | null;
} = {
  jointTools: null,
  offerTools: null,
  partTools: null,
  cableTools: null,
  beltTools: null,
  axes: null,
};
