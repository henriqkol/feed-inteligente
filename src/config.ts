// Todos os parâmetros ajustáveis do algoritmo ficam aqui.

export const EMBED_DIM = 384;
export const EMBED_MODEL = 'Xenova/multilingual-e5-small';

// Nota final: score = Σ peso × componente
export const WEIGHTS = {
  relevance: 0.45,
  quality: 0.2,
  freshness: 0.2,
  depth: 0.15,
};

// O e5 concentra similaridades entre ~0,70 (sem relação) e ~0,95 (mesmo assunto).
// Reescalamos esse intervalo para 0..1. Calibre com seus dados se necessário.
export const SIM_FLOOR = 0.74;
export const SIM_CEIL = 0.92;

// Deduplicação: mesma notícia em fontes diferentes
export const DEDUP_SIM = 0.92;
export const DEDUP_WINDOW_HOURS = 72;

// Filtros de qualidade
export const CLICKBAIT_MAX = 0.6;
export const MAX_ARTICLE_AGE_DAYS = 30;

// Montagem do feed
export const FEED_SIZE = 30;
export const MMR_LAMBDA = 0.7; // 1 = só relevância, 0 = só diversidade
export const EXPLORATION_RATE = 0.12; // ~12% de itens fora da sua bolha
export const MAX_QUOTA_SLOTS = 3; // vagas por dia para temas sem exposição na semana

// Aprendizado
export const EMA_ALPHA = 0.1;
export const WEEKLY_DECAY = 0.95;
export const MIN_WEIGHT = 0.1; // nenhum interesse some por completo
export const BOUNCE_MS = 10_000;
export const READING_WPM = 230;

// Saúde das fontes
export const MAX_FEED_FAILS = 5;
