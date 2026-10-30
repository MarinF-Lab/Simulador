import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ArrowLeft, ArrowRight, Gamepad2, GripVertical, Power, Square, X } from "lucide-react";
import { ACTIONS, CHANNELS, channelId, channelOf, effectiveMode, type ChannelMode } from "../core/electrical/controller";
import type { Part } from "../core/model/project";
import { fmt } from "../core/model/units";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";

const MODE_UI: { mode: ChannelMode; label: string; Icon: typeof Power }[] = [
  { mode: "Adelante", label: "Adelante", Icon: ArrowRight },
  { mode: "Atrás", label: "Atrás", Icon: ArrowLeft },
  { mode: "Freno", label: "Freno", Icon: Square },
  { mode: "Apagado", label: "Apagado", Icon: Power },
];

/** Botones de modo de un canal. `compact` los deja solo con ícono (para el Mando). */
function ModeButtons({ part, k, compact }: { part: Part; k: number; compact?: boolean }) {
  const setProp = useProject((s) => s.setProp);
  const c = channelOf(part, k);
  return (
    <div role="radiogroup" aria-label={`Modo del canal ${k + 1}`} className="grid grid-cols-4 gap-1">
      {MODE_UI.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          role="radio"
          aria-checked={c.mode === mode}
          aria-label={compact ? label : undefined}
          title={label}
          onClick={() => setProp(part.id, `m${k + 1}`, mode)}
          className={
            "flex min-h-10 items-center justify-center gap-1 rounded-lg border text-xs font-medium " +
            (c.mode === mode ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink")
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {!compact && <span className="hidden sm:inline">{label}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Botones del Mando: actúan mientras se mantienen apretados y al soltar el canal vuelve a su
 * modo de Propiedades. Con varios dedos se manejan varios canales a la vez.
 */
function HoldButtons({ part, k }: { part: Part; k: number }) {
  const setHeld = useProject((s) => s.setHeld);
  const held = useProject((s) => s.held[`${part.id}:${k}`]);
  const base = channelOf(part, k).mode;
  const release = () => setHeld(part.id, k, null);
  useEffect(() => release, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="group" aria-label={`Canal ${k + 1}: mantén apretado`} className="grid grid-cols-4 gap-1">
      {MODE_UI.map(({ mode, label, Icon }) => {
        const on = held === mode;
        return (
          <button
            key={mode}
            aria-pressed={on}
            aria-label={`${label} mientras se mantiene`}
            title={`${label} (mantén apretado)`}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setHeld(part.id, k, mode); }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); setHeld(part.id, k, mode); } }}
            onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") release(); }}
            onBlur={release}
            onContextMenu={(e) => e.preventDefault()}
            className={
              "flex min-h-11 touch-none items-center justify-center rounded-lg border text-xs font-medium select-none " +
              (on ? "border-accent bg-accent text-accent-ink" : base === mode ? "border-accent/70 text-ink" : "border-line text-muted")
            }
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** Estado de un canal ahora: modo efectivo (con su sensor y el Mando) y voltaje de salida. */
function useChannelNow(part: Part, k: number) {
  const held = useProject((s) => s.held[`${part.id}:${k}`]);
  const reading = useProject((s) => s.circuit.readings[channelId(part.id, k)]);
  const pressed = useProject((s) => {
    const sensor = channelOf(part, k).sensor;
    return sensor ? s.pressed[sensor] === true || s.project.parts.find((p) => p.id === sensor)?.props.pressed === true : false;
  });
  const c = channelOf(part, k);
  return { mode: effectiveMode(held ? { ...c, mode: held as ChannelMode } : c, pressed), reading, pressed };
}

function ChannelCard({ part, k, sensors }: { part: Part; k: number; sensors: Part[] }) {
  const setProp = useProject((s) => s.setProp);
  const c = channelOf(part, k);
  const now = useChannelNow(part, k);
  const n = k + 1;
  return (
    <div className="space-y-2 rounded-lg border border-line p-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">Canal {n}</span>
        <span className="font-mono text-xs text-muted">
          {now.reading ? `${fmt(now.reading.v)} V · ${fmt(Math.abs(now.reading.i))} A` : "sin conectar"}
          {now.mode !== c.mode && <span className="text-warn"> · {now.mode}</span>}
        </span>
      </div>
      <ModeButtons part={part} k={k} />
      <label className="flex items-center gap-2 text-xs text-muted">
        <span className="w-16 shrink-0">Potencia</span>
        <input type="range" min={10} max={100} step={5} value={c.power} onChange={(e) => setProp(part.id, `p${n}`, +e.target.value)} className="h-8 min-w-0 flex-1 accent-[var(--color-accent)]" aria-label={`Potencia del canal ${n}`} />
        <span className="w-10 text-right font-mono text-ink">{c.power} %</span>
      </label>
      <div className="flex gap-2">
        <select value={c.sensor} onChange={(e) => setProp(part.id, `s${n}`, +e.target.value)} aria-label={`Sensor del canal ${n}`} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-xs">
          <option value={0}>Sin sensor</option>
          {sensors.map((s) => <option key={s.id} value={s.id}>Sensor de contacto n.º {s.id}</option>)}
        </select>
        {c.sensor > 0 && (
          <select value={c.action} onChange={(e) => setProp(part.id, `a${n}`, e.target.value)} aria-label={`Qué hace el sensor del canal ${n}`} className="h-10 rounded-lg border border-line bg-panel px-2 text-xs">
            {ACTIONS.map((a) => <option key={a} value={a}>Al tocarlo: {a}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

/** Propiedades de la placa de control: los 4 canales. */
export function ChannelsPanel({ part }: { part: Part }) {
  const parts = useProject((s) => s.project.parts);
  const sensors = useMemo(() => parts.filter((p) => p.type === "sensorContact"), [parts]);
  return (
    <section className="space-y-2 rounded-xl border border-line px-3 py-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">Canales</h3>
      {Array.from({ length: CHANNELS }, (_, k) => <ChannelCard key={k} part={part} k={k} sensors={sensors} />)}
      <p className="pb-1 text-xs text-muted">Cada canal reparte la entrada a su salida A y B. Con un sensor, el canal se detiene, se invierte o se enciende mientras lo tocan.</p>
    </section>
  );
}

/** Un canal en el Mando; avisa si su sensor lo está cambiando. */
function RemoteRow({ part, k }: { part: Part; k: number }) {
  const now = useChannelNow(part, k);
  const changed = now.mode !== channelOf(part, k).mode;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-muted">C{k + 1}</span>
        <div className="min-w-0 flex-1"><HoldButtons part={part} k={k} /></div>
      </div>
      {changed && now.pressed && <p className="pl-8 text-[11px] text-warn">Sensor presionado: {now.mode}</p>}
    </div>
  );
}

/** Arrastre de la ventana del Mando por su cabecera, sin salir de la mesa. */
function useDragPanel() {
  const ref = useRef<HTMLElement | null>(null);
  const pos = useUI((s) => s.remotePos);
  const setPos = useUI((s) => s.setRemotePos);
  const grab = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const clampTo = (x: number, y: number) => {
    const el = ref.current, box = el?.offsetParent as HTMLElement | null;
    if (!el || !box) return { x, y };
    return { x: Math.max(4, Math.min(box.clientWidth - el.offsetWidth - 4, x)), y: Math.max(4, Math.min(box.clientHeight - el.offsetHeight - 4, y)) };
  };
  // Si la pantalla cambia de tamaño, la ventana vuelve a quedar dentro.
  useEffect(() => {
    const fix = () => { if (pos) { const c = clampTo(pos.x, pos.y); if (c.x !== pos.x || c.y !== pos.y) setPos(c); } };
    fix();
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const at = live ?? pos ?? { x: 12, y: 96 };
  const handle = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      const el = ref.current;
      if (!el) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      grab.current = { dx: e.clientX - at.x, dy: e.clientY - at.y, id: e.pointerId };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const g = grab.current;
      if (!g || g.id !== e.pointerId) return;
      setLive(clampTo(e.clientX - g.dx, e.clientY - g.dy));
    },
    onPointerUp: () => {
      grab.current = null;
      if (live) setPos(live);
      setLive(null);
    },
  };
  return { ref, style: { left: at.x, top: at.y }, handle };
}

/** Mando flotante mientras se simula: los canales de cada placa de control, para manejarlos en vivo. */
export function RemotePanel() {
  const parts = useProject((s) => s.project.parts);
  const boards = useMemo(() => parts.filter((p) => p.type === "controller"), [parts]);
  const [open, setOpen] = useState(true);
  const drag = useDragPanel();
  if (!boards.length) return null;
  if (!open) {
    return (
      <button ref={(el) => { drag.ref.current = el; }} style={drag.style} onClick={() => setOpen(true)} className="absolute z-10 flex min-h-11 items-center gap-2 rounded-full border border-line bg-panel/95 px-4 text-xs font-semibold shadow-lg">
        <Gamepad2 className="size-4 text-accent" aria-hidden="true" /> Mando
      </button>
    );
  }
  return (
    <section ref={(el) => { drag.ref.current = el; }} style={drag.style} aria-label="Mando de las placas de control" className="absolute z-10 max-h-[45%] w-[min(300px,calc(100%-84px))] space-y-2 overflow-y-auto rounded-xl border border-line bg-panel/95 p-2 shadow-lg">
      <div className="flex items-center gap-2">
        <div {...drag.handle} className="flex min-h-9 flex-1 cursor-grab touch-none items-center gap-2 select-none active:cursor-grabbing" title="Arrastra para mover el Mando">
          <GripVertical className="size-4 text-muted" aria-hidden="true" />
          <Gamepad2 className="size-4 text-accent" aria-hidden="true" />
          <h3 className="text-xs font-semibold">Mando</h3>
          <span className="text-[11px] text-muted">mantén apretado</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Ocultar mando" className="grid size-9 place-items-center rounded-lg text-muted hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      {boards.map((b) => (
        <div key={b.id} className="space-y-1.5">
          {boards.length > 1 && <p className="text-[11px] text-muted">Placa n.º {b.id}</p>}
          {Array.from({ length: CHANNELS }, (_, k) => <RemoteRow key={k} part={b} k={k} />)}
        </div>
      ))}
    </section>
  );
}
