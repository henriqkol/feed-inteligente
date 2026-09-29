// Job único, executado de hora em hora pelo GitHub Actions:
//   1. prepara temas novos   2. aprende com o que você fez no app   3. coleta os feeds
//   4. monta uma nova edição às 06h e às 17h (Brasília)   5. manutenção semanal
// Cada execução fica registrada em "execucoes" (o app mostra "atualizado há X").
import { pool } from './db.js';
import { runIfMain } from './cli.js';
import { setupTopics } from './setup.js';
import { learnPending } from './feedback.js';
import { ingestAll } from './ingest.js';
import { buildFeed, printFeed, saveFeed } from './rank.js';
import { decay } from './decay.js';

/** Precisa de edição nova? Sim se não houve montagem desde o último horário de edição (06h/17h). */
async function editionDue(): Promise<boolean> {
  const { rows } = await pool.query<{ due: boolean }>(
    `with limite as (
       select (case when localtime >= time '17:00' then current_date + time '17:00'
                    when localtime >= time '06:00' then current_date + time '06:00'
                    else current_date - 1 + time '17:00' end)::timestamptz as desde
     )
     select not exists (select 1 from execucoes, limite
                         where ok and detalhes ? 'edicao' and inicio >= limite.desde) as due`,
  );
  return rows[0].due;
}

async function decayDue(): Promise<boolean> {
  const { rows } = await pool.query<{ due: boolean }>(
    `select not exists (select 1 from execucoes where ok and detalhes ? 'manutencao'
                         and inicio > now() - interval '7 days') as due`,
  );
  return rows[0].due;
}

export async function runJob(opts: { forceEdition?: boolean } = {}) {
  const { rows } = await pool.query<{ id: string }>('insert into execucoes default values returning id');
  const runId = rows[0].id;
  const detalhes: Record<string, unknown> = {};
  const t0 = Date.now();
  try {
    const novosTemas = await setupTopics(true);
    if (novosTemas) detalhes.temas_preparados = novosTemas;

    detalhes.eventos = await learnPending();
    detalhes.coleta = await ingestAll();

    if (opts.forceEdition || (await editionDue())) {
      const feed = await buildFeed();
      await saveFeed(feed);
      printFeed(feed);
      detalhes.edicao = { itens: feed.length };
    }
    if (await decayDue()) detalhes.manutencao = await decay();

    detalhes.segundos = Math.round((Date.now() - t0) / 1000);
    await pool.query('update execucoes set fim = now(), ok = true, detalhes = $2 where id = $1', [runId, detalhes]);
    console.log('✓ Execução concluída', JSON.stringify(detalhes));
  } catch (e) {
    detalhes.erro = (e as Error).message;
    await pool.query('update execucoes set fim = now(), ok = false, detalhes = $2 where id = $1', [runId, detalhes]);
    throw e;
  }
}

runIfMain(import.meta.url, () => runJob({ forceEdition: process.env.FORCAR_EDICAO === 'true' }));
