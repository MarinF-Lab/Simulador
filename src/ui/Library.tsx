import { ChevronDown, Search, X } from "lucide-react";
import { CATEGORIES, searchCatalog } from "../core/model/catalog";
import { useUI } from "../store/ui";
import { useProject } from "../store/project";
import { sceneApi } from "../scene/api";
import { PartIcon } from "./PartIcon";
import { startPaletteGesture } from "./paletteDrag";

export function Library() {
  const { search, setSearch, collapsed, toggleCategory } = useUI();
  const items = searchCatalog(search);
  const searching = search.trim() !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Buscar componente</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="lib-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar componente…"
            className="h-11 w-full rounded-lg border border-line bg-bg pr-10 pl-9 text-sm placeholder:text-muted/70"
          />
          {searching && (
            <button onClick={() => setSearch("")} aria-label="Borrar búsqueda" className="absolute top-0 right-0 grid size-11 place-items-center text-muted">
              <X className="size-4" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {CATEGORIES.map((cat) => {
          const list = items.filter((i) => i.category === cat.id);
          if (!list.length) return null;
          const open = searching || !collapsed[cat.id];
          return (
            <section key={cat.id} className="border-t border-line first:border-t-0">
              <button
                onClick={() => toggleCategory(cat.id)}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between text-sm font-semibold"
              >
                {cat.name}
                <span className="flex items-center gap-2 text-xs font-normal text-muted">
                  {list.length}
                  <ChevronDown className={"size-4 transition-transform " + (open ? "" : "-rotate-90")} aria-hidden="true" />
                </span>
              </button>
              {open && (
                <div className="grid grid-cols-3 gap-2 pb-3">
                  {list.map((it) => (
                    <button
                      key={it.id}
                      onPointerDown={(e) => startPaletteGesture(e, it.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          const c = sceneApi.viewCenter();
                          useProject.getState().addNear(it.id, c.x, c.y);
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      aria-label={`Agregar ${it.name.toLowerCase()}${it.variant ? ` ${it.variant}` : ""} a la mesa`}
                      className="flex min-h-[88px] touch-pan-y flex-col items-center justify-center gap-1 rounded-lg border border-line bg-panel-2/60 px-1 py-2 text-center text-xs leading-tight text-ink select-none hover:border-accent/60 [-webkit-touch-callout:none]"
                    >
                      <PartIcon kind={it.kind} className="size-9 text-ink/85" />
                      <span className="font-medium">{it.name}</span>
                      {it.variant && <span className="text-[11px] text-muted">{it.variant}</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {!items.length && (
          <p className="py-6 text-center text-sm text-muted">No hay piezas que coincidan con «{search}». Prueba con otra palabra, por ejemplo «motor».</p>
        )}
      </div>
    </div>
  );
}
