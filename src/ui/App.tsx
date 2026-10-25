const STAGES: { n: number; t: string; d: string }[] = [
  { n: 0, t: "Proyecto base", d: "Vite, React, TypeScript, Tailwind, pruebas y publicación." },
  { n: 1, t: "Estructura de interfaz", d: "Barra superior, biblioteca, propiedades y hojas en celular." },
  { n: 2, t: "Mesa 3D", d: "Cuadrícula isométrica, gestos, piezas, deshacer y rehacer." },
  { n: 3, t: "Circuitos", d: "Análisis nodal, bornes y cables 3D, avisos." },
  { n: 4, t: "Transmisiones", d: "Engranajes, poleas, correas, ejes y trabas." },
  { n: 5, t: "Estructuras y física", d: "Perfiles, juntas, Rapier y motor DC." },
  { n: 6, t: "Actuadores y control", d: "Servo, paso a paso, actuador lineal, puente H y sensores." },
  { n: 7, t: "Análisis", d: "Gráficos grabados en tiempo real." },
  { n: 8, t: "Guardar, ejemplos y pulido", d: "Persistencia, 6 ejemplos y 50 fps en celular." },
];
const CURRENT = 0;

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
      <path
        d="M16 3l2.6 3.4 4.2-.9.6 4.2 3.8 2-2 3.8 2 3.8-3.8 2-.6 4.2-4.2-.9L16 29l-2.6-3.4-4.2.9-.6-4.2-3.8-2 2-3.8-2-3.8 3.8-2 .6-4.2 4.2.9z"
        fill="var(--color-accent)"
      />
      <circle cx="16" cy="16" r="5" fill="var(--color-bg)" />
      <circle cx="16" cy="16" r="2" fill="var(--color-accent)" />
    </svg>
  );
}

export function App() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 py-3 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]">
          <Logo />
          <div className="min-w-0">
            <p className="font-display text-xl leading-none font-bold tracking-wide">KINETIC</p>
            <p className="text-xs text-muted">Circuitos y Mecanismos</p>
          </div>
          <span className="ml-auto rounded-full border border-line px-3 py-1 font-mono text-xs text-muted">
            Etapa {CURRENT}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-6 pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]">
        <section className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold text-balance sm:text-4xl">Simulador de circuitos y mecanismos en 3D</h1>
          <p className="max-w-[62ch] text-muted">
            Arma estructuras, conecta circuitos con cables y hazlos mover con motores, servos y transmisiones.
            Esta versión es la base del proyecto: la mesa 3D llega en la etapa 2.
          </p>
        </section>

        <section aria-labelledby="ruta" className="rounded-xl border border-line bg-panel">
          <h2 id="ruta" className="border-b border-line px-4 py-3 text-xs font-semibold tracking-widest text-muted uppercase">
            Ruta de trabajo
          </h2>
          <ol className="divide-y divide-line">
            {STAGES.map((s) => {
              const state = s.n < CURRENT ? "done" : s.n === CURRENT ? "now" : "next";
              return (
                <li key={s.n} className="flex min-h-11 items-start gap-3 px-4 py-3">
                  <span
                    className={
                      "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md font-mono text-sm " +
                      (state === "now"
                        ? "bg-accent text-accent-ink"
                        : state === "done"
                          ? "bg-ok/20 text-ok"
                          : "border border-line text-muted")
                    }
                  >
                    {s.n}
                  </span>
                  <div className="min-w-0">
                    <p className={"font-medium " + (state === "next" ? "text-muted" : "")}>
                      {s.t}
                      {state === "now" && <span className="ml-2 text-xs font-semibold text-accent">en curso</span>}
                    </p>
                    <p className="text-sm text-muted">{s.d}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="size-2.5 rounded-full bg-ok" aria-hidden="true" />
          Compilado y probado antes de publicar.
        </p>
      </main>
    </div>
  );
}
