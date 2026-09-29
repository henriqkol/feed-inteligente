// Teste do algoritmo com dados sintéticos (não precisa de banco nem de modelo).
import assert from 'node:assert/strict';
import { collapseClusters, pickLongRead, scoreCandidate, selectFeed, type Candidate, type Interest, type TopicRule } from '../src/ranking.js';
import { signalFor, updateVector } from '../src/learning.js';
import { clickbaitScore, htmlToParagraphs, pickImage } from '../src/quality.js';
import { dot, normalize } from '../src/math.js';

// RNG determinístico
let seed = 42;
const rng = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
const randVec = (d = 384) => normalize(Array.from({ length: d }, gauss));

// Imita a anisotropia do e5: todo vetor compartilha um componente comum
const common = randVec();
const mix = (dir: number[], noise: number) => {
  const n = randVec();
  return normalize(common.map((c, i) => 0.8 * c + 0.55 * dir[i] + noise * n[i]));
};

const topics = ['ti', 'tecnologia', 'negocios_tech', 'financas', 'politica', 'geopolitica', 'ciencia', 'curiosidades', 'natureza', 'social', 'literatura', 'artes', 'musica'];
const dirs = Object.fromEntries(topics.map((t) => [t, randVec()]));
const weights: Record<string, number> = { ti: 0.9, financas: 0.8, ciencia: 0.7, musica: 0.1 };

const interests: Interest[] = topics.map((t) => ({ topic: t, vector: mix(dirs[t], 0), weight: weights[t] ?? 0.5, alpha: 1, beta: 1 }));
const rules: TopicRule[] = topics.map((t) => ({ slug: t, maxShare: t === 'ti' ? 0.3 : 0.2 }));

const now = new Date('2026-09-28T12:00:00Z');
let id = 1;
const cands: Candidate[] = [];
for (const t of topics) {
  for (let k = 0; k < 15; k++) {
    const cid = id;
    cands.push({
      id: id++, clusterId: cid, sourceName: `Fonte ${k % 5}`, reputation: 0.7 + 0.05 * (k % 5), topic: t,
      embedding: mix(dirs[t], 0.35), publishedAt: new Date(now.getTime() - k * 3 * 3_600_000),
      depth: k % 3 === 0 ? 0.8 : 0.3, title: `${t} #${k}`, url: `https://x/${id}`, tauHours: t === 'politica' ? 18 : 72,
    });
  }
}
// Mesma notícia em duas fontes (cluster 1)
cands.push({ ...cands[0], id: id++, sourceName: 'Fonte Menor', reputation: 0.5 });

const scored = collapseClusters(cands.map((c) => scoreCandidate(c, interests, now)));
assert.equal(scored.length, cands.length - 1, 'cluster duplicado deve virar um item');
const dedup = scored.find((s) => s.clusterId === 1)!;
assert.equal(dedup.sourceName, 'Fonte 0');
assert.deepEqual(dedup.alsoCoveredBy, ['Fonte Menor']);

const feed = selectFeed(scored, interests, rules, { size: 30, underexposedTopics: ['literatura'], rng });

assert.equal(feed.length, 30, 'feed com 30 itens');
assert.equal(new Set(feed.map((f) => f.item.id)).size, 30, 'sem itens repetidos');

const perTopic = new Map<string, number>();
for (const f of feed) perTopic.set(f.item.topic, (perTopic.get(f.item.topic) ?? 0) + 1);
for (const r of rules) assert.ok((perTopic.get(r.slug) ?? 0) <= Math.ceil(r.maxShare * 30), `cota de ${r.slug} respeitada`);

assert.ok(feed.some((f) => f.reason === 'quota' && f.item.topic === 'literatura'), 'tema sub-exposto entra por cota');
const exploreIdx = feed.flatMap((f, i) => (f.reason === 'exploration' ? [i] : []));
assert.equal(exploreIdx.length, 4, '12% de exploração');
assert.ok(exploreIdx[0] < 20, 'exploração intercalada, não no fim');
assert.ok((perTopic.get('ti') ?? 0) > (perTopic.get('musica') ?? 0), 'tema com mais afinidade aparece mais');

// Aprendizado
const v = interests[0].vector;
const a = mix(dirs.ti, 0.35);
assert.ok(dot(updateVector(v, a, 1), a) > dot(v, a), 'sinal positivo aproxima');
assert.ok(dot(updateVector(v, a, -1.5), a) < dot(v, a), 'sinal negativo afasta');
assert.equal(signalFor('read', 5_000, 800), -0.5, 'leitura < 10s é rejeição');
assert.ok(signalFor('read', 240_000, 800) > 1, 'leitura completa é sinal forte');

// Clickbait
assert.ok(clickbaitScore('Você não vai acreditar no que aconteceu depois!!') > 0.6);
assert.ok(clickbaitScore('Banco Central mantém Selic e sinaliza cautela com inflação de serviços') < 0.2);

// Leitura longa: fora do feed, de outro cluster, com profundidade alta
const longa = pickLongRead(scored, feed);
assert.ok(longa, 'há leitura longa');
assert.ok(!feed.some((f) => f.item.id === longa!.id || f.item.clusterId === longa!.clusterId), 'leitura longa não repete o feed');
assert.ok(longa!.depth >= 0.75);

// Texto em parágrafos e imagem de capa
assert.equal(htmlToParagraphs('<p>Um &amp; dois</p><p>Três<br>quatro</p><script>x()</script>'), 'Um & dois\n\nTrês\nquatro');
assert.equal(pickImage({ mediaContent: [{ $: { url: 'https://img.x/a.jpg', medium: 'image' } }] }, ''), 'https://img.x/a.jpg');
assert.equal(pickImage({}, '<p><img src="https://x.com/pixel.gif"><img src="https://x.com/foto.jpg?w=800&amp;h=400"></p>'), 'https://x.com/foto.jpg?w=800&h=400', 'pula pixel de rastreamento');
assert.equal(pickImage({ enclosure: { url: 'http://inseguro/a.jpg', type: 'image/jpeg' } }, ''), null, 'só https');

console.log('Distribuição do feed:', Object.fromEntries([...perTopic].sort((x, y) => y[1] - x[1])));
console.log('Posições de exploração:', exploreIdx.map((i) => i + 1).join(', '));
console.log('✓ Todos os testes passaram.');
