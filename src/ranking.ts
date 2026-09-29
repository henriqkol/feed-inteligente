// Núcleo do algoritmo, sem banco de dados (testável isoladamente).
import { EXPLORATION_RATE, MAX_QUOTA_SLOTS, MMR_LAMBDA, SIM_CEIL, SIM_FLOOR, WEIGHTS } from './config.js';
import { clamp, dot, sampleBeta } from './math.js';

export interface Candidate {
  id: number;
  clusterId: number;
  sourceName: string;
  reputation: number;
  topic: string;
  embedding: number[];
  publishedAt: Date;
  depth: number;
  title: string;
  url: string;
  tauHours: number;
}

export interface Interest {
  topic: string;
  vector: number[];
  weight: number;
  alpha: number;
  beta: number;
}

export interface TopicRule {
  slug: string;
  maxShare: number;
}

export interface Scored extends Candidate {
  relevance: number;
  freshness: number;
  score: number;
  alsoCoveredBy: string[];
}

export type Reason = 'relevance' | 'exploration' | 'quota' | 'longa';
export interface FeedEntry {
  item: Scored;
  reason: Reason;
}

export const rescaleSim = (s: number) => clamp((s - SIM_FLOOR) / (SIM_CEIL - SIM_FLOOR), 0, 1);

/** Etapa 2: nota de cada artigo. */
export function scoreCandidate(c: Candidate, interests: Interest[], now: Date = new Date()): Scored {
  // Relevância: melhor encaixe entre o artigo e qualquer um dos seus interesses,
  // ponderado pela afinidade atual com aquele tema.
  let relevance = 0;
  for (const i of interests) relevance = Math.max(relevance, i.weight * rescaleSim(dot(c.embedding, i.vector)));

  const hours = Math.max(0, (now.getTime() - c.publishedAt.getTime()) / 3_600_000);
  const freshness = Math.exp(-hours / c.tauHours);

  const score =
    WEIGHTS.relevance * relevance +
    WEIGHTS.quality * c.reputation +
    WEIGHTS.freshness * freshness +
    WEIGHTS.depth * c.depth;

  return { ...c, relevance, freshness, score, alsoCoveredBy: [] };
}

/** Mesma notícia em várias fontes → fica só a da fonte mais reputada; as outras viram "outras coberturas". */
export function collapseClusters(items: Scored[]): Scored[] {
  const groups = new Map<number, Scored[]>();
  for (const it of items) {
    const g = groups.get(it.clusterId);
    if (g) g.push(it);
    else groups.set(it.clusterId, [it]);
  }
  const out: Scored[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => b.reputation - a.reputation || b.score - a.score);
    const [best, ...rest] = g;
    const others = [...new Set(rest.map((r) => r.sourceName).filter((n) => n !== best.sourceName))];
    out.push({ ...best, alsoCoveredBy: others });
  }
  return out;
}

export interface SelectOptions {
  size: number;
  /** temas sem nenhuma aparição no feed nos últimos 7 dias */
  underexposedTopics: string[];
  rng?: () => number;
}

/** Etapa 4: cotas → MMR (relevância × diversidade) → exploração (Thompson) → intercalação. */
export function selectFeed(items: Scored[], interests: Interest[], rules: TopicRule[], opts: SelectOptions): FeedEntry[] {
  const { size } = opts;
  const rng = opts.rng ?? Math.random;
  const cap = new Map(rules.map((r) => [r.slug, Math.max(1, Math.ceil(r.maxShare * size))]));
  const count = new Map<string, number>();
  const used = new Set<number>();

  const canTake = (it: Scored) => !used.has(it.id) && (count.get(it.topic) ?? 0) < (cap.get(it.topic) ?? size);
  const mark = (it: Scored) => {
    used.add(it.id);
    count.set(it.topic, (count.get(it.topic) ?? 0) + 1);
  };

  const nExplore = Math.min(Math.round(size * EXPLORATION_RATE), Math.max(0, size - 1));
  const nMain = size - nExplore;
  const main: FeedEntry[] = [];

  // 1) Cotas: todo interesse aparece ao menos uma vez por semana
  for (const topic of opts.underexposedTopics.slice(0, MAX_QUOTA_SLOTS)) {
    if (main.length >= nMain) break;
    const best = items.filter((i) => i.topic === topic && canTake(i)).sort((a, b) => b.score - a.score)[0];
    if (best) {
      mark(best);
      main.push({ item: best, reason: 'quota' });
    }
  }

  // 2) MMR: escolhe o próximo item equilibrando nota e diferença em relação ao que já entrou
  while (main.length < nMain) {
    let best: Scored | null = null;
    let bestVal = -Infinity;
    for (const it of items) {
      if (!canTake(it)) continue;
      let redundancy = 0;
      for (const c of main) redundancy = Math.max(redundancy, rescaleSim(dot(it.embedding, c.item.embedding)));
      const val = MMR_LAMBDA * it.score - (1 - MMR_LAMBDA) * redundancy;
      if (val > bestVal) {
        bestVal = val;
        best = it;
      }
    }
    if (!best) break;
    mark(best);
    main.push({ item: best, reason: 'relevance' });
  }

  // 3) Exploração: Thompson sampling por tema, favorecendo temas pouco presentes hoje.
  //    O item escolhido ignora a relevância (é justamente o que ela esconderia)
  //    e privilegia qualidade, frescor e profundidade.
  const explore: FeedEntry[] = [];
  const exploreValue = (i: Scored) => 0.5 * i.reputation + 0.3 * i.freshness + 0.2 * i.depth;
  while (explore.length < nExplore) {
    let pickTopic: string | null = null;
    let bestDraw = -1;
    for (const int of interests) {
      if (!items.some((i) => i.topic === int.topic && canTake(i))) continue;
      const draw = sampleBeta(int.alpha, int.beta, rng) / (1 + (count.get(int.topic) ?? 0));
      if (draw > bestDraw) {
        bestDraw = draw;
        pickTopic = int.topic;
      }
    }
    if (!pickTopic) break;
    const pick = items.filter((i) => i.topic === pickTopic && canTake(i)).sort((a, b) => exploreValue(b) - exploreValue(a))[0];
    mark(pick);
    explore.push({ item: pick, reason: 'exploration' });
  }

  // 4) Intercala a exploração ao longo do feed em vez de jogar tudo no fim
  const result = [...main];
  const step = Math.max(1, Math.floor(main.length / (explore.length + 1)));
  explore.forEach((e, k) => result.splice(Math.min(result.length, (k + 1) * step + k), 0, e));
  return result;
}

/**
 * Leitura longa do dia: o melhor texto de fôlego (fonte de análise, texto longo) que ainda não está no feed.
 * Prefere artigos com texto completo no feed (dá para ler dentro do app).
 */
export function pickLongRead(items: Scored[], feed: FeedEntry[], minDepth = 0.75): Scored | null {
  const usados = new Set(feed.map((f) => f.item.id));
  const clusters = new Set(feed.map((f) => f.item.clusterId));
  const livres = items.filter((i) => !usados.has(i.id) && !clusters.has(i.clusterId));
  const melhor = (lista: Scored[]) => lista.sort((a, b) => b.score + b.relevance - (a.score + a.relevance))[0] ?? null;
  return melhor(livres.filter((i) => i.depth >= minDepth)) ?? melhor(livres.filter((i) => i.depth >= 0.5));
}
