// Motor DC de imanes permanentes, a partir de sus datos de placa:
//   voltaje nominal Vn, velocidad en vacío n0 (RPM) a Vn y par de arranque T0 (N·m) a Vn.
// Constantes (en el SI, Ke = Kt):
//   ω0 = n0 · 2π / 60        Ke = Kt = Vn / ω0        R = Kt · Vn / T0
// Par = Kt · (V − Ke · ω) / R      Corriente = (V − Ke · ω) / R      Vacío: ω = V / Ke

export interface MotorParams {
  vn: number;
  rpm: number;
  torque: number;
  ke: number;
  kt: number;
  r: number;
  /** Corriente de arranque a voltaje nominal (A). */
  iStall: number;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);

export function motorParams(props: Record<string, unknown>): MotorParams {
  const vn = num(props.vnom, 12), rpm = num(props.rpm, 60), torque = num(props.torque, 0.8);
  const w0 = (rpm * 2 * Math.PI) / 60;
  const ke = vn / w0;
  const r = (ke * vn) / torque;
  return { vn, rpm, torque, ke, kt: ke, r, iStall: vn / r };
}

/** Par en el eje (N·m) con voltaje V y velocidad ω (rad/s). */
export const motorTorque = (m: MotorParams, v: number, w: number): number => (m.kt * (v - m.ke * w)) / m.r;
/** Corriente (A). */
export const motorCurrent = (m: MotorParams, v: number, w: number): number => (v - m.ke * w) / m.r;
/** Velocidad en vacío (rad/s). */
export const noLoadSpeed = (m: MotorParams, v: number): number => v / m.ke;
export const toRpm = (w: number): number => (w * 60) / (2 * Math.PI);
