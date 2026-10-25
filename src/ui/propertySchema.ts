import type { PartKind } from "../core/model/catalog";

export type Field =
  | { type: "number"; key: string; label: string; unit?: string; min: number; max: number; def: number }
  | { type: "volt"; key: string; label: string; min: number; max: number; def: number; presets: number[] }
  | { type: "slider"; key: string; label: string; unit: string; min: number; max: number; def: number }
  | { type: "select"; key: string; label: string; options: string[]; def: string }
  | { type: "toggle"; key: string; label: string; def: boolean }
  | { type: "ratio"; key: string; label: string; def: number }
  | { type: "text"; key: string; label: string; def: string }
  | { type: "reading"; label: string; value: string };

export interface Section {
  id: string;
  title: string;
  fields: Field[];
}

const motor = (extra: Field[] = []): Section => ({
  id: "motor",
  title: "Motor",
  fields: [
    { type: "number", key: "power", label: "Potencia nominal", unit: "W", min: 0.1, max: 500, def: 12 },
    { type: "number", key: "rpm", label: "Velocidad nominal", unit: "RPM", min: 1, max: 20000, def: 60 },
    { type: "number", key: "torque", label: "Par de salida", unit: "N·m", min: 0.01, max: 50, def: 0.8 },
    { type: "number", key: "vnom", label: "Voltaje nominal", unit: "V", min: 0.5, max: 24, def: 12 },
    ...extra,
  ],
});
const control: Section = {
  id: "control",
  title: "Control",
  fields: [
    { type: "select", key: "driver", label: "Controlado por", options: ["Directo", "Puente H"], def: "Puente H" },
    { type: "toggle", key: "invert", label: "Inversión de sentido", def: false },
  ],
};
const transmission = (def: string): Section => ({
  id: "transmission",
  title: "Transmisión",
  fields: [
    { type: "select", key: "ttype", label: "Tipo", options: ["Engranaje", "Polea y correa", "Correa cruzada", "Eje directo"], def },
    { type: "ratio", key: "ratio", label: "Relación de transmisión", def: 3 },
    { type: "number", key: "eff", label: "Eficiencia", unit: "%", min: 1, max: 100, def: 85 },
  ],
});
const joint: Section = {
  id: "joint",
  title: "Articulación",
  fields: [
    { type: "number", key: "amin", label: "Ángulo mínimo", unit: "°", min: -180, max: 180, def: -90 },
    { type: "number", key: "amax", label: "Ángulo máximo", unit: "°", min: -180, max: 180, def: 90 },
    { type: "slider", key: "speed", label: "Velocidad de movimiento", unit: "°/s", min: 1, max: 180, def: 45 },
  ],
};
const arm: Section = {
  id: "arm",
  title: "Brazo",
  fields: [
    { type: "slider", key: "t1", label: "θ1 · base", unit: "°", min: -90, max: 90, def: 20 },
    { type: "slider", key: "t2", label: "θ2 · codo", unit: "°", min: -90, max: 90, def: -35 },
  ],
};
const circuit: Section = {
  id: "circuit",
  title: "Circuito eléctrico",
  fields: [
    { type: "reading", label: "Estado", value: "Sin simular" },
    { type: "reading", label: "Voltaje", value: "— V" },
    { type: "reading", label: "Corriente", value: "— A" },
    { type: "reading", label: "Componentes activos", value: "—" },
  ],
};
const electric = (fields: Field[]): Section => ({ id: "elec", title: "Valores", fields });

export function sectionsFor(kind: PartKind): Section[] {
  switch (kind) {
    case "dcmotor":
      return [motor(), transmission("Engranaje"), control];
    case "stepper":
      return [motor([{ type: "number", key: "steps", label: "Pasos por vuelta", min: 4, max: 1000, def: 200 }]), control];
    case "servo":
      return [motor(), joint, arm];
    case "linear":
      return [motor([{ type: "number", key: "stroke", label: "Carrera", unit: "mm", min: 10, max: 500, def: 100 }]), control];
    case "gear":
      return [transmission("Engranaje")];
    case "pulley":
    case "belt":
      return [transmission("Polea y correa")];
    case "shaft":
      return [transmission("Eje directo")];
    case "joint":
    case "link":
      return [joint, arm];
    case "source":
      return [electric([{ type: "volt", key: "v", label: "Voltaje de la pila", min: 0.5, max: 24, def: 9, presets: [1.5, 3.7, 9, 12] }]), circuit];
    case "resistor":
      return [electric([{ type: "select", key: "r", label: "Resistencia", options: ["10 Ω", "100 Ω", "470 Ω", "1 kΩ"], def: "100 Ω" }]), circuit];
    case "lamp":
      return [electric([{ type: "volt", key: "vn", label: "Voltaje que soporta", min: 1.5, max: 24, def: 6, presets: [3, 6, 12] }]), circuit];
    case "led":
      return [electric([{ type: "volt", key: "vf", label: "Voltaje de encendido", min: 1.5, max: 3.5, def: 2, presets: [1.8, 2, 3] }]), circuit];
    case "switch":
      return [electric([{ type: "toggle", key: "closed", label: "Cerrado", def: true }]), circuit];
    case "hbridge":
      return [electric([{ type: "select", key: "dir", label: "Sentido", options: ["Adelante", "Atrás", "Freno"], def: "Adelante" }]), circuit];
    case "wire":
    case "meter":
      return [circuit];
    case "sensor":
      return [{ id: "sensor", title: "Lectura", fields: [{ type: "reading", label: "Valor", value: "—" }] }];
    case "text":
      return [{ id: "text", title: "Texto", fields: [{ type: "text", key: "txt", label: "Contenido", def: "Nota" }] }];
    case "profile":
    case "plate":
    case "bolt":
    case "bearing":
    case "support":
      return [];
  }
}
