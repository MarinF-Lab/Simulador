// Control de actuadores, puro y sin física.

/** Datos de un servo: ángulos en grados, velocidad máxima en grados por segundo. */
export interface ServoSpec {
  amin: number;
  amax: number;
  speed: number;
}

/** Ángulo objetivo dentro de los límites del servo. */
export const clampTarget = (s: ServoSpec, target: number): number => Math.min(s.amax, Math.max(s.amin, target));

/** Un paso de la rampa del servo: el ángulo pedido avanza hacia el objetivo a su velocidad máxima. */
export function servoRamp(s: ServoSpec, cmd: number, target: number, dt: number): number {
  const step = s.speed * dt;
  return cmd + Math.max(-step, Math.min(step, clampTarget(s, target) - cmd));
}

/** ¿Está el servo en un tope? (pide más allá del límite y ya llegó). */
export function atLimit(s: ServoSpec, target: number, angle: number): boolean {
  return (target <= s.amin && angle <= s.amin + 2) || (target >= s.amax && angle >= s.amax - 2);
}
