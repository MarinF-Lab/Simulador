import { useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEFAULT_SHAPE, sizeOf } from "../core/model/project";
import { gridInside, parseShape } from "../core/model/polygon";

// Modelos 3D simples de cada pieza. Cada modelo se arma con la base en z = 0 y centrado
// en x, y; el contenedor lo baja a la mitad de su alto para que gire sobre su centro.

const mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...o });

export const M = {
  steel: mat("#9aa3b5", { metalness: 0.75, roughness: 0.35 }),
  dark: mat("#2a3146", { metalness: 0.4, roughness: 0.5 }),
  body: mat("#3b4566", { metalness: 0.3 }),
  accent: mat("#5b5bd6", { metalness: 0.2 }),
  red: mat("#d64545"),
  black: mat("#15171f"),
  copper: mat("#c07a45", { metalness: 0.7, roughness: 0.35 }),
  pcb: mat("#1f5a46"),
  beige: mat("#d8c6a0", { roughness: 0.8 }),
  glass: mat("#f4e9c8", { transparent: true, opacity: 0.6, roughness: 0.1, emissive: "#3a2f10" }),
  led: mat("#ff5a5a", { transparent: true, opacity: 0.85, roughness: 0.2 }),
  rubber: mat("#1b1b1b", { roughness: 0.9, metalness: 0 }),
  white: mat("#e8ebf3"),
  hole: mat("#0b0e18", { roughness: 1, metalness: 0 }),
};

type V3 = [number, number, number];

function Box({ s, p = [0, 0, 0], m }: { s: V3; p?: V3; m: THREE.Material }) {
  return (
    <mesh position={[p[0], p[1], p[2] + s[2] / 2]} material={m} castShadow receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

const ROT: Record<"x" | "y" | "z", V3> = { z: [Math.PI / 2, 0, 0], x: [0, 0, Math.PI / 2], y: [0, 0, 0] };

/** Cilindro de radio r y largo h. Con eje "z" queda parado con su base en p. */
function Cyl({ r, h, p = [0, 0, 0], axis = "z", m, seg = 32 }: { r: number; h: number; p?: V3; axis?: "x" | "y" | "z"; m: THREE.Material; seg?: number }) {
  const pos: V3 = axis === "z" ? [p[0], p[1], p[2] + h / 2] : p;
  return (
    <mesh position={pos} rotation={ROT[axis]} material={m} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, h, seg]} />
    </mesh>
  );
}

