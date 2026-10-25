import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf } from "../core/model/project";

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

const PLATE_ROWS = [-40, -20, 0, 20, 40];

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

function Model({ type }: { type: string }) {
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
          <mesh position={[0, 0, 30]} material={M.glass} castShadow>
            <sphereGeometry args={[14, 24, 16]} />
          </mesh>
        </group>
      );
    case "led":
      return (
        <group>
          <Cyl r={0.6} h={12} p={[-3, 0, 0]} m={M.steel} seg={6} />
          <Cyl r={0.6} h={12} p={[3, 0, 0]} m={M.steel} seg={6} />
          <Cyl r={5} h={6} p={[0, 0, 10]} m={M.led} />
          <mesh position={[0, 0, 16]} material={M.led}>
            <sphereGeometry args={[5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      );
    case "switch":
      return (
        <group>
          <Box s={[40, 20, 10]} m={M.dark} />
          <Box s={[16, 12, 4]} p={[0, 0, 10]} m={M.black} />
          <mesh position={[3, 0, 16]} rotation={[0, 0.5, 0]} material={M.red} castShadow>
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
          <Cyl r={5} h={40} p={[40, 0, 12]} axis="x" m={M.white} />
          <Box s={[10, 24, 24]} p={[-55, 0, 0]} m={M.dark} />
        </group>
      );
    case "shaft":
      return <Cyl r={4} h={120} p={[0, 0, 4]} axis="x" m={M.steel} />;
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
    case "support":
      return (
        <group>
          <Box s={[40, 20, 6]} m={M.steel} />
          <Box s={[12, 20, 34]} p={[0, 0, 6]} m={M.steel} />
          <Cyl r={4} h={21} p={[0, 0, 30]} axis="y" m={M.hole} seg={12} />
        </group>
      );
    case "link":
      return (
        <group>
          <Box s={[86, 14, 6]} m={M.steel} />
          <Cyl r={7} h={6} p={[-43, 0, 0]} m={M.steel} />
          <Cyl r={7} h={6} p={[43, 0, 0]} m={M.steel} />
          <Cyl r={3} h={6.4} p={[-43, 0, -0.2]} m={M.hole} seg={12} />
          <Cyl r={3} h={6.4} p={[43, 0, -0.2]} m={M.hole} seg={12} />
        </group>
      );
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
      const len = sizeOf(type)[0];
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
          <Box s={[160, 100, 6]} m={M.dark} />
          <Holes len={160} rows={PLATE_ROWS} z={6} every={20} />
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
          {type === "sensorAngle" ? <Cyl r={6} h={6} p={[0, 0, 8]} m={M.white} /> : <Box s={[10, 8, 6]} p={[0, 0, 8]} m={M.red} />}
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
export function PartModel({ type }: { type: string }) {
  const h = sizeOf(type)[2];
  return (
    <group position={[0, 0, -h / 2]}>
      <Model type={type} />
    </group>
  );
}
