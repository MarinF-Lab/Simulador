import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { extent, TABLE, type Part } from "../core/model/project";
import { useProject } from "../store/project";
import { Controller } from "./Controller";
import { PartModel } from "./models";
import { CableEnds, Cables, FlowTicker, Terminals } from "./Electrical";
import { brightness } from "../core/electrical/analyze";

const Q = Math.PI / 2;

function Grid() {
  const [minor, major] = useMemo(() => {
    const mk = (step: number, skip?: number) => {
      const pts: number[] = [];
      const hw = TABLE.w / 2, hd = TABLE.d / 2;
      for (let x = -hw; x <= hw + 0.1; x += step) if (!skip || Math.round(x) % skip) pts.push(x, -hd, 0, x, hd, 0);
      for (let y = -hd; y <= hd + 0.1; y += step) if (!skip || Math.round(y) % skip) pts.push(-hw, y, 0, hw, y, 0);
      return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    };
    return [mk(10, 50), mk(50)];
  }, []);
  return (
    <group position={[0, 0, 0.05]}>
      <lineSegments geometry={minor}>
        <lineBasicMaterial color="#232c4a" />
      </lineSegments>
      <lineSegments geometry={major}>
        <lineBasicMaterial color="#3a4673" />
      </lineSegments>
    </group>
  );
}

function Table() {
  return (
    <group>
      <mesh position={[0, 0, -6]} receiveShadow>
        <boxGeometry args={[TABLE.w + 24, TABLE.d + 24, 12]} />
        <meshStandardMaterial color="#121830" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.01]} receiveShadow>
        <planeGeometry args={[TABLE.w, TABLE.d]} />
        <meshStandardMaterial color="#1a2140" roughness={0.95} />
      </mesh>
      <Grid />
    </group>
  );
}

const BOX_COLOR = { sel: "#8b8bff", err: "#ef5a5a", warn: "#e8a93b" };

/** Caja de aristas alrededor de una pieza: selección (índigo) o aviso (rojo o ámbar). */
function OutlineBox({ part, kind, pad = 6 }: { part: Part; kind: keyof typeof BOX_COLOR; pad?: number }) {
  const [ex, ey, ez] = extent(part);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(ex + pad, ey + pad, ez + pad)), [ex, ey, ez, pad]);
  return (
    <lineSegments geometry={geo} position={[part.x, part.y, part.z + ez / 2]}>
      <lineBasicMaterial color={BOX_COLOR[kind]} />
    </lineSegments>
  );
}

function Part3D({ part }: { part: Part }) {
  const ez = extent(part)[2];
  const reading = useProject((s) => s.circuit.readings[part.id]);
  const glow = part.type === "lamp" || part.type === "led" ? brightness(part.type, part.props, reading) : 0;
  return (
    <group position={[part.x, part.y, part.z + ez / 2]} rotation={[part.rot[0] * Q, part.rot[1] * Q, part.rot[2] * Q]} userData={{ partId: part.id }}>
      <PartModel type={part.type} glow={glow} burned={part.props.burned === true} />
    </group>
  );
}

/** Luz principal con sombras. El área de la sombra cubre toda la mesa. */
function SunLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera;
    c.left = -800; c.right = 800; c.top = 800; c.bottom = -800; c.near = 100; c.far = 2600;
    c.updateProjectionMatrix();
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.6;
    l.shadow.needsUpdate = true;
  }, []);
  return <directionalLight ref={ref} position={[350, -500, 900]} intensity={2.6} castShadow />;
}

export function Scene() {
  const parts = useProject((s) => s.project.parts);
  const selected = useProject((s) => s.selected);
  const sel = parts.find((p) => p.id === selected);
  const flag = useProject((s) => s.circuit.flag);
  return (
    <Canvas
      shadows
      orthographic
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [600, -600, 600], zoom: 1, near: 1, far: 20000, up: [0, 0, 1] }}
      style={{ touchAction: "none", position: "absolute", inset: 0 }}
      aria-label="Mesa de trabajo 3D"
    >
      <color attach="background" args={["#0f1424"]} />
      <hemisphereLight args={["#d4dcff", "#2a3050", 1.6]} />
      <SunLight />
      <Table />
      <group name="parts">
        {parts.map((p) => <Part3D key={p.id} part={p} />)}
      </group>
      {parts.filter((p) => flag[p.id] && p.id !== selected).map((p) => <OutlineBox key={p.id} part={p} kind={flag[p.id]!} pad={4} />)}
      {sel && <OutlineBox part={sel} kind="sel" />}
      <Terminals />
      <Cables />
      <CableEnds />
      <FlowTicker />
      <Controller />
    </Canvas>
  );
}
