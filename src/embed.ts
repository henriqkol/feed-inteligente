import { env, pipeline } from '@huggingface/transformers';
import { EMBED_MODEL } from './config.js';

// Modelo local (roda em CPU, sem chave de API). Baixa ~120 MB na primeira execução;
// no GitHub Actions a pasta fica em cache entre as execuções.
env.cacheDir = process.env.MODEL_CACHE_DIR ?? '.cache/modelos';

let extractor: any = null;

async function getExtractor() {
  if (!extractor) extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
  return extractor;
}

/**
 * O e5 é assimétrico: "query:" para descrições de interesse, "passage:" para artigos.
 * Os vetores saem normalizados, então produto escalar = cosseno.
 */
export async function embed(texts: string[], kind: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (process.env.EMBED_FAKE === '1') return texts.map(fakeEmbed); // só para testes locais
  const ex = await getExtractor();
  const out: number[][] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map((t) => `${kind}: ${t}`);
    const tensor = await ex(chunk, { pooling: 'mean', normalize: true });
    out.push(...(tensor.tolist() as number[][]));
  }
  return out;
}

/** Embedding falso (saco de palavras com hash) para testar o pipeline sem baixar o modelo. */
function fakeEmbed(text: string): number[] {
  const v = new Array(384).fill(0.05);
  for (const w of text.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
    if (w.length < 3) continue;
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 384] += 1;
  }
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
