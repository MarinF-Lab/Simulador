// Utilidades puras compartidas: cuadrícula y formato de lecturas (es-CL).

/** Paso de la cuadrícula de la mesa, en mm. */
export const GRID_MM = 10;

/** Ajusta un valor al múltiplo más cercano del paso. */
export function snap(v: number, step: number = GRID_MM): number {
  const r = Math.round(v / step) * step;
  return Object.is(r, -0) ? 0 : r;
}

/** Número con coma decimal y hasta 2 decimales: 3.768 → "3,77". */
export function fmt(x: number): string {
  return Number(x.toFixed(2)).toLocaleString("es-CL");
}

/** Voltaje, siempre en voltios. */
export const fmtV = (v: number): string => `${fmt(Math.abs(v))} V`;

/** Corriente en amperes con 3 decimales; nunca en mA. */
export function fmtA(i: number): string {
  return `${Math.abs(i).toLocaleString("es-CL", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} A`;
}

/** Acepta coma o punto decimal: "4,5" → 4.5. Devuelve null si no es número. */
export function parseDecimal(s: string): number | null {
  const v = parseFloat(s.trim().replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
