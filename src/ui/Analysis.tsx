import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { findItem } from "../core/model/catalog";
import { fmt } from "../core/model/units";
import { useProject } from "../store/project";
import { useRecord, type Metric } from "../store/record";
import { useUI } from "../store/ui";

// Colores de series validados contra el panel oscuro (#161c30), en orden fijo.
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const INK = { muted: "#9aa3bf", grid: "#26304a", text: "#e6e9f5" };

interface Line { key: string; label: string }

/** Gráfico en el tiempo. Una sola escala; el valor bajo el cursor aparece en la leyenda. */
function TimeChart({ title, unit, lines, digits = 2 }: { title: string; unit: string; lines: Line[]; digits?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const version = useRecord((s) => s.version);
  const keys = lines.map((l) => l.key).join("|");

  useEffect(() => {
    const el = box.current;
    if (!el || !lines.length) return;
    const opts: uPlot.Options = {
      width: el.clientWidth || 300,
      height: 170,
      legend: { live: true },
      cursor: { points: { size: 8 }, y: false },
      scales: { x: { time: false } },
      axes: [
        { stroke: INK.muted, grid: { stroke: INK.grid, width: 1 }, ticks: { stroke: INK.grid }, values: (_u, v) => v.map((x) => `${fmt(x)} s`), font: "11px IBM Plex Mono, monospace" },
        { stroke: INK.muted, grid: { stroke: INK.grid, width: 1 }, ticks: { stroke: INK.grid }, size: 52, values: (_u, v) => v.map((x) => fmt(x)), font: "11px IBM Plex Mono, monospace" },
      ],
      series: [
        { label: "Tiempo", value: (_u, v) => (v == null ? "—" : `${fmt(v)} s`) },
        ...lines.map((l, i) => ({
          label: l.label,
          stroke: SERIES[i % SERIES.length],
          width: 2,
          spanGaps: false,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-CL", { maximumFractionDigits: digits })} ${unit}`),
        })),
      ],
    };
    const s = useRecord.getState();
    plot.current = new uPlot(opts, [s.t, ...lines.map((l) => s.series[l.key] ?? s.t.map(() => null))] as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: 170 }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  useEffect(() => {
    const s = useRecord.getState();
    plot.current?.setData([s.t, ...lines.map((l) => s.series[l.key] ?? s.t.map(() => null))] as uPlot.AlignedData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, keys]);

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-3">
      <h3 className="text-sm font-semibold">{title} <span className="font-normal text-muted">({unit})</span></h3>
      {lines.length ? (
        <div ref={box} className="kin-chart mt-2 min-w-0" />
      ) : (
        <p className="mt-2 grid min-h-32 place-items-center rounded-lg border border-dashed border-line px-4 text-center text-xs text-muted">
          La pieza elegida no tiene este dato. Elige otra pieza arriba.
        </p>
      )}
    </section>
  );
}

const name = (type: string, id: number) => {
  const it = findItem(type);
  return `${it ? `${it.name}${it.variant ? ` ${it.variant}` : ""}` : "Pieza"} n.º ${id}`;
};

export function AnalysisView() {
  const parts = useProject((s) => s.project.parts);
  const series = useRecord((s) => s.series);
  const count = useRecord((s) => s.t.length);
  const lastT = useRecord((s) => s.t[s.t.length - 1] ?? 0);
  const { paused, setPaused, clear } = useRecord();
  const running = useUI((s) => s.running);
  const toggleRun = useUI((s) => s.toggleRun);

  // Piezas con algún dato grabado (voltaje, corriente, RPM o par).
  const options = useMemo(() => {
    const ids = new Set(Object.keys(series).filter((k) => !k.startsWith("j") && !k.endsWith(":angle")).map((k) => +k.split(":")[0]!));
    return parts.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, label: name(p.type, p.id), type: p.type }));
  }, [parts, series]);
  const [pick, setPick] = useState<number | null>(null);
  const sel = options.find((o) => o.id === pick) ?? options.find((o) => o.type === "dcmotor") ?? options[0];

  const has = (m: Metric) => (sel && series[`${sel.id}:${m}`] ? [{ key: `${sel.id}:${m}`, label: sel.label }] : []);
  const angleLines = useMemo(() => Object.keys(series).filter((k) => k.endsWith(":angle")).slice(0, 5).map((k) => {
    if (k.startsWith("j")) return { key: k, label: `Junta n.º ${k.slice(1).split(":")[0]}` };
    const id = +k.split(":")[0]!;
    const p = parts.find((x) => x.id === id);
    return { key: k, label: p ? name(p.type, id) : `Pieza n.º ${id}` };
  }), [series, parts]);

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-bg p-3 pb-28 sm:p-4 lg:pb-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="an-part" className="text-sm text-muted">Pieza</label>
          <select id="an-part" value={sel?.id ?? ""} onChange={(e) => setPick(+e.target.value)} disabled={!options.length} className="h-11 min-w-[11rem] flex-1 rounded-lg border border-line bg-panel px-2 text-sm sm:flex-none">
            {options.length ? options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>) : <option>Sin datos todavía</option>}
          </select>
          <button onClick={() => setPaused(!paused)} aria-pressed={paused} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium">
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            {paused ? "Seguir grabando" : "Pausar grabación"}
          </button>
          <button onClick={clear} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-err">
            <Trash2 className="size-4" aria-hidden="true" /> Limpiar
          </button>
          <span className="ml-auto font-mono text-xs text-muted" aria-live="polite">
            {running ? (paused ? "Grabación en pausa" : "Grabando") : "Simulación detenida"} · {count} muestras · {fmt(lastT)} s
          </span>
        </div>

        {!count ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <p className="max-w-[48ch] text-sm text-muted">
              Los gráficos se graban mientras corre la simulación: voltaje, corriente, RPM, par y ángulo de las articulaciones, 10 veces por segundo.
            </p>
            {!running && (
              <button onClick={toggleRun} className="flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink">
                <Play className="size-4 fill-current" aria-hidden="true" /> Iniciar simulación
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <TimeChart title="Voltaje en bornes" unit="V" lines={has("v")} />
            <TimeChart title="Corriente" unit="A" lines={has("i")} digits={3} />
            <TimeChart title="Velocidad" unit="RPM" lines={has("rpm")} digits={0} />
            <TimeChart title="Par" unit="N·m" lines={has("torque")} digits={3} />
            <div className="md:col-span-2">
              <TimeChart title="Ángulo de las articulaciones" unit="°" lines={angleLines} digits={1} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
