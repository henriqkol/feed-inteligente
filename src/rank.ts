// Monta a edição do feed e salva na tabela "feed" (o job faz isso às 06h e às 17h).
import { fromVec, pool } from './db.js';
import { FEED_SIZE } from './config.js';
import { runIfMain } from './cli.js';
import { collapseClusters, pickLongRead, scoreCandidate, selectFeed, type Candidate, type FeedEntry, type Interest, type TopicRule } from './ranking.js';

export async function buildFeed(size = FEED_SIZE): Promise<FeedEntry[]> {
  const { rows: intRows } = await pool.query('select topic, vector, weight, alpha, beta from interests');
  const interests: Interest[] = intRows.map((r) => ({
    topic: r.topic, vector: fromVec(r.vector), weight: Number(r.weight), alpha: Number(r.alpha), beta: Number(r.beta),
  }));

  const { rows: topicRows } = await pool.query('select slug, max_share from topics');
  const rules: TopicRule[] = topicRows.map((r) => ({ slug: r.slug, maxShare: Number(r.max_share) }));

  // Candidatos: dentro de 4τ do tema (frescor > 2%), não concluídos por você e não exibidos em dias anteriores
  const { rows } = await pool.query(
    `select a.id, coalesce(a.cluster_id, a.id) as cluster_id, s.name as source_name, s.reputation,
            a.topic, a.embedding, a.published_at, a.depth, a.title, a.url, t.tau_hours
       from articles a
       join sources s on s.id = a.source_id
       join topics  t on t.slug = a.topic
      where a.published_at > now() - make_interval(hours => (t.tau_hours * 4)::int)
        -- texto com acentos estragados (feed lido na codificação errada) não entra na edição
        and strpos(a.title || coalesce(a.summary, ''), chr(65533)) = 0
        -- só sai quem você concluiu ("Aprendi algo" / "Menos disso"); aberta e não concluída pode voltar na edição seguinte do dia
        and not exists (select 1 from events e where e.article_id = a.id and e.kind in ('learned', 'less'))
        and not exists (select 1 from salvos sv where sv.article_id = a.id)
        and not exists (select 1 from feed f where f.article_id = a.id
                         and f.day < current_date and f.day >= current_date - 7)
      order by a.published_at desc
      limit 3000`,
  );
  const candidates: Candidate[] = rows.map((r) => ({
    id: Number(r.id), clusterId: Number(r.cluster_id), sourceName: r.source_name, reputation: Number(r.reputation),
    topic: r.topic, embedding: fromVec(r.embedding), publishedAt: new Date(r.published_at), depth: Number(r.depth),
    title: r.title, url: r.url, tauHours: Number(r.tau_hours),
  }));

  // Temas que não apareceram no feed nos últimos 7 dias
  const { rows: under } = await pool.query<{ slug: string }>(
    `select t.slug from topics t
      where not exists (select 1 from feed f join articles a on a.id = f.article_id
                         where a.topic = t.slug and f.day >= current_date - 7 and f.day < current_date)`,
  );

  const now = new Date();
  const scored = collapseClusters(candidates.map((c) => scoreCandidate(c, interests, now)));
  const feed = selectFeed(scored, interests, rules, { size, underexposedTopics: under.map((u) => u.slug) });
  // Leitura longa do dia vai no topo, fora das cotas
  const longa = pickLongRead(scored, feed);
  if (longa) return [{ item: longa, reason: 'longa' }, ...feed];
  // Poucos candidatos: promove o melhor texto de fôlego que já entrou na edição
  const i = feed.findIndex((f) => f.reason === 'relevance' && f.item.depth >= 0.75);
  if (i < 0) return feed;
  const [promovido] = feed.splice(i, 1);
  return [{ item: promovido.item, reason: 'longa' }, ...feed];
}

export async function saveFeed(entries: FeedEntry[]) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from feed where day = current_date');
    for (let i = 0; i < entries.length; i++) {
      const { item, reason } = entries[i];
      await client.query(
        'insert into feed (day, position, article_id, reason, score, also_covered_by) values (current_date, $1, $2, $3, $4, $5)',
        [i + 1, item.id, reason, item.score, item.alsoCoveredBy],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export function printFeed(feed: FeedEntry[]) {
  const tag = { relevance: '  ', quota: 'Q ', exploration: '✦ ', longa: 'L ' };
  feed.forEach(({ item, reason }, i) =>
    console.log(
      `${String(i + 1).padStart(2)}. ${tag[reason]}[${item.topic}] ${item.title} — ${item.sourceName} (${item.score.toFixed(2)})` +
        (item.alsoCoveredBy.length ? `  +${item.alsoCoveredBy.join(', ')}` : ''),
    ),
  );
}

runIfMain(import.meta.url, async () => {
  const feed = await buildFeed();
  await saveFeed(feed);
  printFeed(feed);
  console.log(`\nFeed salvo: ${feed.length} itens (L = leitura longa, Q = cota semanal, ✦ = exploração).`);
});
