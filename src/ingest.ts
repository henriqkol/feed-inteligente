// Coleta: RSS → limpeza → filtros → embedding → classificação de tema → deduplicação.
// Chamado pelo job (src/job.ts) a cada hora.
import Parser from 'rss-parser';
import { fromVec, pool, toVec } from './db.js';
import { runIfMain } from './cli.js';
import { embed } from './embed.js';
import { dot } from './math.js';
import {
  CLICKBAIT_MAX,
  DEDUP_SIM,
  DEDUP_WINDOW_HOURS,
  MAX_ARTICLE_AGE_DAYS,
  MAX_FEED_FAILS,
} from './config.js';
import { clickbaitScore, depthScore, htmlToParagraphs, isSponsored, normalizeUrl, pickImage, stripHtml, wordCount } from './quality.js';

type Item = {
  title?: string; link?: string; isoDate?: string; pubDate?: string; content?: string; contentSnippet?: string;
  summary?: string; contentEncoded?: string; mediaContent?: any; mediaThumbnail?: any; enclosure?: { url?: string; type?: string };
};

/** Texto completo só vale a pena guardar quando o feed traz o artigo inteiro. */
const MIN_PALAVRAS_TEXTO = 300;

const parser: Parser<{}, Item> = new Parser({
  timeout: 15_000,
  headers: { 'User-Agent': 'feed-inteligente/1.0 (leitor pessoal de RSS)' },
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
    ],
  },
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

type Feed = Awaited<ReturnType<typeof parser.parseURL>>;

