import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCopy, ClipboardPaste, Download, FilePlus2, FolderOpen, X } from "lucide-react";
import type { Project } from "../core/model/project";
import { EXAMPLES } from "../core/persistence/examples";
import { parseProject, serialize } from "../core/persistence/file";
import { sceneApi } from "../scene/api";
import { useSave } from "../store/autosave";
import { useProject } from "../store/project";
import { useRecord } from "../store/record";
import { useUI } from "../store/ui";

const row = "flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 text-left text-sm hover:border-accent";

type Downloads = { save: (r: { filename: string; data: string }) => Promise<unknown> };

/** Descargas del visor de claude.ai, si la página corre ahí; si no, null. */
async function artifactDownloads(): Promise<Downloads | null> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (typeof c?.use !== "function") return null;
  try {
    return ((await c.use("downloads")) as Downloads | null) ?? null;
  } catch {
    return null;
  }
}

/** Reemplaza la mesa: detiene la simulación, limpia los gráficos y ajusta la vista. */
function apply(project: Project) {
  useUI.setState({ running: false });
  useRecord.getState().clear();
  useProject.getState().load(project);
  setTimeout(() => sceneApi.fit(), 50);
}

/** Menú Proyecto: guardado, exportar e importar, ejemplos y mesa vacía. */
export function ProjectMenu({ onClose }: { onClose: () => void }) {
  const save = useSave();
  const [confirm, setConfirm] = useState<{ name: string; project: Project } | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [copyText, setCopyText] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const ask = (name: string, project: Project) => { setMsg(null); setConfirm({ name, project }); };
  const read = (text: string, name: string) => {
    const r = parseProject(text);
    if (!r.ok) { setMsg({ text: r.error, err: true }); return; }
    setPaste(null);
    ask(name, r.project);
    if (r.dropped) setMsg({ text: `Se descartaron ${r.dropped} elementos que no se pudieron leer.` });
  };
  const doExport = async () => {
    const data = serialize(useProject.getState().project);
    const filename = "kinetic-proyecto.json";
    // Dentro de claude.ai la descarga pasa por el visor, que pide confirmar.
    const dl = await artifactDownloads();
    if (dl) {
      try {
        await dl.save({ filename, data });
        setMsg({ text: "Archivo guardado." });
      } catch (e) {
        const code = (e as { code?: string }).code;
        setMsg(code === "declined" ? { text: "Descarga cancelada." } : { text: "No se pudo descargar aquí: usa Copiar JSON.", err: true });
      }
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg({ text: "Archivo descargado. Si no aparece, usa Copiar JSON." });
    } catch {
      setMsg({ text: "Este navegador no deja descargar: usa Copiar JSON.", err: true });
    }
  };
  const doCopy = async () => {
    const text = serialize(useProject.getState().project);
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ text: "JSON copiado. Pégalo en una nota para guardarlo." });
    } catch {
      setCopyText(text);
      setMsg({ text: "No se pudo copiar solo: selecciona el texto y cópialo." });
    }
  };

  // En el body, para quedar sobre la barra superior y las hojas.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <button aria-label="Cerrar menú Proyecto" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel pb-[env(safe-area-inset-bottom,0px)] shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <h2 id="pm-title" className="flex-1 text-lg font-semibold">Proyecto</h2>
          <button onClick={onClose} aria-label="Cerrar" className="grid size-11 place-items-center rounded-lg text-muted hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <p className="px-4 text-xs text-muted">
          {save.ok
            ? "Cada cambio se guarda solo en este navegador. Exporta el archivo para llevarlo a otro equipo."
            : "Este navegador no deja guardar: exporta el archivo para no perder la mesa."}
        </p>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {confirm && (
            <div className="space-y-2 rounded-lg border border-warn/60 bg-warn/10 p-3 text-sm" role="alert">
              <p>Esto reemplaza la mesa actual por «{confirm.name}» y no se puede deshacer.</p>
              <div className="flex gap-2">
                <button className="min-h-11 flex-1 rounded-lg border border-line px-3" onClick={() => setConfirm(null)}>Cancelar</button>
                <button className="min-h-11 flex-1 rounded-lg bg-accent px-3 font-semibold text-accent-ink" onClick={() => { apply(confirm.project); onClose(); }}>Reemplazar</button>
              </div>
            </div>
          )}
          {msg && <p className={"text-sm " + (msg.err ? "text-err" : "text-muted")} aria-live="polite">{msg.text}</p>}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Archivo</h3>
            <div className="grid grid-cols-2 gap-2">
              <button className={row} onClick={() => void doExport()}><Download className="size-5 text-accent" aria-hidden="true" />Exportar</button>
              <button className={row} onClick={() => void doCopy()}><ClipboardCopy className="size-5 text-accent" aria-hidden="true" />Copiar JSON</button>
              <button className={row} onClick={() => file.current?.click()}><FolderOpen className="size-5 text-accent" aria-hidden="true" />Importar</button>
              <button className={row} onClick={() => { setPaste(""); setCopyText(null); }}><ClipboardPaste className="size-5 text-accent" aria-hidden="true" />Pegar JSON</button>
            </div>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Elegir archivo de proyecto"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void f.text().then((t) => read(t, f.name));
              }}
            />
            {copyText !== null && (
              <textarea readOnly value={copyText} onFocus={(e) => e.target.select()} aria-label="JSON del proyecto" className="h-28 w-full rounded-lg border border-line bg-bg p-2 font-mono text-xs" />
            )}
            {paste !== null && (
              <div className="space-y-2">
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Pega aquí el JSON del proyecto" aria-label="JSON para cargar" className="h-28 w-full rounded-lg border border-line bg-bg p-2 font-mono text-xs" />
                <button className="min-h-11 w-full rounded-lg bg-accent font-semibold text-accent-ink disabled:opacity-40" disabled={!paste.trim()} onClick={() => read(paste, "el JSON pegado")}>Cargar</button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Ejemplos</h3>
            {EXAMPLES.map((ex) => (
              <button key={ex.id} className={row + " flex-col items-start gap-0.5 py-2"} onClick={() => ask(ex.name, ex.build())}>
                <span className="font-medium">{ex.name}</span>
                <span className="text-xs text-muted">{ex.desc}</span>
              </button>
            ))}
          </section>

          <button className={row} onClick={() => ask("una mesa vacía", { parts: [], cables: [], belts: [], joints: [], nextId: 1 })}>
            <FilePlus2 className="size-5 text-accent" aria-hidden="true" />Mesa vacía
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
