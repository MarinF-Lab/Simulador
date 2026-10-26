import { useEffect, type ReactNode } from "react";
import { Boxes, SlidersHorizontal, X } from "lucide-react";
import { useUI, type Sheet } from "../store/ui";
import { useProject } from "../store/project";
import { Library } from "./Library";
import { Properties } from "./Properties";
import { TopBar } from "./TopBar";
import { Workspace } from "./Workspace";
import { AnalysisView } from "./Analysis";

/** Columna lateral en escritorio; hoja deslizable desde abajo en celular. */
function Panel({ which, title, Icon, side, children }: { which: Exclude<Sheet, null>; title: string; Icon: typeof Boxes; side: "left" | "right"; children: ReactNode }) {
  const open = useUI((s) => s.sheet === which);
  const openSheet = useUI((s) => s.openSheet);
  return (
    <aside
      aria-label={title}
      className={
        "flex flex-col bg-panel max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:h-[78dvh] max-lg:rounded-t-2xl max-lg:border-t max-lg:border-line max-lg:pb-[env(safe-area-inset-bottom,0px)] max-lg:shadow-2xl max-lg:transition-transform max-lg:duration-300 lg:min-h-0 " +
        (side === "left" ? "lg:border-r lg:border-line " : "lg:border-l lg:border-line ") +
        (open ? "max-lg:translate-y-0" : "max-lg:invisible max-lg:translate-y-full")
      }
    >
      <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-line lg:hidden" aria-hidden="true" />
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-5 text-accent" aria-hidden="true" />
        <h2 className="flex-1 font-semibold">{title}</h2>
        <button onClick={() => openSheet(null)} aria-label={`Cerrar ${title.toLowerCase()}`} className="grid size-11 place-items-center rounded-lg text-muted hover:text-ink lg:hidden">
          <X className="size-5" />
        </button>
      </div>
      {children}
    </aside>
  );
}

export function App() {
  const { sheet, openSheet, tab } = useUI();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select")) return;
      const P = useProject.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) P.redo();
        else P.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        P.redo();
      } else if (e.key === "Escape") {
        openSheet(null);
        P.select(null);
      } else if ((e.key === "r" || e.key === "R") && !mod && P.selected !== null) {
        P.rotate(P.selected);
      } else if ((e.key === "Delete" || e.key === "Backspace") && P.selected !== null) {
        e.preventDefault();
        P.remove(P.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSheet]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="relative grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <Panel which="library" title="Componentes" Icon={Boxes} side="left">
          <Library />
        </Panel>
        {/* La mesa sigue montada (y simulando) mientras se miran los gráficos encima. */}
        <main className="relative flex min-h-0 flex-col">
          <Workspace />
          {tab === "analysis" && <AnalysisView />}
        </main>
        <Panel which="properties" title="Propiedades" Icon={SlidersHorizontal} side="right">
          <Properties />
        </Panel>

        {sheet && <button aria-label="Cerrar panel" onClick={() => openSheet(null)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

        <nav className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-line bg-panel px-[max(12px,env(safe-area-inset-left,0px))] pt-2 pb-[max(8px,env(safe-area-inset-bottom,0px))] lg:hidden">
          <button onClick={() => openSheet("library")} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-panel-2 text-sm font-medium">
            <Boxes className="size-5 text-accent" aria-hidden="true" /> Componentes
          </button>
          <button onClick={() => openSheet("properties")} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-panel-2 text-sm font-medium">
            <SlidersHorizontal className="size-5 text-accent" aria-hidden="true" /> Propiedades
          </button>
        </nav>
      </div>
    </div>
  );
}
