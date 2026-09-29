// Etapa 3: aprende com o seu comportamento.
// O app só grava em "events"; o job chama learnPending() a cada hora para aplicar o aprendizado.
import { fromVec, pool, toVec } from './db.js';
import { BOUNCE_MS, MIN_WEIGHT } from './config.js';
import { clamp } from './math.js';
import { runIfMain } from './cli.js';
import { signalFor, updateVector, type EventKind } from './learning.js';

export type { EventKind };

/** Aplica um evento ao perfil de interesses do tema do artigo. */
async function applyEvent(articleId: number, kind: EventKind, dwellMs?: number | null) {
  const { rows } = await pool.query(
    `select a.topic, a.embedding, a.word_count, i.vector, i.weight
       from articles a join interests i on i.topic = a.topic
      where a.id = $1`,
    [articleId],
  );
  if (!rows[0]) return null; // artigo apagado pela limpeza
  const r = rows[0];

  const effective: EventKind = kind === 'read' && dwellMs != null && dwellMs < BOUNCE_MS ? 'bounce' : kind;
  const s = signalFor(effective, dwellMs ?? undefined, r.word_count);
  if (s === 0) return { topic: r.topic as string, signal: 0 };

  const newVec = updateVector(fromVec(r.vector), fromVec(r.embedding), s);
  const newWeight = clamp(Number(r.weight) + 0.05 * s, MIN_WEIGHT, 1);
  await pool.query(
    `update interests
        set vector = $2, weight = $3,
            alpha = alpha + $4, beta = beta + $5,
            last_reinforced_at = case when $4 > 0 then now() else last_reinforced_at end
      where topic = $1`,
    [r.topic, toVec(newVec), newWeight, Math.max(s, 0), Math.max(-s, 0)],
  );
  return { topic: r.topic as string, signal: s, weight: newWeight };
}

/** Processa, em ordem, os eventos que o app registrou desde a última execução. */
export async function learnPending(): Promise<number> {
  const { rows } = await pool.query(
    `select id, article_id, kind, dwell_ms from events where processed_at is null order by created_at, id limit 5000`,
  );
  for (const e of rows) {
    await applyEvent(Number(e.article_id), e.kind, e.dwell_ms);
    await pool.query('update events set processed_at = now() where id = $1', [e.id]);
  }
  return rows.length;
}

/** Registra e aplica um evento na hora (uso pela linha de comando). */
export async function recordEvent(articleId: number, kind: EventKind, dwellMs?: number) {
  const { rows } = await pool.query(
    'insert into events (article_id, kind, dwell_ms, processed_at) values ($1, $2, $3, now()) returning id',
    [articleId, kind, dwellMs ?? null],
  );
  const r = await applyEvent(articleId, kind, dwellMs);
  return { event: rows[0].id, ...r };
}

// npm run feedback -- <articleId> <kind> [dwellMs]    |    npm run feedback -- pendentes
runIfMain(import.meta.url, async () => {
  const [id, kind, dwell] = process.argv.slice(2);
  if (id === 'pendentes') console.log(`✓ ${await learnPending()} eventos processados`);
  else console.log(await recordEvent(Number(id), kind as EventKind, dwell ? Number(dwell) : undefined));
});