const gearCache = new Map<string, THREE.ExtrudeGeometry>();
function gearGeometry(teeth: number, r: number, h: number): THREE.ExtrudeGeometry {
  const k = `${teeth}:${r}:${h}`;
  const hit = gearCache.get(k);
  if (hit) return hit;
  const shape = new THREE.Shape();
  const w = Math.PI / teeth, a = 2;
  for (let i = 0; i < teeth; i++) {
    const t = i * 2 * w;
    const pts: [number, number][] = [[r - a, t - w * 0.5], [r + a, t - w * 0.25], [r + a, t + w * 0.25], [r - a, t + w * 0.5]];
    pts.forEach(([R, ang], j) => {
      const x = R * Math.cos(ang), y = R * Math.sin(ang);
      if (i === 0 && j === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.max(2.5, r * 0.15), 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
  gearCache.set(k, g);
  return g;
}

function Gear({ teeth }: { teeth: number }) {
  const r = teeth; // módulo 2: radio primitivo = dientes mm
  const geo = useMemo(() => gearGeometry(teeth, r, 8), [teeth, r]);
  return (
    <group>
      <mesh geometry={geo} material={M.steel} castShadow receiveShadow />
      <Cyl r={Math.max(5, r * 0.3)} h={9} p={[0, 0, -0.5]} m={M.dark} />
      <Cyl r={2} h={8.8} p={[r * 0.7, 0, -0.4]} m={M.copper} seg={12} />
    </group>
  );
}

function Pulley({ r }: { r: number }) {
  return (
    <group>
      <Cyl r={r} h={3} m={M.steel} />
      <Cyl r={r - 3} h={6} p={[0, 0, 3]} m={M.copper} />
      <Cyl r={r} h={3} p={[0, 0, 9]} m={M.steel} />
      <Cyl r={2.5} h={12.4} p={[0, 0, -0.2]} m={M.hole} seg={12} />
    </group>
  );
}

const holeCache = new Map<string, THREE.BufferGeometry>();
/** Fila de agujeros unida en una sola figura: una llamada de dibujo por pieza en vez de una por agujero. */
function holesGeometry(len: number, rows: number[], z: number, every: number): THREE.BufferGeometry {
  const k = `${len}:${rows.join(",")}:${z}:${every}`;
  const hit = holeCache.get(k);
  if (hit) return hit;
  const parts: THREE.BufferGeometry[] = [];
  for (const y of rows) {
    for (let x = -len / 2 + every / 2; x < len / 2; x += every) {
      const g = new THREE.CylinderGeometry(2, 2, 0.6, 10);
      g.rotateX(Math.PI / 2);
      g.translate(x, y, z + 0.3);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  holeCache.set(k, merged);
  return merged;
}

function Holes({ len, rows = [0], z, every = 10 }: { len: number; rows?: number[]; z: number; every?: number }) {
  const geo = useMemo(() => holesGeometry(len, rows, z, every), [len, rows, z, every]);
  return <mesh geometry={geo} material={M.hole} />;
}

const rowCache = new Map<number, number[]>();
/** Filas de agujeros de una placa: cada 20 mm, a 10 mm del borde. Se guarda para no rehacer la figura. */
function plateRows(w: number): number[] {
  const hit = rowCache.get(w);
  if (hit) return hit;
  const rows: number[] = [];
  for (let y = -w / 2 + 10; y <= w / 2 - 10 + 0.1; y += 20) rows.push(y);
  rowCache.set(w, rows);
  return rows;
}

function Wire() {
  const geo = useMemo(() => {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(-38, 0, 3), new THREE.Vector3(-15, 0, 16), new THREE.Vector3(15, 0, 4), new THREE.Vector3(38, 0, 3)]);
    return new THREE.TubeGeometry(c, 32, 1.6, 8, false);
  }, []);
  return (
    <group>
      <mesh geometry={geo} material={M.red} castShadow />
      <Box s={[5, 5, 5]} p={[-38, 0, 0]} m={M.dark} />
      <Box s={[5, 5, 5]} p={[38, 0, 0]} m={M.dark} />
    </group>
  );
}

function Belt() {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.absarc(-35, 0, 18, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.absarc(35, 0, 18, -Math.PI / 2, Math.PI / 2, false);
    const inner = new THREE.Path();
    inner.absarc(35, 0, 15, Math.PI / 2, -Math.PI / 2, true);
    inner.absarc(-35, 0, 15, (3 * Math.PI) / 2, Math.PI / 2, true);
    s.holes.push(inner);
    return new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: false, curveSegments: 16 });
  }, []);
  return <mesh geometry={geo} material={M.rubber} castShadow receiveShadow />;
}

/** Vidrio que brilla según `glow` (0 a 1). Un material por pieza para que cada una brille distinto. */
function GlowMesh({ glow, burned, color, base, children, ...rest }: { glow: number; burned: boolean; color: string; base: string; children: ReactNode; position?: V3; rotation?: V3 }) {
  const m = useMemo(() => new THREE.MeshStandardMaterial({ color: base, transparent: true, opacity: 0.7, roughness: 0.15 }), [base]);
  m.color.set(burned ? "#3a3a40" : base);
  m.emissive.set(color);
  m.emissiveIntensity = burned ? 0 : glow * 2.2;
  m.opacity = burned ? 0.9 : 0.62 + glow * 0.3;
  return (
    <mesh material={m} castShadow {...rest}>
      {children}
    </mesh>
  );
}

export interface ModelState {
  glow?: number;
  burned?: boolean;
  /** Interruptor cerrado o sensor presionado. */
  on?: boolean;
}

const PCB = mat("#b4542a", { roughness: 0.6 });
/** Materiales de la pieza libre. */
export const CUSTOM_MAT: Record<string, THREE.Material> = {
  Madera: mat("#a87443", { roughness: 0.85 }),
  Aluminio: mat("#b9c1cc", { roughness: 0.35, metalness: 0.6 }),
  Acrílico: mat("#86c3ef", { roughness: 0.15, transparent: true, opacity: 0.7 }),
  Cartón: mat("#bf9f6c", { roughness: 0.95 }),
};
const customGeo = new Map<string, THREE.ExtrudeGeometry>();

/** Pieza libre: su forma extruida a su grosor, con los agujeros de la grilla. */
function CustomPiece({ props }: { props?: Record<string, unknown> }) {
  const shape = String(props?.shape ?? DEFAULT_SHAPE), h = sizeOf("custom", props)[2];
  const step = props?.holes === "Cada 20 mm" ? 20 : props?.holes === "Sin agujeros" ? 0 : 10;
  const holes = step ? gridInside(parseShape(shape), step) : [];
  const key = `${shape}|${h}|${holes.length}|${String(props?.holes)}`;
  let geo = customGeo.get(key);
  if (!geo) {
    const pts = parseShape(shape);
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [x, y] of holes) s.holes.push(new THREE.Path().absarc(x, y, 3, 0, Math.PI * 2, true));
    geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
    if (customGeo.size > 60) customGeo.clear();
    customGeo.set(key, geo);
  }
  return <mesh geometry={geo} material={CUSTOM_MAT[String(props?.color)] ?? CUSTOM_MAT.Madera} castShadow receiveShadow />;
}
const PLASTIC = mat("#e9e6dc", { roughness: 0.7 });

