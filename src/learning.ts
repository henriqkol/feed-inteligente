// Regras de aprendizado, sem banco de dados (testáveis isoladamente).
import { BOUNCE_MS, EMA_ALPHA, READING_WPM } from './config.js';
import { clamp, dot, normalize } from './math.js';

export type EventKind = 'open' | 'read' | 'save' | 'learned' | 'less' | 'bounce';

/** Converte a interação em um sinal: positivo aproxima, negativo afasta. */
export function signalFor(kind: EventKind, dwellMs: number | undefined, wordCount: number): number {
  switch (kind) {
    case 'open':
      return 0; // abrir não prova interesse; o tempo de leitura prova
    case 'read': {
      if (dwellMs === undefined) return 0.5;
      if (dwellMs < BOUNCE_MS) return -0.5;
      const expectedMs = Math.max(30_000, (wordCount / READING_WPM) * 60_000);
      return clamp(dwellMs / expectedMs, 0.2, 1.5);
    }
    case 'save':
      return 1.5;
    case 'learned':
      return 2;
    case 'less':
      return -1.5;
    case 'bounce':
      return -0.5;
  }
}

/** Positivo: média móvel em direção ao artigo. Negativo: afasta levemente o vetor do artigo. */
export function updateVector(v: number[], a: number[], signal: number): number[] {
  const step = Math.min(0.25, EMA_ALPHA * Math.abs(signal));
  if (signal > 0) return normalize(v.map((x, i) => (1 - step) * x + step * a[i]));
  // remove parte da componente do artigo que não está alinhada ao interesse atual
  const proj = dot(v, a);
  return normalize(v.map((x, i) => x - step * 0.5 * (a[i] - proj * x)));
}
