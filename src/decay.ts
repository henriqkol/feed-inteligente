// Manutenção semanal: interesses não reforçados perdem força e o bandit "esquece" aos poucos.
import { pool } from './db.js';
import { MIN_WEIGHT, WEEKLY_DECAY } from './config.js';

async function main() {
  const decayed = await pool.query(
    `update interests
        set weight = greatest($1, weight * $2)
      where last_reinforced_at < now() - interval '7 days'`,
    [MIN_WEIGHT, WEEKLY_DECAY],
  );

  // Bandit com memória curta: evidências antigas pesam menos (volta devagar para Beta(1,1))
  await pool.query(`update interests set alpha = 1 + (alpha - 1) * 0.9, beta = 1 + (beta - 1) * 0.9`);

  // Limpeza: artigos velhos que você nunca salvou
  const cleaned = await pool.query(
    `delete from articles a
      where a.published_at < now() - interval '90 days'
        and not exists (select 1 from events e where e.article_id = a.id and e.kind in ('save', 'learned'))`,
  );

  console.log(`✓ ${decayed.rowCount} interesses enfraquecidos, ${cleaned.rowCount} artigos antigos removidos.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
