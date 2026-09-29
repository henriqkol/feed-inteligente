import { pipeline } from '@huggingface/transformers';
import { EMBED_MODEL } from './config.js';

// Modelo local (roda em CPU, sem chave de API). Baixa ~120 MB na primeira execução.
let extractor: any = null;

async function getExtractor() {
  if (!extractor) extractor = await pipeline('feature-extraction', EMBED_MODEL);
  return extractor;
}

/**
 * O e5 é assimétrico: "query:" para descrições de interesse, "passage:" para artigos.
 * Os vetores saem normalizados, então produto escalar = cosseno.
 */
export async function embed(texts: string[], kind: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  if (texts.length === 0) return [];
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
