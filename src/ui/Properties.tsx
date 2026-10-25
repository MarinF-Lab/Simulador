import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { findItem } from "../core/model/catalog";
import { fmt, parseDecimal } from "../core/model/units";
import { useUI, type PropValue } from "../store/ui";
import { PartIcon } from "./PartIcon";
import { sectionsFor, type Field } from "./propertySchema";

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

function FieldRow({ partId, field }: { partId: string; field: Field }) {
  const stored = useUI((s) => s.values[partId]);
  const setValue = useUI((s) => s.setValue);
  if (field.type === "reading") {
    return (
      <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
        <span className="text-muted">{field.label}</span>
        <span className="font-mono tabular-nums">{field.value}</span>
      </div>
    );
  }
  const v: PropValue = stored?.[field.key] ?? field.def;
  const set = (nv: PropValue) => setValue(partId, field.key, nv);
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

export function Properties() {
  const selected = useUI((s) => s.selected);
  const running = useUI((s) => s.running);
  const select = useUI((s) => s.select);
  const item = selected ? findItem(selected) : undefined;

  if (!item) {
    return <p className="px-4 py-6 text-sm text-muted">Toca una pieza de la biblioteca para ver sus propiedades.</p>;
  }
  const sections = sectionsFor(item.kind);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
        <PartIcon kind={item.kind} className="size-10 text-ink/85" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{item.name}</p>
          {item.variant && <p className="text-xs text-muted">{item.variant}</p>}
        </div>
        <button onClick={() => select(null)} aria-label="Quitar selección" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink">
          <X className="size-5" />
        </button>
      </div>

      {sections.map((sec) => (
        <section key={sec.id} className="rounded-xl border border-line px-3 py-2">
          <h3 className="pb-1 text-xs font-semibold tracking-widest text-muted uppercase">{sec.title}</h3>
          <div className="flex flex-col divide-y divide-line/60">
            {sec.fields.map((f, i) => <FieldRow key={f.type === "reading" ? i : f.key} partId={item.id} field={f} />)}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-line px-3 py-3">
        <h3 className="pb-2 text-xs font-semibold tracking-widest text-muted uppercase">Estado del componente</h3>
        <p className="flex items-center gap-2 text-sm">
          <span className="size-2.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
          {running ? "Funcionando correctamente" : "Sin problemas detectados"}
        </p>
      </section>
    </div>
  );
}
