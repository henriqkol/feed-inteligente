// Gera o protótipo semântico de cada tema e inicializa o perfil de interesses.
// O job chama isto sozinho quando encontra temas sem protótipo (ex.: tema novo no seed).
import { pool, toVec } from './db.js';
import { embed } from './embed.js';
import { runIfMain } from './cli.js';

export async function setupTopics(onlyMissing = true): Promise<number> {
  const { rows } = await pool.query<{ slug: string; description: string }>(
    `select slug, description from topics ${onlyMissing ? 'where prototype is null' : ''}`,
  );
  if (rows.length === 0) return 0;
  const vecs = await embed(rows.map((r) => r.description), 'query');
  for (let i = 0; i < rows.length; i++) {
    await pool.query('update topics set prototype = $2 where slug = $1', [rows[i].slug, toVec(vecs[i])]);
    await pool.query('insert into interests (topic, vector) values ($1, $2) on conflict (topic) do nothing', [
      rows[i].slug,
      toVec(vecs[i]),
    ]);
  }
  return rows.length;
}

runIfMain(import.meta.url, async () => {
  const n = await setupTopics(process.argv.includes('--todos') ? false : true);
  console.log(`✓ ${n} temas com protótipo e perfil inicial.`);
});
