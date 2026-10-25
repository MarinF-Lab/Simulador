import { useMemo } from "react";
import type { Issue } from "../core/electrical/circuit";
import { useProject } from "../store/project";

const ORDER: Record<Issue["s"], number> = { err: 0, warn: 1, info: 2, ok: 3 };

/** Avisos del circuito y de los mecanismos juntos, ordenados por gravedad. */
export function useIssues(): Issue[] {
  const ci = useProject((s) => s.circuit.issues);
  const mi = useProject((s) => s.mech.issues);
  return useMemo(() => {
    const all = [...ci, ...mi];
    // "Mesa vacía" solo tiene sentido si tampoco hay mecanismos.
    return all.sort((a, b) => ORDER[a.s] - ORDER[b.s]);
  }, [ci, mi]);
}