/** Codificação do feed: cabeçalho HTTP, senão a declaração do XML, senão UTF-8. */
export function codificacao(contentType: string | null, inicio: Uint8Array): string {
  const http = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  const xml = new TextDecoder('latin1').decode(inicio.subarray(0, 200)).match(/<\?xml[^>]*encoding=["']([\w-]+)/i)?.[1];
  const nome = (http || xml || 'utf-8').toLowerCase();
  try { new TextDecoder(nome); return nome; } catch { return 'utf-8'; }
}
/**
 * Baixa e lê o feed respeitando a codificação. O parseURL do rss-parser trata tudo como UTF-8,
 * o que estraga os acentos de feeds em ISO-8859-1 (ex.: Inovação Tecnológica).
 */
async function baixarFeed(url: string): Promise<Feed> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'feed-inteligente/1.0 (leitor pessoal de RSS)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`Status code ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder(codificacao(r.headers.get('content-type'), bytes)).decode(bytes);
  return parser.parseString(texto);
}

/** Devolve quantos artigos novos entraram, ou -1 se o feed falhou. */
async function ingestSource(src: Source, topics: TopicProto[], feed: Feed | Error): Promise<number> {
  if (feed instanceof Error) {
    const fails = src.fail_count + 1;
    const active = fails < MAX_FEED_FAILS;
    await pool.query('update sources set fail_count = $2, active = $3 where id = $1', [src.id, fails, active]);
    console.warn(`✗ ${src.name}: ${feed.message}${active ? '' : ' → fonte desativada'}`);
    return -1;
  }
  await pool.query('update sources set fail_count = 0, last_ok_at = now() where id = $1', [src.id]);

  const minDate = Date.now() - MAX_ARTICLE_AGE_DAYS * 86_400_000;
  const candidates = feed.items
    .filter((it) => it.title && it.link)
    .map((it) => {
      const html = it.contentEncoded || it.content || it.summary || it.contentSnippet || '';
      const text = stripHtml(html);
      const words = wordCount(text);
      const published = new Date(it.isoDate || it.pubDate || Date.now());
      let title = stripHtml(it.title!);
      // Google Notícias acrescenta " - Veículo" ao título
      if (/news\.google\.com/.test(src.feed_url)) title = title.replace(/\s+-\s+[^-]+$/, '');
      return {
        url: normalizeUrl(it.link!),
        title,
        text,
        words,
        image: pickImage(it, html),
        content: words >= MIN_PALAVRAS_TEXTO ? htmlToParagraphs(html).slice(0, 40_000) : null,
        published: isNaN(published.getTime()) ? new Date() : published,
      };
    })
    .filter((a) => a.published.getTime() > minDate)
    .filter((a) => !isSponsored(a.title, a.text))
    .map((a) => ({ ...a, clickbait: clickbaitScore(a.title) }))
    .filter((a) => a.clickbait <= CLICKBAIT_MAX);

  if (candidates.length === 0) return 0;

  // Pula URLs já coletadas
  const { rows: existing } = await pool.query<{ url: string; quebrado: boolean }>(
    `select url, strpos(title || coalesce(summary, ''), chr(65533)) > 0 as quebrado from articles where url = any($1)`,
    [candidates.map((c) => c.url)],
  );
  const seen = new Set(existing.map((r) => r.url));

  // Conserta textos guardados com acentos estragados (�) quando o feed agora vem certo
  const quebrados = new Set(existing.filter((r) => r.quebrado).map((r) => r.url));
  const reparar = candidates.filter((c) => quebrados.has(c.url) && !(c.title + c.text).includes('\uFFFD'));
  if (reparar.length) {
    const rv = await embed(reparar.map((a) => `${a.title}. ${a.text.slice(0, 1000)}`), 'passage');
    for (let i = 0; i < reparar.length; i++) {
      const a = reparar[i];
      const { topic, confidence } = classify(rv[i], topics, src.default_topic);
      await pool.query(
        `update articles set title = $2, summary = $3, word_count = $4, content = $5, embedding = $6, topic = $7, topic_confidence = $8,
                audio = null, audio_voz = null
          where url = $1`,
        [a.url, a.title, a.text.slice(0, 600), a.words, a.content, toVec(rv[i]), topic, confidence],
      );
    }
    console.log(`↻ ${src.name}: ${reparar.length} textos com acentos corrigidos`);
  }

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
                             clickbait, depth, cluster_id, embedding, image_url, content)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (url) do nothing
       returning id`,
      [
        src.id, a.url, a.title, a.text.slice(0, 600), a.words, a.published, topic, confidence,
        a.clickbait, depthScore(a.words, src.longform), dup[0]?.cid ?? null, toVec(vec), a.image, a.content,
      ],
    );
    if (rows[0] && !dup[0]) await pool.query('update articles set cluster_id = id where id = $1', [rows[0].id]);
    if (rows[0]) inserted++;
  }
  return inserted;
}

export interface IngestStats { novos: number; fontes: number; falhas: string[] }

export async function ingestAll(): Promise<IngestStats> {
  const { rows } = await pool.query('select slug, prototype from topics where prototype is not null');
  const topics: TopicProto[] = rows.map((r) => ({ slug: r.slug, prototype: fromVec(r.prototype) }));
  if (topics.length === 0) throw new Error('Temas sem protótipo. Rode "npm run setup" primeiro.');

  const { rows: sources } = await pool.query<Source>(
    'select id, name, feed_url, default_topic, longform, fail_count from sources where active order by id',
  );

  const stats: IngestStats = { novos: 0, fontes: sources.length, falhas: [] };
  // Baixa todos os feeds em paralelo; o processamento (embedding) roda em sequência
  const feeds = new Map<number, Promise<Feed | Error>>();
  for (const src of sources) feeds.set(src.id, baixarFeed(src.feed_url).catch((e: Error) => e));
  for (const src of sources) {
    const n = await ingestSource(src, topics, await feeds.get(src.id)!);
    if (n < 0) stats.falhas.push(src.name);
    else {
      if (n) console.log(`✓ ${src.name}: ${n} novos`);
      stats.novos += n;
    }
  }
  return stats;
}

runIfMain(import.meta.url, async () => {
  const s = await ingestAll();
  console.log(`Coleta concluída: ${s.novos} artigos novos de ${s.fontes} fontes (${s.falhas.length} com falha).`);
});
