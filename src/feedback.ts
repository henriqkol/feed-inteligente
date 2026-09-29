// Etapa 3: aprende com o seu comportamento.
// Chame recordEvent() a partir da API do app (ex.: rota Next.js) a cada interação.
import { pathToFileURL } from 'node:url';
import { pool, toVec } from './db.js';
import { BOUNCE_MS, MIN_WEIGHT } from './config.js';
import { clamp } from './math.js';
import { signalFor, updateVector, type EventKind } from './learning.js';

export type { EventKind };

export async function recordEvent(articleId: number, kind: EventKind, dwellMs?: number) {
  const { rows } = await pool.query(
    `select a.topic, a.embedding, a.word_count, i.vector, i.weight
       from articles a join interests i on i.topic = a.topic
      where a.id = $1`,
    [articleId],
  );
  if (!rows[0]) throw new Error(`Artigo ${articleId} não encontrado`);
  const r = rows[0];

  const effectiveKind: EventKind = kind === 'read' && dwellMs !== undefined && dwellMs < BOUNCE_MS ? 'bounce' : kind;
  await pool.query('insert into events (article_id, kind, dwell_ms) values ($1, $2, $3)', [articleId, effectiveKind, dwellMs ?? null]);

  const s = signalFor(effectiveKind, dwellMs, r.word_count);
  if (s === 0) return { topic: r.topic, signal: 0 };

  const newVec = updateVector(r.vector, r.embedding, s);
  const newWeight = clamp(Number(r.weight) + 0.05 * s, MIN_WEIGHT, 1);

  await pool.query(
    `update interests
        set vector = $2, weight = $3,
            alpha = alpha + $4, beta = beta + $5,
            last_reinforced_at = case when $4 > 0 then now() else last_reinforced_at end
      where topic = $1`,
    [r.topic, toVec(newVec), newWeight, Math.max(s, 0), Math.max(-s, 0)],
  );
  return { topic: r.topic, signal: s, weight: newWeight };
}

// Uso pela linha de comando: npm run feedback -- <articleId> <kind> [dwellMs]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, kind, dwell] = process.argv.slice(2);
  recordEvent(Number(id), kind as EventKind, dwell ? Number(dwell) : undefined)
    .then((r) => console.log(r))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
