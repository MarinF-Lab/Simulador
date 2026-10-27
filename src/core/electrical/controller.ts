// Placa de control: 4 canales que reparten la entrada a sus salidas con sentido y potencia.

import type { Part } from "../model/project";

export const CHANNELS = 4;
export const MODES = ["Adelante", "Atrás", "Freno", "Apagado"] as const;
export type ChannelMode = (typeof MODES)[number];
export const ACTIONS = ["Detener", "Invertir", "Encender"] as const;
export type SensorAction = (typeof ACTIONS)[number];

export interface Channel {
  mode: ChannelMode;
  /** Potencia de 10 a 100 %: la salida es esa fracción del voltaje de entrada. */
  power: number;
  /** Sensor de contacto que cambia el canal mientras está presionado (0: ninguno). */
  sensor: number;
  action: SensorAction;
}

/** Id interno del canal k (0 a 3) en el circuito; nunca choca con ids de piezas. */
export const channelId = (part: number, k: number): number => -(1_000_000 + part * 10 + k);

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Configuración del canal k, con valores por defecto: canal 1 Adelante, el resto Apagado. */
export function channelOf(part: Pick<Part, "props">, k: number): Channel {
  const p = part.props, n = k + 1;
  return {
    mode: pick(p[`m${n}`], MODES, k === 0 ? "Adelante" : "Apagado"),
    power: Math.min(100, Math.max(10, num(p[`p${n}`], 100))),
    sensor: Math.max(0, Math.round(num(p[`s${n}`], 0))),
    action: pick(p[`a${n}`], ACTIONS, "Detener"),
  };
}

/** Modo con el que funciona el canal ahora, según su sensor. */
export function effectiveMode(c: Channel, pressed: boolean): ChannelMode {
  if (!c.sensor || !pressed) return c.mode;
  if (c.action === "Detener") return "Freno";
  if (c.action === "Invertir") return c.mode === "Adelante" ? "Atrás" : c.mode === "Atrás" ? "Adelante" : c.mode;
  return c.mode === "Apagado" || c.mode === "Freno" ? "Adelante" : c.mode;
}

/** Ganancia de la salida: ± potencia / 100, o 0 en Freno. */
export function gainOf(mode: ChannelMode, power: number): number {
  return mode === "Adelante" ? power / 100 : mode === "Atrás" ? -power / 100 : 0;
}
