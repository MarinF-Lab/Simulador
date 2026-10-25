import { useMemo } from "react";
import type { Issue } from "../core/electrical/circuit";
import { useProject } from "../store/project";
import { useSim } from "../store/sim";

const ORDER: Record<Issue["s"], number> = { err: 0, warn: 1, info: 2, ok: 3 };

/** Avisos del circuito y de los mecanismos juntos, ordenados por gravedad. */
export function useIssues(): Issue[] {
  const ci = useProject((s) => s.circuit.issues);
  const mi = useProject((s) => s.mech.issues);
  const si = useProject((s) => s.structure.issues);
  const sim = useSim((s) => s.status?.issues);
  return useMemo(() => {
    const all = [...ci, ...mi, ...si, ...(sim ?? [])];
    // "Mesa vacía" solo tiene sentido si tampoco hay mecanismos.
    return all.sort((a, b) => ORDER[a.s] - ORDER[b.s]);
  }, [ci, mi, si, sim]);
}
