import { useEffect, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, RotateCw, Trash2 } from "lucide-react";
import { brightness, ELEC_DEFAULTS } from "../core/electrical/analyze";
import type { Issue } from "../core/electrical/circuit";
import { findItem } from "../core/model/catalog";
import { endPos, POLAR, posKey } from "../core/model/terminals";
import { fmt, fmtA, fmtV, parseDecimal } from "../core/model/units";
import { extent, type Axis, type PropValue } from "../core/model/project";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";
import { PartIcon } from "./PartIcon";
import { sectionsFor, type Field } from "./propertySchema";
import { useIssues } from "./useIssues";
import { isRotor } from "../core/mechanical/axes";

const inputCls =
  "h-10 w-24 rounded-lg border border-line bg-bg px-2 text-right font-mono text-sm tabular-nums";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Casilla numérica que acepta coma decimal; corrige el valor al salir. */
function NumberInput({ id, value, min, max, onChange, label }: { id: string; value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={inputCls}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseDecimal(e.target.value);
        if (v !== null && v >= min && v <= max) onChange(v);
      }}
      onBlur={() => {
        const v = parseDecimal(text);
        const fixed = v === null ? value : clamp(v, min, max);
        onChange(fixed);
        setText(fmt(fixed));
      }}
    />
  );
}

