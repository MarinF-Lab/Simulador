import type { ReactNode } from "react";
import type { PartKind } from "../core/model/catalog";

// Iconos de línea de cada familia de piezas, dibujados en una caja de 40 × 40.

function gear(teeth: number, r: number): string {
  const pts: string[] = [];
  const w = Math.PI / teeth;
  for (let i = 0; i < teeth; i++) {
    const t = i * 2 * w;
    for (const [R, a] of [[r - 2.5, t - w * 0.5], [r + 2, t - w * 0.25], [r + 2, t + w * 0.25], [r - 2.5, t + w * 0.5]] as const) {
      pts.push(`${(20 + R * Math.cos(a)).toFixed(1)} ${(20 + R * Math.sin(a)).toFixed(1)}`);
    }
  }
  return `M${pts.join("L")}Z`;
}

const SHAPES: Record<PartKind, ReactNode> = {
  source: (
    <>
      <rect x="6" y="13" width="25" height="14" rx="2.5" className="fill-accent/25" />
      <rect x="31" y="17" width="3" height="6" rx="1" />
      <path d="M11 20h5M24 20h-5M21.5 17.5v5" />
    </>
  ),
  resistor: <path d="M3 20h7l2-5 4 10 4-10 4 10 4-10 2 5h7" />,
  lamp: (
    <>
      <circle cx="20" cy="17" r="9" className="fill-warn/25" />
      <path d="M16 13l8 8M24 13l-8 8M16 28h8M17 32h6" />
    </>
  ),
  led: (
    <>
      <path d="M14 12l12 8-12 8z" className="fill-err/25" />
      <path d="M26 12v16M4 20h10M26 20h10M22 9l3-4M27 10l3-4" />
    </>
  ),
  switch: (
    <>
      <path d="M3 24h8M29 24h8M11 24l16-9" />
      <circle cx="11" cy="24" r="2" className="fill-current" />
      <circle cx="29" cy="24" r="2" className="fill-current" />
    </>
  ),
  wire: (
    <>
      <path d="M6 28c10 0 8-16 14-16s4 16 14 16" />
      <circle cx="6" cy="28" r="2.5" className="fill-err" stroke="none" />
      <circle cx="34" cy="28" r="2.5" className="fill-accent" stroke="none" />
    </>
  ),
  hbridge: (
    <>
      <rect x="9" y="9" width="22" height="22" rx="2" className="fill-accent/20" />
      <path d="M15 15v10M25 15v10M15 20h10M9 14H5M9 26H5M31 14h4M31 26h4" />
    </>
  ),
  dcmotor: (
    <>
      <rect x="6" y="11" width="22" height="18" rx="4" className="fill-accent/20" />
      <path d="M28 20h8M12 11v18" />
      <circle cx="20" cy="20" r="3" />
    </>
  ),
  stepper: (
    <>
      <rect x="9" y="9" width="22" height="22" rx="3" className="fill-accent/20" />
      <circle cx="20" cy="20" r="6" />
      <path d="M20 4v10M12 12h0M28 12h0M12 28h0M28 28h0" strokeWidth="3" />
    </>
  ),
  servo: (
    <>
      <rect x="6" y="14" width="24" height="16" rx="2" className="fill-accent/20" />
      <path d="M3 18h3M30 18h3M12 14V9M12 9l14-3" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  linear: (
    <>
      <rect x="4" y="15" width="20" height="10" rx="2" className="fill-accent/20" />
      <path d="M24 20h10M34 16v8M8 20h0" />
    </>
  ),
  shaft: (
    <>
      <path d="M4 20h32" strokeWidth="4" />
      <path d="M10 15v10M30 15v10" />
    </>
  ),
  gear: (
    <>
      <path d={gear(10, 12)} className="fill-muted/20" />
      <circle cx="20" cy="20" r="3.5" />
    </>
  ),
  pulley: (
    <>
      <circle cx="20" cy="20" r="14" className="fill-warn/15" />
      <circle cx="20" cy="20" r="10" />
      <circle cx="20" cy="20" r="3" />
    </>
  ),
  belt: (
    <>
      <circle cx="11" cy="20" r="6" />
      <circle cx="29" cy="20" r="8" />
      <path d="M11 14l18-2M11 26l18 2" strokeWidth="3" />
    </>
  ),
  bearing: (
    <>
      <circle cx="20" cy="20" r="14" className="fill-muted/15" />
      <circle cx="20" cy="20" r="6" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle key={a} cx={20 + 10 * Math.cos((a * Math.PI) / 180)} cy={20 + 10 * Math.sin((a * Math.PI) / 180)} r="1.8" className="fill-current" stroke="none" />
      ))}
    </>
  ),
  controller: (
    <>
      <rect x="6" y="9" width="28" height="22" rx="2" className="fill-muted/15" />
      <rect x="15" y="16" width="8" height="6" className="fill-current" stroke="none" />
      <path d="M10 9V5M16 9V5M24 9V5M30 9V5M10 31v4M16 31v4M24 31v4M30 31v4" />
    </>
  ),
  splitter: (
    <>
      <rect x="4" y="14" width="32" height="12" rx="2" className="fill-muted/15" />
      {[10, 17, 24, 31].map((x) => <circle key={x} cx={x} cy="20" r="2" />)}
    </>
  ),
  custom: (
    <>
      <path d="M6 30l4-20 14-4 10 12-6 14z" className="fill-muted/15" />
      <circle cx="14" cy="20" r="1.8" />
      <circle cx="24" cy="24" r="1.8" />
    </>
  ),
  draw: (
    <>
      <path d="M6 30l6-18 16-4 6 14" strokeDasharray="3 2" />
      {[[6, 30], [12, 12], [28, 8], [34, 22]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.4" className="fill-accent/40" />)}
    </>
  ),
  customPlain: <path d="M6 30l4-20 14-4 10 12-6 14z" className="fill-muted/15" />,
  drill: (
    <>
      <path d="M8 10h14l4 4-4 4H8z" className="fill-muted/15" />
      <path d="M26 14h8M22 18l-2 6 4 2-2 6" />
      <circle cx="13" cy="30" r="3" className="fill-accent/40" />
    </>
  ),
  glue: (
    <>
      <rect x="4" y="22" width="16" height="10" rx="1" className="fill-muted/15" />
      <rect x="20" y="22" width="16" height="10" rx="1" className="fill-muted/15" />
      <path d="M20 21c-3-4-3-8 0-13 3 5 3 9 0 13z" className="fill-accent/40" />
    </>
  ),
  wheel: (
    <>
      <circle cx="20" cy="20" r="14" className="fill-muted/15" strokeWidth="4" />
      <circle cx="20" cy="20" r="6" />
      <circle cx="20" cy="20" r="1.8" className="fill-current" stroke="none" />
    </>
  ),
  piston: (
    <>
      <path d="M4 14h32v12H4z" className="fill-muted/15" />
      <rect x="20" y="16" width="8" height="8" className="fill-accent/30" />
      <path d="M24 20l-12-12" />
      <circle cx="12" cy="8" r="2" />
    </>
  ),
  rope: (
    <>
      <circle cx="20" cy="9" r="6" className="fill-muted/15" />
      <path d="M14 9v18" />
      <path d="M10 27h8v7h-8z" className="fill-accent/30" />
    </>
  ),
  weight: (
    <>
      <path d="M10 16h20l4 18H6z" className="fill-muted/15" />
      <circle cx="20" cy="10" r="4" />
    </>
  ),
  support: (
    <>
      <path d="M6 34h28M12 34V18a8 8 0 0 1 16 0v16" className="fill-muted/15" />
      <circle cx="20" cy="18" r="3" />
    </>
  ),
  bracket: (
    <>
      <path d="M8 32h26v-5H13V8H8z" className="fill-muted/15" />
      <circle cx="24" cy="29.5" r="1.6" />
      <circle cx="10.5" cy="16" r="1.6" />
    </>
  ),
  link: (
    <>
      <rect x="4" y="15" width="32" height="10" rx="5" className="fill-muted/15" />
      <circle cx="9" cy="20" r="2" />
      <circle cx="31" cy="20" r="2" />
    </>
  ),
  joint: (
    <>
      <path d="M5 30l13-10M35 30l-13-10" strokeWidth="4" />
      <circle cx="20" cy="18" r="5" className="fill-accent/30" />
      <path d="M12 8a11 11 0 0 1 16 0" strokeDasharray="2 2" />
    </>
  ),
  profile: (
    <>
      <path d="M4 15h32v10H4z" className="fill-muted/15" />
      {[9, 16, 23, 30].map((x) => <circle key={x} cx={x + 0.5} cy="20" r="1.8" />)}
    </>
  ),
  plate: (
    <>
      <path d="M20 8l15 8-15 8-15-8z" className="fill-muted/15" />
      <path d="M5 16v5l15 8 15-8v-5M20 24v5" />
    </>
  ),
  bolt: (
    <>
      <path d="M14 8h12l3 5H11z" className="fill-muted/20" />
      <path d="M17 13v19h6V13M17 18h6M17 23h6M17 28h6" />
    </>
  ),
  sensor: (
    <>
      <circle cx="20" cy="20" r="6" className="fill-ok/25" />
      <path d="M10 10a14 14 0 0 0 0 20M30 10a14 14 0 0 1 0 20M14 14a8 8 0 0 0 0 12M26 14a8 8 0 0 1 0 12" />
    </>
  ),
  meter: (
    <>
      <rect x="7" y="6" width="26" height="28" rx="3" className="fill-accent/15" />
      <path d="M11 22a9 9 0 0 1 18 0M20 22l5-6" />
      <text x="20" y="31" textAnchor="middle" fontSize="7" className="fill-current" stroke="none">V</text>
    </>
  ),
  text: <path d="M10 10h20M20 10v20M15 30h10" />,
};

export function PartIcon({ kind, className = "size-10" }: { kind: PartKind; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SHAPES[kind]}
    </svg>
  );
}
