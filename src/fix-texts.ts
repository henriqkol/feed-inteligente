// Manutenção única: limpa títulos, resumos e textos já gravados com tags ou entidades HTML
// (feeds com HTML escapado duas vezes, como o Nexo, e entidades numéricas como &#8220;).
// Roda dentro do job uma vez por versão; notícias da edição atual alteradas têm o áudio refeito.
import { pool } from './db.js';
import { runIfMain } from './cli.js';
import { htmlToParagraphs, stripHtml } from './quality.js';

const VERSAO = '2';
const SUJO = `(<[a-zA-Z/][^>]*>|&(#x?[0-9a-fA-F]+|[a-zA-Z]+);)`;

export async function fixStoredTexts(force = false): Promise<{ corrigidos: number; audios: number } | null> {
  const { rows: v } = await pool.query(`select valor #>> '{}' as v from preferencias where chave = 'textos_limpos'`);
  if (!force && v[0]?.v === VERSAO) return null;

  const { rows } = await pool.query(
    `select id, title, summary, content from articles
      where title ~ $1 or summary ~ $1 or content ~ $1`,
    [SUJO],
  );
  const { rows: noFeed } = await pool.query(
    `select article_id from feed where day = (select max(day) from feed)`,
  );
  const edicao = new Set(noFeed.map((r) => String(r.article_id)));
  let corrigidos = 0, audios = 0;
  for (const a of rows) {
    const title = stripHtml(a.title);
    const summary = a.summary == null ? null : stripHtml(a.summary).slice(0, 600);
    const content = a.content == null ? null : htmlToParagraphs(a.content);
    if (title === a.title && summary === a.summary && content === a.content) continue;
    const refazAudio = edicao.has(String(a.id));
    await pool.query(
      `update articles set title = $2, summary = $3, content = $4
         ${refazAudio ? ', audio = null, audio_voz = null' : ''} where id = $1`,
      [a.id, title, summary, content],
    );
    corrigidos++;
    if (refazAudio) audios++;
  }
  await pool.query(
    `insert into preferencias (chave, valor) values ('textos_limpos', to_jsonb($1::text))
     on conflict (chave) do update set valor = excluded.valor`,
    [VERSAO],
  );
  return { corrigidos, audios };
}

runIfMain(import.meta.url, async () => console.log(await fixStoredTexts(true)));
