import { Info } from "lucide-react";
import { findItem } from "../core/model/catalog";
import { useUI } from "../store/ui";
import { PartIcon } from "./PartIcon";

/** Cuadrícula isométrica de muestra; la mesa 3D real llega en la etapa 2. */
function IsoGrid() {
  return (
    <svg className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <pattern id="iso" width="56" height="32.33" patternUnits="userSpaceOnUse">
          <path d="M0 16.17L28 0L56 16.17L28 32.33Z" fill="none" stroke="var(--color-line)" strokeWidth="1" />
        </pattern>
        <radialGradient id="fade" cx="50%" cy="45%" r="70%">
          <stop offset="0" stopColor="var(--color-bg)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-bg)" stopOpacity="0.85" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#iso)" />
      <rect width="100%" height="100%" fill="url(#fade)" />
    </svg>
  );
}

function Axes() {
  return (
    <svg viewBox="0 0 64 64" className="size-16" role="img" aria-label="Ejes: X rojo, Y verde, Z azul">
      <g strokeWidth="2.5" strokeLinecap="round">
        <path d="M20 44L44 56" stroke="#ef5a5a" />
        <path d="M20 44L44 32" stroke="#3fb97a" />
        <path d="M20 44V14" stroke="#5b8def" />
      </g>
      <circle cx="20" cy="44" r="3" fill="var(--color-ink)" />
      <g fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
        <text x="47" y="61" fill="#ef5a5a">X</text>
        <text x="47" y="33" fill="#3fb97a">Y</text>
        <text x="15" y="11" fill="#5b8def">Z</text>
      </g>
    </svg>
  );
}

function MiniArm() {
  return (
    <svg viewBox="0 0 120 80" className="h-16 w-full" aria-hidden="true" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round">
      <path d="M20 72h40M30 72v-8h20v8" />
      <path d="M40 64L52 30L92 22" strokeWidth="5" stroke="var(--color-muted)" strokeOpacity="0.5" />
      <circle cx="40" cy="64" r="4" fill="var(--color-panel)" />
      <circle cx="52" cy="30" r="4" fill="var(--color-panel)" />
      <path d="M92 22l8-6M92 22l8 4" />
    </svg>
  );
}

export function Workspace() {
  const { selected, running, tab } = useUI();
  const item = selected ? findItem(selected) : undefined;
  const hint = running
    ? "La simulación está corriendo. Toca Detener para volver a la posición de diseño."
    : tab === "simulation"
      ? "Toca Iniciar para simular el circuito y el mecanismo juntos."
      : "Elige una pieza en la biblioteca. En la etapa 2 podrás arrastrarla a la mesa 3D.";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
      <IsoGrid />

      {item && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className={"rounded-2xl border border-line bg-panel/80 p-5 " + (running ? "ring-2 ring-ok/60" : "")}>
              <PartIcon kind={item.kind} className={"size-24 text-ink/90 " + (running && (item.kind === "gear" || item.kind === "pulley") ? "motion-safe:animate-spin [animation-duration:4s]" : "")} />
            </div>
            <p className="font-mono text-xs text-muted">Vista previa · {item.name}{item.variant ? ` ${item.variant}` : ""}</p>
          </div>
        </div>
      )}

      {running && (
        <span className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ok/40 bg-panel px-3 py-1 text-xs font-medium text-ok">
          <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden="true" />
          Simulando
        </span>
      )}

      <div className="absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] flex items-end gap-3 lg:bottom-3">
        <Axes />
        <p role="status" className="flex min-w-0 flex-1 items-start gap-2 self-end rounded-xl border border-line bg-panel/95 px-3 py-2 text-xs text-ink/90 sm:mx-auto sm:max-w-[520px]">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {hint}
        </p>
        <div className="hidden w-40 shrink-0 rounded-xl border border-line bg-panel/90 p-2 md:block">
          <MiniArm />
          <p className="text-center text-xs text-muted">2 articulaciones</p>
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
