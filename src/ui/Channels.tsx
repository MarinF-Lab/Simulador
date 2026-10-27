import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Gamepad2, Power, Square, X } from "lucide-react";
import { ACTIONS, CHANNELS, channelId, channelOf, effectiveMode, type ChannelMode } from "../core/electrical/controller";
import type { Part } from "../core/model/project";
import { fmt } from "../core/model/units";
import { useProject } from "../store/project";

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

/** Estado de un canal ahora: modo efectivo (con su sensor) y voltaje de salida. */
function useChannelNow(part: Part, k: number) {
  const reading = useProject((s) => s.circuit.readings[channelId(part.id, k)]);
  const pressed = useProject((s) => {
    const sensor = channelOf(part, k).sensor;
    return sensor ? s.pressed[sensor] === true || s.project.parts.find((p) => p.id === sensor)?.props.pressed === true : false;
  });
  return { mode: effectiveMode(channelOf(part, k), pressed), reading, pressed };
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
        <div className="min-w-0 flex-1"><ModeButtons part={part} k={k} compact /></div>
      </div>
      {changed && <p className="pl-8 text-[11px] text-warn">Sensor presionado: {now.mode}</p>}
    </div>
  );
}

/** Mando flotante mientras se simula: los canales de cada placa de control, para manejarlos en vivo. */
export function RemotePanel() {
  const parts = useProject((s) => s.project.parts);
  const boards = useMemo(() => parts.filter((p) => p.type === "controller"), [parts]);
  const [open, setOpen] = useState(true);
  if (!boards.length) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="absolute top-24 left-3 z-10 flex min-h-11 items-center gap-2 rounded-full border border-line bg-panel/95 px-4 text-xs font-semibold shadow-lg">
        <Gamepad2 className="size-4 text-accent" aria-hidden="true" /> Mando
      </button>
    );
  }
  return (
    <section aria-label="Mando de las placas de control" className="absolute top-24 left-3 z-10 max-h-[45%] w-[min(300px,calc(100%-84px))] space-y-2 overflow-y-auto rounded-xl border border-line bg-panel/95 p-2 shadow-lg">
      <div className="flex items-center gap-2">
        <Gamepad2 className="size-4 text-accent" aria-hidden="true" />
        <h3 className="flex-1 text-xs font-semibold">Mando</h3>
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
