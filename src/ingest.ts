// Coleta: RSS → limpeza → filtros → embedding → classificação de tema → deduplicação.
// Agende a cada hora (cron, GitHub Actions ou Supabase cron).
import Parser from 'rss-parser';
import { pool, toVec } from './db.js';
import { embed } from './embed.js';
import { dot } from './math.js';
import {
  CLICKBAIT_MAX,
  DEDUP_SIM,
  DEDUP_WINDOW_HOURS,
  MAX_ARTICLE_AGE_DAYS,
  MAX_FEED_FAILS,
} from './config.js';
import { clickbaitScore, depthScore, isSponsored, normalizeUrl, stripHtml, wordCount } from './quality.js';

type Item = { title?: string; link?: string; isoDate?: string; pubDate?: string; content?: string; contentSnippet?: string; summary?: string; contentEncoded?: string };

const parser: Parser<{}, Item> = new Parser({
  timeout: 15_000,
  headers: { 'User-Agent': 'news-brain/0.1 (leitor pessoal de RSS)' },
  customFields: { item: [['content:encoded', 'contentEncoded']] },
});

interface Source { id: number; name: string; feed_url: string; default_topic: string; longform: boolean; fail_count: number }
interface TopicProto { slug: string; prototype: number[] }

/** Tema = protótipo mais próximo; o tema da fonte vence em caso de empate técnico. */
function classify(vec: number[], topics: TopicProto[], fallback: string): { topic: string; confidence: number } {
  let best = fallback;
  let bestSim = -1;
  let fallbackSim = -1;
  for (const t of topics) {
    const s = dot(vec, t.prototype);
    if (t.slug === fallback) fallbackSim = s;
    if (s > bestSim) { bestSim = s; best = t.slug; }
  }
  if (fallbackSim >= bestSim - 0.02) return { topic: fallback, confidence: fallbackSim };
  return { topic: best, confidence: bestSim };
}

async function ingestSource(src: Source, topics: TopicProto[]): Promise<number> {
  let feed;
  try {
    feed = await parser.parseURL(src.feed_url);
    await pool.query('update sources set fail_count = 0, last_ok_at = now() where id = $1', [src.id]);
  } catch (err) {
    const fails = src.fail_count + 1;
    const active = fails < MAX_FEED_FAILS;
    await pool.query('update sources set fail_count = $2, active = $3 where id = $1', [src.id, fails, active]);
    console.warn(`✗ ${src.name}: ${(err as Error).message}${active ? '' : ' → fonte desativada'}`);
    return 0;
  }

  const minDate = Date.now() - MAX_ARTICLE_AGE_DAYS * 86_400_000;
  const candidates = feed.items
    .filter((it) => it.title && it.link)
    .map((it) => {
      const text = stripHtml(it.contentEncoded || it.content || it.summary || it.contentSnippet || '');
      const published = new Date(it.isoDate || it.pubDate || Date.now());
      return {
        url: normalizeUrl(it.link!),
        title: stripHtml(it.title!),
        text,
        words: wordCount(text),
        published: isNaN(published.getTime()) ? new Date() : published,
      };
    })
    .filter((a) => a.published.getTime() > minDate)
    .filter((a) => !isSponsored(a.title, a.text))
    .map((a) => ({ ...a, clickbait: clickbaitScore(a.title) }))
    .filter((a) => a.clickbait <= CLICKBAIT_MAX);

  if (candidates.length === 0) return 0;

  // Pula URLs já coletadas
  const { rows: existing } = await pool.query<{ url: string }>('select url from articles where url = any($1)', [
    candidates.map((c) => c.url),
  ]);
  const seen = new Set(existing.map((r) => r.url));
  const fresh = candidates.filter((c) => !seen.has(c.url));
  if (fresh.length === 0) return 0;

  const vecs = await embed(fresh.map((a) => `${a.title}. ${a.text.slice(0, 1000)}`), 'passage');

  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const a = fresh[i];
    const vec = vecs[i];
    const { topic, confidence } = classify(vec, topics, src.default_topic);

    // Deduplicação: mesma notícia publicada por outra fonte nas últimas 72h
    const { rows: dup } = await pool.query<{ cid: string }>(
      `select coalesce(cluster_id, id) as cid
         from articles
        where published_at > now() - make_interval(hours => $2)
          and 1 - (embedding <=> $1) > $3
        order by embedding <=> $1
        limit 1`,
      [toVec(vec), DEDUP_WINDOW_HOURS, DEDUP_SIM],
    );

    const { rows } = await pool.query<{ id: string }>(
      `insert into articles (source_id, url, title, summary, word_count, published_at, topic, topic_confidence,
                             clickbait, depth, cluster_id, embedding)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (url) do nothing
       returning id`,
      [
        src.id, a.url, a.title, a.text.slice(0, 600), a.words, a.published, topic, confidence,
        a.clickbait, depthScore(a.words, src.longform), dup[0]?.cid ?? null, toVec(vec),
      ],
    );
    if (rows[0] && !dup[0]) await pool.query('update articles set cluster_id = id where id = $1', [rows[0].id]);
    if (rows[0]) inserted++;
  }
  return inserted;
}

async function main() {
  const { rows: topics } = await pool.query<TopicProto>('select slug, prototype from topics where prototype is not null');
  if (topics.length === 0) throw new Error('Temas sem protótipo. Rode "npm run setup" primeiro.');

  const { rows: sources } = await pool.query<Source>(
    'select id, name, feed_url, default_topic, longform, fail_count from sources where active',
  );

  let total = 0;
  for (const src of sources) {
    const n = await ingestSource(src, topics);
    if (n) console.log(`✓ ${src.name}: ${n} novos`);
    total += n;
  }
  console.log(`Coleta concluída: ${total} artigos novos de ${sources.length} fontes.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
