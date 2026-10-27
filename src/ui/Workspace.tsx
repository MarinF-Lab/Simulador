import { lazy, Suspense } from "react";
import { ArrowLeftRight, Box, Hand, Info, Link2, Maximize, Minus, Move, Plus, Power, RotateCcw, RotateCw, Spline, Trash2, X } from "lucide-react";
import { POLAR } from "../core/model/terminals";
import { findItem } from "../core/model/catalog";
import { overlay, sceneApi } from "../scene/api";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";
import { useIssues } from "./useIssues";
import { PartIcon } from "./PartIcon";
import { RemotePanel } from "./Channels";

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
  const issues = useIssues();
  const beltMode = useProject((s) => s.beltMode);
  const isBelt = useProject((s) => (s.project.belts ?? []).some((b) => b.id === s.selected));
  const beltCross = useProject((s) => (s.project.belts ?? []).find((b) => b.id === s.selected)?.cross ?? false);
  const toggleCross = useProject((s) => s.toggleCross);
  const jointTool = useProject((s) => s.jointTool);
  const offer = useProject((s) => s.jointOffer);
  const selJoint = useProject((s) => (s.project.joints ?? []).find((j) => j.id === s.selected));
  const { acceptJoint, dismissJoint, setJointKind } = useProject();
  const top = issues[0];
  const counts = { err: issues.filter((i) => i.s === "err").length, warn: issues.filter((i) => i.s === "warn").length };
  const selected = useProject((s) => s.selected);
  const count = useProject((s) => s.project.parts.length);
  const joints = useProject((s) => (s.project.joints ?? []).filter((j) => j.kind === "revolute").length);
  const type = useProject((s) => s.project.parts.find((p) => p.id === s.selected)?.type);
  const { rotate, remove, cableMode, setCableMode, actuate, flip } = useProject();
  const selProps = useProject((s) => s.project.parts.find((p) => p.id === s.selected)?.props);
  const act = type === "hbridge"
    ? { label: `Sentido: ${typeof selProps?.dir === "string" ? selProps.dir : "Adelante"}`, on: selProps?.dir !== "Freno", Icon: ArrowLeftRight }
    : type === "switch"
    ? { label: selProps?.closed === false ? "Cerrar" : "Abrir", on: selProps?.closed !== false, Icon: Power }
    : type === "sensorContact"
      ? { label: selProps?.pressed === true ? "Soltar" : "Presionar", on: selProps?.pressed === true, Icon: Hand }
      : null;
  const item = type ? findItem(type) : undefined;

  const hint = jointTool
    ? `Toca una pieza que tenga un agujero alineado con otra para poner ${jointTool === "fixed" ? "una unión fija" : "una junta rotacional"}. Toca el fondo para cancelar.`
    : offer
    ? offer.shaft
      ? "La pieza quedó sobre el eje del motor: móntala para que gire con él."
      : "Dos agujeros quedaron alineados: elige junta rotacional (gira) o unión fija (perno)."
    : selJoint
    ? selJoint.kind === "revolute" ? "Junta rotacional: las piezas giran sobre este agujero al simular." : "Unión fija: las piezas quedan unidas como con un perno."
    : beltMode
    ? beltMode.rope
      ? beltMode.first === null
        ? "Toca la polea tambor que enrollará la cuerda. Toca el fondo para cancelar."
        : "Ahora toca la pieza que colgará de la cuerda."
      : beltMode.first === null
      ? "Toca la primera polea que unirá la correa. Toca el fondo para cancelar."
      : "Ahora toca la segunda polea. Deben quedar paralelas y en el mismo plano."
    : pending
    ? "Toca otro borne para unirlos con un cable. Toca el fondo para cancelar."
    : running
    ? "La simulación está corriendo: la corriente se ve moverse por los cables. Toca Detener para volver al diseño."
    : tab === "simulation"
      ? "Toca Iniciar para simular el circuito y el mecanismo juntos."
      : isBelt
        ? "Correa seleccionada: cámbiala a cruzada para invertir el giro, o elimínala."
      : isCable
        ? cableMode === "move"
          ? "Arrastra el cable para moverlo completo, o arrastra una punta hasta un borne."
          : "Arrastra el punto blanco para doblar el cable. Tócalo dos veces para dejarlo recto."
      : type === "hbridge"
        ? "Toca el botón de sentido para cambiar entre Adelante, Atrás y Freno. Entrada: la pila; salida: el motor."
      : act
        ? `Toca ${act.label} para accionar ${type === "switch" ? "el interruptor" : "el sensor"}. Arrástralo para moverlo o toca un borne para empezar un cable.`
      : item
        ? `Arrastra ${item.name.toLowerCase()} para moverlo. Toca dos veces o usa ⟳ para girarlo 90°. Toca un borne para empezar un cable.`
        : "Mueve la mesa con un dedo. Con dos dedos: pellizca para acercar, gira para orbitar y sube o baja para inclinar.";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
      <Suspense fallback={<p className="absolute inset-0 grid place-items-center text-sm text-muted">Cargando la mesa 3D…</p>}>
        <Scene />
      </Suspense>

      <div ref={(el) => { overlay.partTools = el; }} hidden className="absolute top-0 left-0 z-10 flex gap-2">
        {!running && type && POLAR.has(type) && (
          <button onClick={() => selected !== null && flip(selected)} className="flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-panel px-4 text-sm font-semibold text-ink shadow-lg">
            <ArrowLeftRight className="size-4" aria-hidden="true" /> {type === "dcmotor" ? "Invertir giro" : "Invertir polaridad"}
          </button>
        )}
        {act && (
          <button
            onClick={() => selected !== null && actuate(selected)}
            title={type === "hbridge" ? "Cambia entre Adelante, Atrás y Freno" : undefined}
            aria-pressed={act.on}
            className={"flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-lg " + (act.on ? "bg-ok text-white" : "border border-line bg-panel text-ink")}
          >
            <act.Icon className="size-4" aria-hidden="true" /> {act.label}
          </button>
        )}
        {!running && (
          <>
            <button onClick={() => selected !== null && rotate(selected)} aria-label="Girar 90°" className="grid size-11 place-items-center rounded-full bg-accent text-accent-ink shadow-lg">
              <RotateCw className="size-5" />
            </button>
            <button onClick={() => selected !== null && remove(selected)} aria-label="Eliminar pieza" className="grid size-11 place-items-center rounded-full bg-err text-white shadow-lg">
              <Trash2 className="size-5" />
            </button>
          </>
        )}
      </div>

      <div ref={(el) => { overlay.cableTools = el; }} hidden className="absolute top-0 left-0 z-10 flex items-center gap-2">
        <div role="radiogroup" aria-label="Al arrastrar el cable" className="flex rounded-full border border-line bg-panel p-1 shadow-lg">
          {([["move", "Mover", Move], ["bend", "Doblar", Spline]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              role="radio"
              aria-checked={cableMode === m}
              onClick={() => setCableMode(m)}
              className={"flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold " + (cableMode === m ? "bg-accent text-accent-ink" : "text-muted")}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <button onClick={() => selected !== null && remove(selected)} aria-label="Eliminar cable" className="grid size-11 place-items-center rounded-full bg-err text-white shadow-lg">
          <Trash2 className="size-5" />
        </button>
      </div>

      {running && <RemotePanel />}
      {running && (
        <span className="pointer-events-none absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ok/40 bg-panel px-3 py-1 text-xs font-medium text-ok">
          <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden="true" />
          Simulando
        </span>
      )}

      <div ref={(el) => { overlay.beltTools = el; }} hidden className="absolute top-0 left-0 z-10 flex items-center gap-2">
        <button onClick={() => selected !== null && toggleCross(selected)} aria-pressed={beltCross} className="min-h-11 rounded-full border border-line bg-panel px-4 text-xs font-semibold shadow-lg">
          {beltCross ? "Cruzada" : "Normal"} · cambiar
        </button>
        <button onClick={() => selected !== null && remove(selected)} aria-label="Eliminar correa" className="grid size-11 place-items-center rounded-full bg-err text-white shadow-lg">
          <Trash2 className="size-5" />
        </button>
      </div>

      <div ref={(el) => { overlay.offerTools = el; }} hidden className="absolute top-0 left-0 z-10 flex items-center gap-2">
        {offer?.shaft ? (
          <button onClick={() => acceptJoint("revolute")} className="flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-lg">
            <Link2 className="size-4" aria-hidden="true" /> Montar en el eje
          </button>
        ) : (
          <>
            <button onClick={() => acceptJoint("revolute")} className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-lg">Junta rotacional</button>
            <button onClick={() => acceptJoint("fixed")} className="min-h-11 rounded-full border border-line bg-panel px-4 text-sm font-semibold shadow-lg">Unión fija</button>
          </>
        )}
        <button onClick={dismissJoint} aria-label="No unir" className="grid size-11 place-items-center rounded-full border border-line bg-panel text-muted shadow-lg">
          <X className="size-5" />
        </button>
      </div>

      <div ref={(el) => { overlay.jointTools = el; }} hidden className="absolute top-0 left-0 z-10 flex items-center gap-2">
        <div role="radiogroup" aria-label="Tipo de junta" className="flex rounded-full border border-line bg-panel p-1 shadow-lg">
          {([["revolute", "Rotacional"], ["fixed", "Fija"]] as const).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={selJoint?.kind === k} onClick={() => selJoint && setJointKind(selJoint.id, k)} className={"min-h-9 rounded-full px-3 text-xs font-semibold " + (selJoint?.kind === k ? "bg-accent text-accent-ink" : "text-muted")}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => selected !== null && remove(selected)} aria-label="Eliminar junta" className="grid size-11 place-items-center rounded-full bg-err text-white shadow-lg">
          <Trash2 className="size-5" />
        </button>
      </div>

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
          <p className="text-center font-mono text-[11px] text-muted">{count} pieza{count === 1 ? "" : "s"} · {joints} articulaci{joints === 1 ? "ón" : "ones"}</p>
        </div>
      </div>
    </div>
  );
}