function Model({ type, glow = 0, burned = false, on = true, size, props }: { type: string; size: [number, number, number]; props?: Record<string, unknown> } & ModelState) {
  switch (type) {
    case "source":
      return (
        <group>
          <Box s={[52, 30, 30]} p={[-4, 0, 0]} m={M.accent} />
          <Box s={[30, 30.4, 18]} p={[-8, 0, 6]} m={M.white} />
          <Cyl r={5} h={8} p={[26, 0, 15]} axis="x" m={M.steel} />
          <Cyl r={2.5} h={4} p={[-15, 9, 30]} m={M.black} seg={12} />
          <Cyl r={2.5} h={4} p={[10, 9, 30]} m={M.red} seg={12} />
        </group>
      );
    case "resistor":
      return (
        <group>
          <Cyl r={0.8} h={40} p={[0, 0, 5]} axis="x" m={M.steel} seg={8} />
          <Cyl r={4} h={20} p={[0, 0, 5]} axis="x" m={M.beige} />
          {[-6, -2, 2, 6].map((x, i) => <Cyl key={x} r={4.2} h={1.6} p={[x, 0, 5]} axis="x" m={[M.red, M.black, M.copper, M.accent][i]!} />)}
        </group>
      );
    case "lamp":
      return (
        <group>
          <Cyl r={12} h={6} m={M.dark} />
          <Cyl r={7} h={10} p={[0, 0, 6]} m={M.steel} />
          <GlowMesh position={[0, 0, 30]} glow={glow} burned={burned} color="#ffc65a" base="#f4e9c8">
            <sphereGeometry args={[14, 24, 16]} />
          </GlowMesh>
        </group>
      );
    case "led":
      return (
        <group>
          <Box s={[16, 1.2, 1.2]} p={[0, 0, 0]} m={M.steel} />
          <Cyl r={0.6} h={10} p={[-3, 0, 0]} m={M.steel} seg={6} />
          <Cyl r={0.6} h={10} p={[3, 0, 0]} m={M.steel} seg={6} />
          <GlowMesh position={[0, 0, 13]} rotation={[Math.PI / 2, 0, 0]} glow={glow} burned={burned} color="#ff3030" base="#ff6a6a">
            <cylinderGeometry args={[5, 5, 6, 20]} />
          </GlowMesh>
          <GlowMesh position={[0, 0, 16]} glow={glow} burned={burned} color="#ff3030" base="#ff6a6a">
            <sphereGeometry args={[5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </GlowMesh>
        </group>
      );
    case "switch":
      return (
        <group>
          <Box s={[40, 20, 10]} m={M.dark} />
          <Box s={[16, 12, 4]} p={[0, 0, 10]} m={M.black} />
          {/* Palanca: inclinada hacia el lado que cierra o abre el contacto. */}
          <mesh position={[on ? 3 : -3, 0, 16]} rotation={[0, on ? 0.5 : -0.5, 0]} material={on ? M.red : M.white} castShadow>
            <boxGeometry args={[4, 6, 12]} />
          </mesh>
        </group>
      );
    case "wire":
      return <Wire />;
    case "hbridge":
      return (
        <group>
          <Box s={[50, 40, 2]} m={M.pcb} />
          <Box s={[16, 16, 4]} p={[0, 0, 2]} m={M.black} />
          <Box s={[10, 30, 10]} p={[-18, 0, 2]} m={M.accent} />
          <Box s={[10, 30, 10]} p={[18, 0, 2]} m={M.accent} />
        </group>
      );
    case "dcmotor":
      return (
        <group>
          <Cyl r={14} h={46} p={[-7, 0, 15]} axis="x" m={M.steel} />
          <Cyl r={14.5} h={6} p={[-27, 0, 15]} axis="x" m={M.dark} />
          <Cyl r={6} h={4} p={[18, 0, 15]} axis="x" m={M.dark} />
          <Cyl r={2} h={10} p={[25, 0, 15]} axis="x" m={M.steel} seg={12} />
          <Box s={[30, 22, 2]} p={[-7, 0, 0]} m={M.dark} />
        </group>
      );
    case "stepper":
      return (
        <group>
          <Box s={[42, 42, 40]} m={M.dark} />
          <Box s={[42.4, 42.4, 6]} p={[0, 0, 8]} m={M.steel} />
          <Cyl r={11} h={2} p={[0, 0, 40]} m={M.steel} />
          <Cyl r={2.5} h={10} p={[0, 0, 40]} m={M.steel} seg={12} />
        </group>
      );
    case "servo":
      return (
        <group>
          <Box s={[40, 20, 36]} m={M.accent} />
          <Box s={[54, 20, 3]} p={[0, 0, 26]} m={M.accent} />
          <Cyl r={5} h={4} p={[10, 0, 36]} m={M.white} />
          <Box s={[26, 5, 2]} p={[10, 0, 38]} m={M.white} />
        </group>
      );
    case "linear":
      return (
        <group>
          <Cyl r={12} h={80} p={[-20, 0, 12]} axis="x" m={M.steel} />
          {/* El vástago se corre al simular (ver Part3D). */}
          <group name="rod">
            <Cyl r={5} h={40} p={[40, 0, 12]} axis="x" m={M.white} />
          </group>
          <Box s={[10, 24, 24]} p={[-55, 0, 0]} m={M.dark} />
        </group>
      );
    case "piston":
      return (
        <group>
          <Box s={[70, 26, 36]} m={M.dark} />
          <Box s={[110, 30, 4]} p={[0, 0, 36]} m={M.steel} />
          <Box s={[110, 4, 26]} p={[0, -13, 40]} m={M.steel} />
          <Box s={[110, 4, 26]} p={[0, 13, 40]} m={M.steel} />
          {/* El émbolo se corre al simular (ver Part3D). */}
          <group name="rod">
            <Box s={[24, 22, 26]} p={[25, 0, 40]} m={M.white} />
            <Cyl r={3} h={0.6} p={[25, 0, 65.8]} m={M.hole} seg={12} />
          </group>
        </group>
      );
    case "shaft":
      return <Cyl r={4} h={size[0]} p={[0, 0, 4]} axis="x" m={M.steel} />;
    case "gear10":
      return <Gear teeth={10} />;
    case "gear20":
      return <Gear teeth={20} />;
    case "gear40":
      return <Gear teeth={40} />;
    case "pulleyS":
      return <Pulley r={10} />;
    case "pulleyM":
      return <Pulley r={18} />;
    case "pulleyL":
      return <Pulley r={28} />;
    case "belt":
      return <Belt />;
    case "bearing":
      return (
        <group>
          <Cyl r={11} h={8} m={M.steel} />
          <Cyl r={7.5} h={8.4} p={[0, 0, -0.2]} m={M.dark} />
          <Cyl r={4} h={8.8} p={[0, 0, -0.4]} m={M.hole} seg={12} />
        </group>
      );
    case "weight":
      return (
        <group>
          <Box s={[30, 30, 26]} m={M.dark} />
          <Box s={[22, 22, 2]} p={[0, 0, 26]} m={M.steel} />
          <Cyl r={3} h={2.4} p={[0, 0, 27.8]} m={M.hole} seg={12} />
        </group>
      );
    case "custom":
      return <CustomPiece props={props} />;
    case "controller":
      return (
        <group>
          <Box s={[70, 50, 2]} m={PCB} />
          <Box s={[14, 9, 3]} p={[-6, 2, 2]} m={M.black} />
          <Box s={[8, 6, 2]} p={[12, 4, 2]} m={M.black} />
          <Cyl r={4} h={8} p={[24, -2, 2]} m={M.black} seg={16} />
          <Cyl r={1} h={40} p={[30, 14, 2]} m={M.steel} seg={8} />
          {/* Borneras: entrada a la izquierda y un par por canal arriba y abajo. */}
          <Box s={[8, 22, 10]} p={[-31, 0, 2]} m={M.dark} />
          {[-8, 12].flatMap((x) => [21, -21].map((y) => <Box key={`${x}${y}`} s={[18, 7, 10]} p={[x, y, 2]} m={M.dark} />))}
        </group>
      );
    case "splitter":
      return (
        <group>
          <Box s={[80, 24, 10]} m={PLASTIC} />
          <Box s={[8, 24, 10.4]} p={[-34, 0, -0.2]} m={M.accent} />
          {[-34, -16, -2, 12, 26].flatMap((x) => [-6, 6].map((y) => <Cyl key={`${x}${y}`} r={2.6} h={4} p={[x, y, 10]} m={M.steel} seg={12} />))}
        </group>
      );
    case "wheel":
      return (
        <group>
          <Cyl r={30} h={14} m={M.rubber} />
          <Cyl r={20} h={14.4} p={[0, 0, -0.2]} m={M.steel} />
          <Box s={[36, 5, 14.8]} p={[0, 0, -0.4]} m={M.dark} />
          <Box s={[5, 36, 14.8]} p={[0, 0, -0.4]} m={M.dark} />
          <Cyl r={4} h={15.2} p={[0, 0, -0.6]} m={M.hole} seg={12} />
        </group>
      );
    case "support":
      return (
        <group>
          <Box s={[40, 20, 6]} m={M.steel} />
          <Box s={[12, 20, 34]} p={[0, 0, 6]} m={M.steel} />
          <Cyl r={4} h={21} p={[0, 0, 30]} axis="y" m={M.hole} seg={12} />
        </group>
      );
    case "bracket":
      return (
        <group>
          <Box s={[60, 30, 4]} m={M.steel} />
          <Box s={[60, 4, 40]} p={[0, -13, 0]} m={M.steel} />
          {[-20, 0, 20].map((x) => <Cyl key={x} r={3} h={4.4} p={[x, 2, -0.2]} m={M.hole} seg={12} />)}
          {[-24, 24].map((x) => <Cyl key={x} r={3} h={4.4} p={[x, -13, 24]} axis="y" m={M.hole} seg={12} />)}
        </group>
      );
    case "link": {
      const e = size[0] / 2 - 7;
      return (
        <group>
          <Box s={[2 * e, 14, 6]} m={M.steel} />
          <Cyl r={7} h={6} p={[-e, 0, 0]} m={M.steel} />
          <Cyl r={7} h={6} p={[e, 0, 0]} m={M.steel} />
          <Cyl r={3} h={6.4} p={[-e, 0, -0.2]} m={M.hole} seg={12} />
          <Cyl r={3} h={6.4} p={[e, 0, -0.2]} m={M.hole} seg={12} />
        </group>
      );
    }
    case "joint":
      return (
        <group>
          <Box s={[12, 20, 4]} p={[-8, 0, 0]} m={M.steel} />
          <Box s={[12, 20, 4]} p={[8, 0, 0]} m={M.steel} />
          <Cyl r={6} h={20} p={[0, 0, 8]} axis="y" m={M.accent} />
          <Cyl r={2} h={22} p={[0, 0, 8]} axis="y" m={M.steel} seg={12} />
        </group>
      );
    case "profile60":
    case "profile120":
    case "profile240": {
      const len = size[0];
      return (
        <group>
          <Box s={[len, 10, 10]} m={M.steel} />
          <Holes len={len} z={10} />
        </group>
      );
    }
    case "plate":
      return (
        <group>
          <Box s={[size[0], size[1], 6]} m={M.dark} />
          <Holes len={size[0]} rows={plateRows(size[1])} z={6} every={20} />
        </group>
      );
    case "bolt":
      return (
        <group>
          <Cyl r={2.5} h={14} m={M.steel} seg={12} />
          <Cyl r={5} h={6} p={[0, 0, 14]} m={M.steel} seg={6} />
        </group>
      );
    case "sensorAngle":
    case "sensorContact":
      return (
        <group>
          <Box s={[20, 20, 8]} m={M.pcb} />
          {type === "sensorAngle" ? <Cyl r={6} h={6} p={[0, 0, 8]} m={M.white} /> : <Box s={[10, 8, on ? 2 : 6]} p={[0, 0, 8]} m={M.red} />}
        </group>
      );
    case "meter":
      return (
        <group>
          <Box s={[40, 20, 50]} m={M.dark} />
          <Box s={[32, 1, 22]} p={[0, -10, 22]} m={M.white} />
          <Box s={[30, 1, 8]} p={[0, -10, 6]} m={M.black} />
        </group>
      );
    case "text":
      return (
        <group>
          <Box s={[60, 4, 30]} m={M.white} />
          <Box s={[40, 4.4, 3]} p={[0, 0, 20]} m={M.dark} />
          <Box s={[30, 4.4, 3]} p={[0, 0, 12]} m={M.dark} />
        </group>
      );
    default:
      return <Box s={[40, 40, 20]} m={M.body} />;
  }
}

/** Modelo centrado en su caja: el contenedor lo puede girar sobre su centro. */
export function PartModel({ type, glow, burned, on, props }: { type: string; props?: Record<string, unknown> } & ModelState) {
  const size = sizeOf(type, props);
  return (
    <group position={[0, 0, -size[2] / 2]}>
      <Model type={type} glow={glow} burned={burned} on={on} size={size} props={props} />
    </group>
  );
}
