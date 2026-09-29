// Gera o protótipo semântico de cada tema e inicializa o perfil de interesses.
// Rode uma vez depois de aplicar schema.sql e seed.sql (e de novo se editar os temas).
import { pool, toVec } from './db.js';
import { embed } from './embed.js';

async function main() {
  const { rows } = await pool.query<{ slug: string; description: string }>('select slug, description from topics');
  const vecs = await embed(rows.map((r) => r.description), 'query');

  for (let i = 0; i < rows.length; i++) {
    await pool.query('update topics set prototype = $2 where slug = $1', [rows[i].slug, toVec(vecs[i])]);
    await pool.query(
      `insert into interests (topic, vector) values ($1, $2) on conflict (topic) do nothing`,
      [rows[i].slug, toVec(vecs[i])],
    );
  }
  console.log(`✓ ${rows.length} temas com protótipo e perfil inicial.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
