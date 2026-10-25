import { ChartLine, Activity, PencilRuler, Play, Redo2, Save, Square, Undo2 } from "lucide-react";
import { useUI, type Tab } from "../store/ui";
import { useProject } from "../store/project";
import { Logo } from "./Logo";

const TABS: { id: Tab; name: string; Icon: typeof Play }[] = [
  { id: "design", name: "Diseño", Icon: PencilRuler },
  { id: "simulation", name: "Simulación", Icon: Activity },
  { id: "analysis", name: "Análisis", Icon: ChartLine },
];

const iconBtn =
  "grid size-11 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

export function TopBar() {
  const { tab, setTab, running, toggleRun } = useUI();
  const canUndo = useProject((s) => s.history.past.length > 0);
  const canRedo = useProject((s) => s.history.future.length > 0);
  const { undo, redo } = useProject();
  return (
    <header className="z-20 border-b border-line bg-panel pl-[max(12px,env(safe-area-inset-left,0px))] pr-[max(12px,env(safe-area-inset-right,0px))]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 lg:flex-nowrap lg:gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <div className="min-w-0">
            <p className="font-display text-lg leading-none font-bold tracking-wide">KINETIC</p>
            <p className="hidden text-xs text-muted sm:block">Circuitos y Mecanismos</p>
          </div>
        </div>

        <nav
          role="tablist"
          aria-label="Modo de trabajo"
          className="order-last flex w-full gap-1 rounded-xl border border-line bg-bg/60 p-1 lg:order-none lg:mx-auto lg:w-auto"
        >
          {TABS.map(({ id, name, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={
                "flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium lg:flex-none lg:px-5 " +
                (tab === id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")
              }
            >
              <Icon className="size-4" aria-hidden="true" />
              {name}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <button className={iconBtn} aria-label="Guardar" title="Guardar (llega en la etapa 8)" disabled>
            <Save className="size-5" />
          </button>
          <button className={iconBtn} aria-label="Deshacer" title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
            <Undo2 className="size-5" />
          </button>
          <button className={iconBtn} aria-label="Rehacer" title="Rehacer (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
            <Redo2 className="size-5" />
          </button>
          <button
            onClick={toggleRun}
            aria-pressed={running}
            className={
              "ml-1 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold sm:px-4 " +
              (running ? "bg-err/90 text-white hover:bg-err" : "bg-accent text-accent-ink hover:brightness-110")
            }
          >
            {running ? <Square className="size-4 fill-current" aria-hidden="true" /> : <Play className="size-4 fill-current" aria-hidden="true" />}
            <span className="hidden sm:inline">{running ? "Detener" : "Iniciar simulación"}</span>
            <span className="sm:hidden">{running ? "Detener" : "Iniciar"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