function FieldRow({ partId, field }: { partId: number; field: Field }) {
  const stored = useProject((s) => s.project.parts.find((p) => p.id === partId)?.props);
  const setProp = useProject((s) => s.setProp);
  if (field.type === "reading") {
    return (
      <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
        <span className="text-muted">{field.label}</span>
        <span className="font-mono tabular-nums">{field.value}</span>
      </div>
    );
  }
  const v: PropValue = stored?.[field.key] ?? field.def;
  if (field.type === "choices") {
    const label = (x: number) => (x >= 1000 ? `${fmt(x / 1000)} k${field.unit}` : `${fmt(x)} ${field.unit}`);
    return (
      <div className="flex flex-col gap-2 py-1 text-sm">
        <span>{field.label}</span>
        <div className="flex flex-wrap gap-1.5">
          {field.values.map((x) => (
            <button key={x} onClick={() => setProp(partId, field.key, x)} aria-pressed={v === x} className={"min-h-10 rounded-md border px-3 font-mono text-xs " + (v === x ? "border-accent bg-accent text-accent-ink" : "border-line")}>
              {label(x)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const set = (nv: PropValue) => setProp(partId, field.key, nv);
  const id = `f-${partId}-${field.key}`;

  switch (field.type) {
    case "number":
      return (
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <label htmlFor={id}>{field.label}{field.unit && <span className="text-muted"> ({field.unit})</span>}</label>
          <NumberInput id={id} label={field.label} value={v as number} min={field.min} max={field.max} onChange={set} />
        </div>
      );
    case "ratio":
      return (
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <label htmlFor={id}>{field.label}</label>
          <span className="flex shrink-0 items-center gap-1.5 font-mono whitespace-nowrap">
            <NumberInput id={id} label={field.label} value={v as number} min={0.01} max={100} onChange={set} />
            <span className="text-muted">: 1</span>
          </span>
        </div>
      );
    case "select":
      return (
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <label htmlFor={id}>{field.label}</label>
          <select id={id} value={v as string} onChange={(e) => set(e.target.value)} className="h-10 min-w-0 rounded-lg border border-line bg-bg px-2 text-sm">
            {field.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      );
    case "toggle":
      return (
        <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
          <span id={id}>{field.label}</span>
          <button
            role="switch"
            aria-checked={v as boolean}
            aria-labelledby={id}
            onClick={() => set(!v)}
            className={"relative h-7 w-12 rounded-full transition-colors " + (v ? "bg-accent" : "bg-line")}
          >
            <span className={"absolute top-1 size-5 rounded-full bg-white transition-all " + (v ? "left-6" : "left-1")} />
          </button>
        </div>
      );
    case "slider":
      return (
        <div className="flex flex-col gap-1 py-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={id}>{field.label}</label>
            <span className="font-mono tabular-nums">{fmt(v as number)} {field.unit}</span>
          </div>
          <input id={id} type="range" min={field.min} max={field.max} step={1} value={v as number} onChange={(e) => set(+e.target.value)} className="h-8 w-full accent-[var(--color-accent)]" />
        </div>
      );
    case "volt":
      return (
        <div className="flex flex-col gap-2 py-1 text-sm">
          <label htmlFor={id + "-n"}>{field.label}</label>
          <div className="flex items-center gap-3">
            <input id={id} type="range" aria-label={field.label} min={field.min} max={field.max} step={0.1} value={v as number} onChange={(e) => set(+e.target.value)} className="h-8 min-w-0 flex-1 accent-[var(--color-accent)]" />
            <span className="flex items-center gap-1 font-mono">
              <NumberInput id={id + "-n"} label={field.label + " en voltios"} value={v as number} min={field.min} max={field.max} onChange={(x) => set(Math.round(x * 10) / 10)} />
              V
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {field.presets.map((p) => (
              <button key={p} onClick={() => set(p)} aria-pressed={v === p} className={"min-h-9 rounded-md border px-3 font-mono text-xs " + (v === p ? "border-accent bg-accent text-accent-ink" : "border-line")}>
                {fmt(p)} V
              </button>
            ))}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={id}>{field.label}</label>
          <input id={id} value={v as string} onChange={(e) => set(e.target.value)} className="h-10 rounded-lg border border-line bg-bg px-3" />
        </div>
      );
  }
}

const sq = "grid size-10 place-items-center rounded-lg border border-line hover:border-accent/60 disabled:opacity-40";

function Placement({ id }: { id: number }) {
  const part = useProject((s) => s.project.parts.find((p) => p.id === id));
  const { setZ, rotate, rotAxis, setRotAxis } = useProject();
  if (!part) return null;
  const [ex, ey, ez] = extent(part);
  return (
    <section className="rounded-xl border border-line px-3 py-2">
      <h3 className="pb-1 text-xs font-semibold tracking-widest text-muted uppercase">Posición</h3>
      <div className="flex flex-col divide-y divide-line/60 text-sm">
        <div className="flex min-h-10 items-center justify-between">
          <span className="text-muted">X · Y</span>
          <span className="font-mono tabular-nums">{fmt(part.x)} · {fmt(part.y)} mm</span>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span>Altura (Z)</span>
          <span className="flex items-center gap-2">
            <button className={sq} onClick={() => setZ(id, part.z - 10)} disabled={part.z <= 0} aria-label="Bajar 10 mm"><ChevronDown className="size-5" /></button>
            <span className="w-16 text-center font-mono tabular-nums">{fmt(part.z)} mm</span>
            <button className={sq} onClick={() => setZ(id, part.z + 10)} aria-label="Subir 10 mm"><ChevronUp className="size-5" /></button>
          </span>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span>Girar 90° sobre</span>
          <span className="flex items-center gap-1.5">
            {(["x", "y", "z"] as Axis[]).map((a) => (
              <button key={a} onClick={() => setRotAxis(a)} aria-pressed={rotAxis === a} className={"size-10 rounded-lg border font-mono text-sm uppercase " + (rotAxis === a ? "border-accent bg-accent text-accent-ink" : "border-line")}>
                {a}
              </button>
            ))}
            <button className={sq + " ml-1"} onClick={() => rotate(id)} aria-label={`Girar 90° sobre ${rotAxis.toUpperCase()}`}><RotateCw className="size-5" /></button>
          </span>
        </div>
        <div className="flex min-h-10 items-center justify-between">
          <span className="text-muted">Tamaño</span>
          <span className="font-mono tabular-nums">{ex} × {ey} × {ez} mm</span>
        </div>
      </div>
    </section>
  );
}

const DOT: Record<Issue["s"], string> = { err: "bg-err", warn: "bg-warn", info: "bg-muted", ok: "bg-ok" };

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {issues.map((x, i) => (
        <li key={i} className="grid grid-cols-[10px_minmax(0,1fr)] gap-2.5 text-sm">
          <span className={"mt-1.5 size-2.5 rounded-full " + DOT[x.s]} aria-hidden="true" />
          <span><b className="font-semibold">{x.h}.</b> <span className="text-ink/85">{x.t}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Lista completa de avisos del circuito. */
export function CircuitStatus() {
  const issues = useIssues();
  return (
    <section className="rounded-xl border border-line px-3 py-3" aria-live="polite">
      <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Estado del circuito y mecanismos</h3>
      <IssueList issues={issues} />
    </section>
  );
}

function Cell({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-panel-2 px-2.5 py-2">
      <span className="block text-[10px] font-semibold tracking-widest text-muted uppercase">{k}</span>
      <strong className={"block font-mono tabular-nums " + (big ? "text-lg" : "text-sm")}>{v}</strong>
    </div>
  );
}

/** Lecturas en vivo: voltaje primero, corriente en A como dato secundario. */
function Readings({ id, type }: { id: number; type: string }) {
  const r = useProject((s) => s.circuit.readings[id]);
  const found = useProject((s) => s.project.parts.find((p) => p.id === id)?.props);
  if (!r) return null;
  const props = found ?? {};
  const third = (() => {
    if (type === "lamp" || type === "led") return <Cell k="Brillo" v={`${Math.round(brightness(type, props, r) * 100)} %`} />;
    if (type === "switch") return <Cell k="Estado" v={props.closed === false ? "abierto" : "cerrado"} />;
    if (type === "sensorContact") return <Cell k="Estado" v={props.pressed === true ? "presionado" : "suelto"} />;
    if (type === "meter") return <Cell k="Mide" v="entre bornes" />;
    return <Cell k="Potencia" v={`${Math.abs(r.v * r.i).toLocaleString("es-CL", { maximumFractionDigits: 3 })} W`} />;
  })();
  return (
    <section className="rounded-xl border border-line px-3 py-2">
      <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Lecturas</h3>
      <div className="grid grid-cols-3 gap-2 pb-1">
        <Cell k={type === "source" ? "En bornes" : "Voltaje"} v={fmtV(r.v)} big />
        <Cell k="Corriente" v={type === "meter" ? "—" : fmtA(r.i)} />
        {third}
      </div>
    </section>
  );
}

function ComponentStatus({ id }: { id: number }) {
  const issues = useIssues();
  const mine = issues.filter((x) => x.ids.includes(id));
  const running = useUI((s) => s.running);
  return (
    <section className="rounded-xl border border-line px-3 py-3">
      <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Estado del componente</h3>
      {mine.length ? (
        <IssueList issues={mine} />
      ) : (
        <p className="flex items-center gap-2 text-sm">
          <span className="size-2.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
          {running ? "Funcionando correctamente" : "Sin problemas detectados"}
        </p>
      )}
    </section>
  );
}

const fmtRpm = (w: number) => `${Math.round(Math.abs(w)).toLocaleString("es-CL")} RPM`;
const turn = (w: number) => (Math.abs(w) < 0.5 ? "detenido" : w > 0 ? "↺ antihorario" : "↻ horario");
const LINK: Record<string, string> = { motor: "eje del motor", eje: "eje compartido", engrane: "engrane", correa: "correa" };

/** Giro de un engranaje, polea o eje: velocidad, sentido y relación con el motor. */
function Motion({ id }: { id: number }) {
  const w = useProject((s) => s.mech.rpm[id] ?? 0);
  const ratio = useProject((s) => s.mech.ratio[id]);
  const link = useProject((s) => s.mech.link[id]);
  const r = ratio && Math.abs(ratio) > 1e-6 ? 1 / Math.abs(ratio) : null;
  return (
    <section className="rounded-xl border border-line px-3 py-2">
      <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Movimiento</h3>
      <div className="grid grid-cols-3 gap-2 pb-1">
        <Cell k="Velocidad" v={fmtRpm(w)} big />
        <Cell k="Sentido" v={turn(w)} />
        <Cell k="Relación" v={r ? `${fmt(r)} : 1` : "—"} />
      </div>
      <p className="pt-1 pb-1 text-xs text-muted">{link ? `Unido por ${LINK[link] ?? link}.` : "Suelto: no gira."} La relación compara el motor con esta pieza: 4 : 1 es 4 veces más lenta.</p>
    </section>
  );
}

function MotorSpeed({ id }: { id: number }) {
  const w = useProject((s) => s.mech.rpm[id] ?? 0);
  return (
    <section className="rounded-xl border border-line px-3 py-2">
      <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Giro del eje</h3>
      <div className="grid grid-cols-3 gap-2 pb-1">
        <Cell k="Velocidad" v={fmtRpm(w)} big />
        <Cell k="Sentido" v={turn(w)} />
      </div>
    </section>
  );
}

function BeltPanel({ id }: { id: number }) {
  const belt = useProject((s) => (s.project.belts ?? []).find((b) => b.id === id));
  const mech = useProject((s) => s.mech);
  const { remove, toggleCross } = useProject();
  if (!belt) return null;
  const A = mech.axisOf[belt.a], B = mech.axisOf[belt.b];
  const ratio = A && B ? A.r / B.r : 0;
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
        <PartIcon kind="belt" className="size-10 text-ink/85" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Correa</p>
          <p className="text-xs text-muted">{belt.cross ? "Cruzada: invierte el giro" : "Normal: mismo sentido"}</p>
        </div>
        <button onClick={() => remove(id)} aria-label="Eliminar correa" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-panel hover:text-err">
          <Trash2 className="size-5" />
        </button>
      </div>
      <section className="rounded-xl border border-line px-3 py-2">
        <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Lecturas</h3>
        <div className="grid grid-cols-3 gap-2 pb-1">
          <Cell k="Entrada" v={fmtRpm(mech.rpm[belt.a] ?? 0)} />
          <Cell k="Salida" v={fmtRpm(mech.rpm[belt.b] ?? 0)} />
          <Cell k="Relación" v={ratio ? `${fmt(1 / ratio)} : 1` : "—"} />
        </div>
      </section>
      <button onClick={() => toggleCross(id)} className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium hover:border-accent/60">
        {belt.cross ? "Cambiar a correa normal" : "Cambiar a correa cruzada"}
      </button>
      <ComponentStatus id={id} />
    </>
  );
}

function CablePanel({ id }: { id: number }) {
  const project = useProject((s) => s.project);
  const circuit = useProject((s) => s.circuit);
  const remove = useProject((s) => s.remove);
  const c = project.cables.find((x) => x.id === id);
  if (!c) return null;
  const loose = c.ends.filter((e) => circuit.occAt(posKey(endPos(project, e))) < 2).length;
  const side = circuit.side[id];
  const i = circuit.readings[id]?.i ?? 0;
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
        <PartIcon kind="wire" className="size-10 text-ink/85" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Cable</p>
          <p className="text-xs text-muted">Cable n.º {id}</p>
        </div>
        <button onClick={() => remove(id)} aria-label="Eliminar cable" title="Eliminar (Supr)" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-panel hover:text-err">
          <Trash2 className="size-5" />
        </button>
      </div>
      <section className="rounded-xl border border-line px-3 py-2">
        <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Lecturas</h3>
        <div className="grid grid-cols-3 gap-2 pb-1">
          <Cell k="Lado" v={side === "+" ? "+ rojo" : side === "-" ? "− azul" : "neutro"} />
          <Cell k="Corriente" v={fmtA(i)} />
          <Cell k="Puntas" v={loose ? `${loose} suelta${loose > 1 ? "s" : ""}` : "conectadas"} />
        </div>
      </section>
      <p className="px-1 text-sm text-muted">Arrastra cada punta hasta un borne para conectarla. Puedes juntar varias puntas en un mismo borne para hacer una derivación.</p>
      <ComponentStatus id={id} />
    </>
  );
}

export function Properties() {
  const selected = useProject((s) => s.selected);
  const part = useProject((s) => s.project.parts.find((p) => p.id === s.selected));
  const isCable = useProject((s) => s.project.cables.some((c) => c.id === s.selected));
  const isBelt = useProject((s) => (s.project.belts ?? []).some((b) => b.id === s.selected));
  const { remove, replace, flip, actuate } = useProject();
  const item = part ? findItem(part.type) : undefined;

  const body = (() => {
    if (isCable && selected !== null) return <CablePanel id={selected} />;
    if (isBelt && selected !== null) return <BeltPanel id={selected} />;
    if (!part || !item) {
      return <p className="px-1 text-sm text-muted">Toca una pieza o un cable de la mesa para ver sus lecturas y cambiar sus propiedades. Para unir dos bornes, tócalos uno después del otro.</p>;
    }
    const sections = sectionsFor(item.kind);
    const burned = part.props.burned === true;
    const closed = part.props.closed ?? ELEC_DEFAULTS.switch!.closed;
    return (
      <>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
          <PartIcon kind={item.kind} className="size-10 text-ink/85" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{item.name}</p>
            <p className="text-xs text-muted">{item.variant ? `${item.variant} · ` : ""}Pieza n.º {part.id}</p>
          </div>
          <button onClick={() => remove(part.id)} aria-label="Eliminar pieza" title="Eliminar (Supr)" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-panel hover:text-err">
            <Trash2 className="size-5" />
          </button>
        </div>

        {burned && (
          <div className="flex items-center gap-3 rounded-xl border border-err/50 bg-err/10 p-3 text-sm">
            <p className="flex-1">Esta pieza se quemó. Corrige el circuito y reemplázala.</p>
            <button onClick={() => replace(part.id)} className="min-h-11 rounded-lg bg-err px-3 font-semibold text-white">Reemplazar</button>
          </div>
        )}

        <Readings id={part.id} type={part.type} />
        {part.type === "dcmotor" && <MotorSpeed id={part.id} />}
        {isRotor(part.type) && <Motion id={part.id} />}

        {(part.type === "switch" || part.type === "sensorContact" || POLAR.has(part.type)) && (
          <div className="flex flex-wrap gap-2">
            {part.type === "switch" && (
              <button onClick={() => actuate(part.id)} className="min-h-11 flex-1 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink">
                {closed ? "Abrir interruptor" : "Cerrar interruptor"}
              </button>
            )}
            {part.type === "sensorContact" && (
              <button onClick={() => actuate(part.id)} className="min-h-11 flex-1 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink">
                {part.props.pressed === true ? "Soltar sensor" : "Presionar sensor"}
              </button>
            )}
            {POLAR.has(part.type) && (
              <button onClick={() => flip(part.id)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium hover:border-accent/60">
                <ArrowLeftRight className="size-4" aria-hidden="true" /> Invertir polaridad
              </button>
            )}
          </div>
        )}

        {sections.map((sec) => (
          <section key={sec.id} className="rounded-xl border border-line px-3 py-2">
            <h3 className="pb-1 text-xs font-semibold tracking-widest text-muted uppercase">{sec.title}</h3>
            <div className="flex flex-col divide-y divide-line/60">
              {sec.fields.map((f, i) => <FieldRow key={f.type === "reading" ? i : f.key} partId={part.id} field={f} />)}
            </div>
          </section>
        ))}

        <Placement id={part.id} />
        <ComponentStatus id={part.id} />
      </>
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
      {body}
      <CircuitStatus />
    </div>
  );
}
