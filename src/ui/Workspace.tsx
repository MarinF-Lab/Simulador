import { lazy, Suspense } from "react";
import { Box, Info, Maximize, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { findItem } from "../core/model/catalog";
import { overlay, sceneApi } from "../scene/api";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";
import { PartIcon } from "./PartIcon";

const Scene = lazy(() => import("../scene/Scene").then((m) => ({ default: m.Scene })));

function Axes() {
  return (
    <svg ref={(el) => { overlay.axes = el; }} viewBox="0 0 64 64" className="size-16 shrink-0" role="img" aria-label="Ejes: X rojo, Y verde, Z azul">
      <g strokeWidth="2.5" strokeLinecap="round">
        <line data-axis="x" x1="32" y1="32" x2="50" y2="42" stroke="#ef5a5a" />
        <line data-axis="y" x1="32" y1="32" x2="50" y2="22" stroke="#3fb97a" />
        <line data-axis="z" x1="32" y1="32" x2="32" y2="8" stroke="#5b8def" />
      </g>
      <circle cx="32" cy="32" r="3" fill="var(--color-ink)" />
      <g fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
        <text data-label="x" x="54" y="48" fill="#ef5a5a">X</text>
        <text data-label="y" x="54" y="22" fill="#3fb97a">Y</text>
        <text data-label="z" x="28" y="7" fill="#5b8def">Z</text>
      </g>
    </svg>
  );
}

const viewBtn = "grid size-11 place-items-center rounded-lg border border-line bg-panel/95 text-ink hover:border-accent/60";

export function Workspace() {
  const { running, tab, openSheet } = useUI();
  const pending = useProject((s) => s.pending);
  const isCable = useProject((s) => s.project.cables.some((c) => c.id === s.selected));
  const issues = useProject((s) => s.circuit.issues);
  const top = issues[0];
  const counts = { err: issues.filter((i) => i.s === "err").length, warn: issues.filter((i) => i.s === "warn").length };
  const selected = useProject((s) => s.selected);
  const count = useProject((s) => s.project.parts.length);
  const type = useProject((s) => s.project.parts.find((p) => p.id === s.selected)?.type);
  const rotate = useProject((s) => s.rotate);
  const item = type ? findItem(type) : undefined;

  const hint = pending
    ? "Toca otro borne para unirlos con un cable. Toca el fondo para cancelar."
    : running
    ? "La simulación está corriendo: la corriente se ve moverse por los cables. Toca Detener para volver al diseño."
    : tab === "simulation"
      ? "Toca Iniciar para simular el circuito y el mecanismo juntos."
      : isCable
        ? "Arrastra las puntas del cable hasta los bornes. Se pegan solas al acercarlas."
      : item
        ? `Arrastra ${item.name.toLowerCase()} para moverlo. Toca dos veces o usa ⟳ para girarlo 90°. Toca un borne para empezar un cable.`
        : "Mueve la mesa con un dedo. Con dos dedos: pellizca para acercar, gira para orbitar y sube o baja para inclinar.";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
      <Suspense fallback={<p className="absolute inset-0 grid place-items-center text-sm text-muted">Cargando la mesa 3D…</p>}>
        <Scene />
      </Suspense>

      <button
        ref={(el) => { overlay.rotBtn = el; }}
        hidden
        onClick={() => selected !== null && rotate(selected)}
        aria-label="Girar 90°"
        className="absolute top-0 left-0 grid size-11 place-items-center rounded-full bg-accent text-accent-ink shadow-lg"
      >
        <RotateCw className="size-5" />
      </button>

      {running && (
        <span className="pointer-events-none absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ok/40 bg-panel px-3 py-1 text-xs font-medium text-ok">
          <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden="true" />
          Simulando
        </span>
      )}

      {top && (
        <button
          onClick={() => openSheet("properties")}
          className="absolute top-3 left-3 flex max-w-[calc(100%-84px)] items-center gap-2 rounded-full border border-line bg-panel/95 px-3 py-2 text-xs font-medium lg:pointer-events-none"
          aria-label={`Estado del circuito: ${top.h}`}
        >
          <span className={"size-2.5 shrink-0 rounded-full " + (counts.err ? "bg-err" : counts.warn ? "bg-warn" : top.s === "ok" ? "bg-ok" : "bg-muted")} aria-hidden="true" />
          <span className="truncate">{top.h}</span>
          {counts.err + counts.warn > 1 && <span className="shrink-0 font-mono text-muted">+{counts.err + counts.warn - 1}</span>}
        </button>
      )}

      <div role="group" aria-label="Vista" className="absolute top-3 right-3 flex flex-col gap-2">
        <button className={viewBtn} onClick={() => sceneApi.zoomBy(1.25)} aria-label="Acercar"><Plus className="size-5" /></button>
        <button className={viewBtn} onClick={() => sceneApi.zoomBy(0.8)} aria-label="Alejar"><Minus className="size-5" /></button>
        <button className={viewBtn} onClick={() => sceneApi.fit()} aria-label="Ajustar vista"><Maximize className="size-5" /></button>
        <button className={viewBtn} onClick={() => sceneApi.rotateView(1)} aria-label="Girar vista 90°" title="Girar vista 90°"><RotateCcw className="size-5" /></button>
        <button className={viewBtn} onClick={() => sceneApi.isoView()} aria-label="Vista isométrica" title="Vista isométrica"><Box className="size-5" /></button>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] flex items-end gap-3 lg:bottom-3">
        <Axes />
        <p role="status" className="flex min-w-0 flex-1 items-start gap-2 self-end rounded-xl border border-line bg-panel/95 px-3 py-2 text-xs text-ink/90 sm:mx-auto sm:max-w-[520px]">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {hint}
        </p>
        <div className="hidden w-40 shrink-0 flex-col items-center gap-1 rounded-xl border border-line bg-panel/90 p-2 md:flex">
          {item ? <PartIcon kind={item.kind} className="size-12 text-ink/85" /> : <span className="size-12" />}
          <p className="text-center text-xs text-muted">{item ? `${item.name}${item.variant ? ` ${item.variant}` : ""}` : "Sin selección"}</p>
          <p className="text-center font-mono text-[11px] text-muted">{count} pieza{count === 1 ? "" : "s"} en la mesa</p>
        </div>
      </div>
    </div>
  );
}

export function AnalysisView() {
  const charts = ["Voltaje en bornes (V)", "Corriente (A)", "RPM", "Par (N·m)", "Ángulo de articulaciones (°)"];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28 lg:pb-4">
      <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
        {charts.map((c) => (
          <section key={c} className="flex min-h-40 flex-col rounded-xl border border-line bg-panel p-3">
            <h3 className="text-sm font-semibold">{c}</h3>
            <div className="relative mt-2 flex-1 rounded-lg border border-dashed border-line">
              <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">
                Inicia la simulación para grabar este gráfico (etapa 7).
              </p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
