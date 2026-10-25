/** Resuelve A·x = b con eliminación gaussiana y pivoteo parcial. Una fila sin pivote da 0. */
export function solve(A: Float64Array[], b: Float64Array, n: number): Float64Array {
  const M = A.map((row, i) => {
    const r = new Float64Array(n + 1);
    r.set(row);
    r[n] = b[i]!;
    return r;
  });
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i]![k]!) > Math.abs(M[p]![k]!)) p = i;
    [M[k], M[p]] = [M[p]!, M[k]!];
    const d = M[k]![k]!;
    if (Math.abs(d) < 1e-15) continue;
    for (let i = k + 1; i < n; i++) {
      const f = M[i]![k]! / d;
      if (!f) continue;
      for (let j = k; j <= n; j++) M[i]![j]! -= f * M[k]![j]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = Math.abs(M[i]![i]!) < 1e-15 ? 0 : s / M[i]![i]!;
  }
  return x;
}
