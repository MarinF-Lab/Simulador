// Catálogo de piezas de la biblioteca. Datos puros, sin React.

export type CategoryId = "electrical" | "motors" | "mechanical" | "structures" | "other";

/** Familia de la pieza: decide qué secciones de Propiedades se muestran. */
export type PartKind =
  | "source" | "resistor" | "lamp" | "led" | "switch" | "wire" | "hbridge" | "controller" | "splitter"
  | "dcmotor" | "stepper" | "servo" | "linear"
  | "shaft" | "gear" | "pulley" | "belt" | "bearing" | "wheel" | "piston" | "rope" | "weight" | "support" | "link" | "joint"
  | "profile" | "plate" | "bolt" | "bracket"
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
  /** Qué es y cómo se usa en KINETIC, en una o dos frases. */
  desc: string;
}

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: "electrical", name: "Eléctricos" },
  { id: "motors", name: "Motores y actuadores" },
  { id: "mechanical", name: "Mecánicos" },
  { id: "structures", name: "Estructuras" },
  { id: "other", name: "Otros" },
];

export const CATALOG: CatalogItem[] = [
  { id: "source", name: "Pila", kind: "source", category: "electrical", variant: "0,5–24 V", tags: ["fuente", "batería", "bateria"], desc: "Da la energía al circuito. Tiene un borne + (rojo) y uno − (oscuro). Su voltaje se cambia en Propiedades, de 0,5 a 24 V." },
  { id: "resistor", name: "Resistencia", kind: "resistor", category: "electrical", desc: "Limita la corriente que pasa por el circuito. Ponla en serie con un LED o una ampolleta para que no se quemen." },
  { id: "lamp", name: "Ampolleta", kind: "lamp", category: "electrical", tags: ["lámpara", "lampara", "foco"], desc: "Se enciende cuando le llega voltaje y brilla más cuanto más cerca está de su voltaje nominal. Si recibe mucho más, se quema." },
  { id: "led", name: "LED", kind: "led", category: "electrical", tags: ["diodo"], desc: "Luz que solo enciende en un sentido: su borne + (ánodo, rojo) debe ir hacia el + de la pila. Necesita una resistencia en serie, si no, se quema." },
  { id: "switch", name: "Interruptor", kind: "switch", category: "electrical", desc: "Abre o cierra el paso de la corriente. Con el botón Abrir o Cerrar, sobre la pieza, apagas o enciendes lo que alimenta." },
  { id: "wire", name: "Cable", kind: "wire", category: "electrical", desc: "Une dos bornes. También puedes crear cables tocando un borne y luego otro. Rojo es el lado +, azul el lado −." },
  { id: "hbridge", name: "Puente H", kind: "hbridge", category: "electrical", tags: ["controlador", "driver"], desc: "Controla el sentido de un motor sin cambiar los cables. Entrada: la pila. Salida: el motor. Con su botón eliges Adelante, Atrás o Freno." },
  { id: "controller", name: "Placa de control", kind: "controller", category: "electrical", tags: ["receptor", "control remoto", "driver", "canales", "inversor"], desc: "Placa con 4 canales, como la de un auto a control remoto. Conecta la pila a su entrada y un motor o una luz a cada canal. Cada canal elige su sentido (Adelante, Atrás, Freno o Apagado) y su potencia, y puede detenerse o invertirse cuando un sensor de contacto se presiona." },
  { id: "splitter", name: "Repartidor", kind: "splitter", category: "electrical", tags: ["regleta", "bornera", "distribuidor", "repartición"], desc: "Regleta que reparte la pila a 4 salidas. Cada salida tiene su − y su +, unidos a la entrada: así alimentas varias piezas desde una sola pila." },

  { id: "dcmotor", name: "Motor DC", kind: "dcmotor", category: "motors", desc: "Gira cuando recibe voltaje: más voltaje, más rápido. Monta un engranaje, una polea o un eslabón en la punta de su eje para que lo mueva." },
  { id: "stepper", name: "Motor paso a paso", kind: "stepper", category: "motors", tags: ["stepper"], desc: "Motor que avanza en pasos fijos, por ejemplo 200 por vuelta. Sirve para girar a un ángulo exacto o a una velocidad constante." },
  { id: "servo", name: "Servo", kind: "servo", category: "motors", desc: "Motor que va a un ángulo y se queda ahí, dentro de su ángulo mínimo y máximo. Se mueve con el deslizador θ en Propiedades." },
  { id: "linear", name: "Actuador lineal", kind: "linear", category: "motors", tags: ["pistón", "piston"], desc: "Empuja o tira en línea recta: su vástago sale o entra según la polaridad. La distancia máxima es su carrera." },

  { id: "shaft", name: "Eje", kind: "shaft", category: "mechanical", desc: "Barra donde se montan engranajes y poleas para que giren juntos. Lo que está en el mismo eje gira a la misma velocidad." },
  { id: "gear10", name: "Engranaje", kind: "gear", category: "mechanical", variant: "10 dientes", desc: "Rueda dentada de 10 dientes. Si la acercas a otro engranaje encaja sola, y giran en sentidos contrarios: el chico va más rápido." },
  { id: "gear20", name: "Engranaje", kind: "gear", category: "mechanical", variant: "20 dientes", desc: "Rueda dentada de 20 dientes. Si la acercas a otro engranaje encaja sola, y giran en sentidos contrarios." },
  { id: "gear40", name: "Engranaje", kind: "gear", category: "mechanical", variant: "40 dientes", desc: "Rueda dentada de 40 dientes. Movida por una de 10, gira 4 veces más lento y con 4 veces más fuerza." },
  { id: "pulleyS", name: "Polea", kind: "pulley", category: "mechanical", variant: "S", desc: "Rueda con canal para una correa. Une dos poleas con una correa para transmitir el giro a distancia." },
  { id: "pulleyM", name: "Polea", kind: "pulley", category: "mechanical", variant: "M", desc: "Polea mediana. Une dos poleas con una correa: la grande gira más lento que la chica." },
  { id: "pulleyL", name: "Polea", kind: "pulley", category: "mechanical", variant: "L", desc: "Polea grande. Movida por una chica con una correa, gira más lento." },
  { id: "belt", name: "Correa", kind: "belt", category: "mechanical", tags: ["liga", "banda"], desc: "Une dos poleas para que giren juntas. Elige Correa y toca dos poleas. La normal mantiene el sentido de giro; la cruzada lo invierte." },
  { id: "bearing", name: "Rodamiento", kind: "bearing", category: "mechanical", desc: "Sostiene un eje para que gire suave. Se apoya en una placa o un soporte, y el eje pasa por su centro." },
  { id: "wheel", name: "Rueda", kind: "wheel", category: "mechanical", tags: ["llanta", "neumático", "neumatico", "auto"], desc: "Rueda de goma de 60 mm. Móntala en la punta del eje de un motor y gira con él; si toca el suelo, empuja lo que la lleva, como un auto." },
  { id: "piston", name: "Pistón", kind: "piston", category: "mechanical", tags: ["cilindro", "émbolo", "embolo", "biela"], desc: "Cilindro con un émbolo que se desliza libre de punta a punta. Une el perno del émbolo a una biela: al girar la manivela, el émbolo va y viene." },
  { id: "support", name: "Soporte", kind: "support", category: "mechanical", desc: "Base con un agujero arriba para sostener un eje o una junta a cierta altura." },
  { id: "rope", name: "Cuerda", kind: "rope", category: "mechanical", tags: ["hilo", "grúa", "grua", "cable de acero"], desc: "Cuelga una pieza de una polea tambor: elige Cuerda, toca la polea y luego la pieza. Al girar la polea la cuerda se enrolla y sube la carga; al revés, la baja." },
  { id: "link", name: "Eslabón", kind: "link", category: "mechanical", tags: ["biela", "brazo"], desc: "Barra con un agujero en cada extremo. Sirve para armar brazos y bielas: une sus agujeros con juntas rotacionales." },
  { id: "joint", name: "Junta rotacional", kind: "joint", category: "mechanical", tags: ["articulación", "bisagra"], desc: "Herramienta: une dos piezas por agujeros alineados para que puedan girar. Elige Junta rotacional y toca una de las piezas." },

  { id: "profile60", name: "Perfil metálico", kind: "profile", category: "structures", variant: "60 mm", desc: "Barra metálica con agujeros cada 10 mm, para armar estructuras. Su largo se cambia en Propiedades." },
  { id: "profile120", name: "Perfil metálico", kind: "profile", category: "structures", variant: "120 mm", desc: "Barra metálica con agujeros cada 10 mm, para armar estructuras. Su largo se cambia en Propiedades." },
  { id: "profile240", name: "Perfil metálico", kind: "profile", category: "structures", variant: "240 mm", desc: "Barra metálica con agujeros cada 10 mm, para armar estructuras. Su largo se cambia en Propiedades." },
  { id: "plate", name: "Placa base", kind: "plate", category: "structures", desc: "Base fija a la mesa, con agujeros cada 20 mm. Lo que se apoya encima queda unido a ella al simular. Su largo y ancho se cambian." },
  { id: "bracket", name: "Escuadra", kind: "bracket", category: "structures", variant: "en L", tags: ["ángulo", "angulo", "soporte de servo"], desc: "Pieza en forma de L: agujeros en la base y en el ala vertical. Sirve para montar un servo de lado, por ejemplo sobre otro servo, y así armar brazos que suben y bajan." },
  { id: "bolt", name: "Unión", kind: "bolt", category: "structures", variant: "perno fijo", tags: ["perno", "tornillo"], desc: "Herramienta: une dos piezas por agujeros alineados para que no se muevan entre sí, como un perno. Elige Unión y toca una de las piezas." },

  { id: "sensorAngle", name: "Sensor", kind: "sensor", category: "other", variant: "de ángulo", tags: ["encoder"], desc: "Mide el ángulo de una junta o un eje. Móntalo en la junta y verás su ángulo en vivo al simular." },
  { id: "sensorContact", name: "Sensor", kind: "sensor", category: "other", variant: "de contacto", tags: ["final de carrera"], desc: "Pulsador: cierra el circuito mientras está presionado. Lo presionas con su botón o, al simular, cuando una pieza lo toca." },
  { id: "weight", name: "Pesa", kind: "weight", category: "other", tags: ["carga", "peso"], desc: "Bloque de acero de 30 mm (unos 200 g) con un gancho arriba. Sirve como carga para una grúa o para probar la fuerza de un mecanismo." },
  { id: "meter", name: "Voltímetro", kind: "meter", category: "other", tags: ["medidor"], desc: "Voltímetro: mide el voltaje entre sus dos bornes sin afectar el circuito. Conéctalo a los extremos de lo que quieras medir." },
  { id: "text", name: "Texto", kind: "text", category: "other", tags: ["nota", "etiqueta"], desc: "Cartel para anotar algo en la mesa. Escribe el texto en Propiedades." },
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
