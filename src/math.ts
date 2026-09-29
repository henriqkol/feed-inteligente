export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

/** Amostra de uma Gamma(shape, 1) — método de Marsaglia–Tsang. */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      // normal padrão via Box–Muller
      const u1 = rng() || 1e-12;
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Amostra de uma Beta(alpha, beta), usada no Thompson sampling. */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}
