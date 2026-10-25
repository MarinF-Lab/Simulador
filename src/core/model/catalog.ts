// Catálogo de piezas de la biblioteca. Datos puros, sin React.

export type CategoryId = "electrical" | "motors" | "mechanical" | "structures" | "other";

/** Familia de la pieza: decide qué secciones de Propiedades se muestran. */
export type PartKind =
  | "source" | "resistor" | "lamp" | "led" | "switch" | "wire" | "hbridge"
  | "dcmotor" | "stepper" | "servo" | "linear"
  | "shaft" | "gear" | "pulley" | "belt" | "bearing" | "support" | "link" | "joint"
  | "profile" | "plate" | "bolt"
  | "sensor" | "meter" | "text";

export interface CatalogItem {
  id: string;
  name: string;
  kind: PartKind;
  category: CategoryId;
  /** Variante visible en la tarjeta, por ejemplo "20 dientes". */
  variant?: string;
  /** Palabras extra para el buscador. */
  tags?: string[];
}

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: "electrical", name: "Eléctricos" },
  { id: "motors", name: "Motores y actuadores" },
  { id: "mechanical", name: "Mecánicos" },
  { id: "structures", name: "Estructuras" },
  { id: "other", name: "Otros" },
];

export const CATALOG: CatalogItem[] = [
  { id: "source", name: "Pila", kind: "source", category: "electrical", variant: "0,5–24 V", tags: ["fuente", "batería", "bateria"] },
  { id: "resistor", name: "Resistencia", kind: "resistor", category: "electrical" },
  { id: "lamp", name: "Ampolleta", kind: "lamp", category: "electrical", tags: ["lámpara", "lampara", "foco"] },
  { id: "led", name: "LED", kind: "led", category: "electrical", tags: ["diodo"] },
  { id: "switch", name: "Interruptor", kind: "switch", category: "electrical" },
  { id: "wire", name: "Cable", kind: "wire", category: "electrical" },
  { id: "hbridge", name: "Puente H", kind: "hbridge", category: "electrical", tags: ["controlador", "driver"] },

  { id: "dcmotor", name: "Motor DC", kind: "dcmotor", category: "motors" },
  { id: "stepper", name: "Motor paso a paso", kind: "stepper", category: "motors", tags: ["stepper"] },
  { id: "servo", name: "Servo", kind: "servo", category: "motors" },
  { id: "linear", name: "Actuador lineal", kind: "linear", category: "motors", tags: ["pistón", "piston"] },

  { id: "shaft", name: "Eje", kind: "shaft", category: "mechanical" },
  { id: "gear10", name: "Engranaje", kind: "gear", category: "mechanical", variant: "10 dientes" },
  { id: "gear20", name: "Engranaje", kind: "gear", category: "mechanical", variant: "20 dientes" },
  { id: "gear40", name: "Engranaje", kind: "gear", category: "mechanical", variant: "40 dientes" },
  { id: "pulleyS", name: "Polea", kind: "pulley", category: "mechanical", variant: "S" },
  { id: "pulleyM", name: "Polea", kind: "pulley", category: "mechanical", variant: "M" },
  { id: "pulleyL", name: "Polea", kind: "pulley", category: "mechanical", variant: "L" },
  { id: "belt", name: "Correa", kind: "belt", category: "mechanical", tags: ["liga", "banda"] },
  { id: "bearing", name: "Rodamiento", kind: "bearing", category: "mechanical" },
  { id: "support", name: "Soporte", kind: "support", category: "mechanical" },
  { id: "link", name: "Eslabón", kind: "link", category: "mechanical", tags: ["biela", "brazo"] },
  { id: "joint", name: "Junta rotacional", kind: "joint", category: "mechanical", tags: ["articulación", "bisagra"] },

  { id: "profile60", name: "Perfil metálico", kind: "profile", category: "structures", variant: "60 mm" },
  { id: "profile120", name: "Perfil metálico", kind: "profile", category: "structures", variant: "120 mm" },
  { id: "profile240", name: "Perfil metálico", kind: "profile", category: "structures", variant: "240 mm" },
  { id: "plate", name: "Placa base", kind: "plate", category: "structures" },
  { id: "bolt", name: "Unión", kind: "bolt", category: "structures", variant: "perno fijo", tags: ["perno", "tornillo"] },

  { id: "sensorAngle", name: "Sensor", kind: "sensor", category: "other", variant: "de ángulo", tags: ["encoder"] },
  { id: "sensorContact", name: "Sensor", kind: "sensor", category: "other", variant: "de contacto", tags: ["final de carrera"] },
  { id: "meter", name: "Voltímetro", kind: "meter", category: "other", tags: ["medidor"] },
  { id: "text", name: "Texto", kind: "text", category: "other", tags: ["nota", "etiqueta"] },
];

/** Quita tildes y pasa a minúsculas para comparar. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtra el catálogo por nombre, variante o palabras extra. */
export function searchCatalog(query: string, items: CatalogItem[] = CATALOG): CatalogItem[] {
  const q = normalize(query);
  if (!q) return items;
  const words = q.split(/\s+/);
  return items.filter((it) => {
    const hay = normalize([it.name, it.variant ?? "", ...(it.tags ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

export const findItem = (id: string): CatalogItem | undefined => CATALOG.find((i) => i.id === id);
