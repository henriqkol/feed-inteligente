// Narração com vozes neurais (Edge TTS, gratuito). Roda dentro do job:
//   1. gera um MP3 para cada notícia da edição atual que ainda não tem áudio na voz escolhida;
//   2. envia para o bucket "audios" pela função "audio" (chave guardada só no servidor);
//   3. apaga os áudios de edições antigas.
// Sem Python/edge-tts instalado (ex.: testes locais), simplesmente não faz nada.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from './db.js';
import { runIfMain } from './cli.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ksypzmgnrtzamslcefbu.supabase.co';
const FUNCAO = `${SUPABASE_URL}/functions/v1/audio`;
const VOZ_PT = 'pt-BR-FranciscaNeural';
const VOZ_EN = 'en-US-AvaMultilingualNeural';
const MAX_TEXTO = 9000;        // ~6 min de fala por notícia
const MAX_TEXTO_LONGA = 20000; // leitura longa do dia
const SCRIPT = join(process.cwd(), 'scripts', 'tts.py');

const nomeArquivo = (id: number, voz: string) => `${id}-${voz.toLowerCase()}.mp3`;
const nomeAmostra = (voz: string) => `amostras/${voz.toLowerCase()}.mp3`;

function python(args: string[]): string | null {
  const r = spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 12 * 60_000 });
  if (r.status !== 0) {
    if (r.stderr && !/No module named 'edge_tts'/.test(r.stderr)) console.warn('✗ tts.py:', r.stderr.slice(-500));
    return null;
  }
  return r.stdout;
}

/** Texto narrado: título, fonte e o corpo (texto completo quando há, senão o resumo). */
export function textoNarracao(a: { title: string; source: string; lang: string; content: string | null; summary: string | null }, longa: boolean): string {
  const corpo = (a.content || a.summary || '').replace(/\s+\n/g, '\n').trim();
  const de = a.lang === 'pt' ? 'De' : 'From';
  const limite = longa ? MAX_TEXTO_LONGA : MAX_TEXTO;
  let texto = `${a.title}.\n${de} ${a.source}.\n\n${corpo}`;
  if (texto.length > limite) {
    const corte = texto.lastIndexOf('. ', limite);
    texto = texto.slice(0, corte > limite * 0.6 ? corte + 1 : limite) +
      (a.lang === 'pt' ? '\n\nO texto continua no site.' : '\n\nThe article continues on the website.');
  }
  return texto;
}

async function enviar(chave: string, nome: string, arquivo: string) {
  const r = await fetch(`${FUNCAO}/enviar?nome=${encodeURIComponent(nome)}`, {
    method: 'POST',
    headers: { 'x-chave': chave, 'Content-Type': 'audio/mpeg' },
    body: readFileSync(arquivo),
  });
  if (!r.ok) throw new Error(`envio ${nome}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function preferencia(chave: string, padrao: string): Promise<string> {
  const { rows } = await pool.query(`select valor #>> '{}' as v from preferencias where chave = $1`, [chave]);
  return rows[0]?.v || padrao;
}

export async function generateAudio(): Promise<Record<string, unknown> | null> {
  const { rows: seg } = await pool.query(`select valor from app_segredos where chave = 'audio_chave'`);
  const chave: string | undefined = seg[0]?.valor;
  if (!chave) return null;

  // Lista de vozes disponíveis (atualizada 1x por dia) e amostras para escolher no app
  const { rows: lista } = await pool.query(`select valor from preferencias where chave = 'vozes_neurais'`);
  let vozes: { nome: string; idioma: string; genero: string }[] = lista[0]?.valor ?? [];
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  if (!vozes.length || hora === 3) {
    const out = python(['vozes']);
    if (out === null) return null; // edge-tts indisponível
    vozes = JSON.parse(out);
    await pool.query(
      `insert into preferencias (chave, valor) values ('vozes_neurais', $1) on conflict (chave) do update set valor = excluded.valor`,
      [JSON.stringify(vozes)],
    );
  }
  const existe = (v: string) => vozes.some((x) => x.nome === v);
  const vozPt = existe(await preferencia('voz_neural_pt', VOZ_PT)) ? await preferencia('voz_neural_pt', VOZ_PT) : VOZ_PT;
  const vozEn = existe(await preferencia('voz_neural_en', VOZ_EN)) ? await preferencia('voz_neural_en', VOZ_EN) : VOZ_EN;

  const { rows: itens } = await pool.query(
    `select a.id, a.title, a.summary, a.content, a.audio, a.audio_voz, s.name as source, s.lang, f.reason
       from feed f join articles a on a.id = f.article_id join sources s on s.id = a.source_id
      where f.day = (select max(day) from feed)
      order by f.position`,
  );
  const { rows: amostrasFeitas } = await pool.query(`select valor from preferencias where chave = 'amostras_feitas'`);
  const feitas = new Set<string>(amostrasFeitas[0]?.valor ?? []);

  const dir = mkdtempSync(join(tmpdir(), 'tts-'));
  try {
    type Tarefa = { texto: string; voz: string; arquivo: string; nome: string; id?: number };
    const tarefas: Tarefa[] = [];
    for (const it of itens) {
      const voz = it.lang === 'pt' ? vozPt : vozEn;
      if (it.audio && it.audio_voz === voz) continue;
      const nome = nomeArquivo(Number(it.id), voz);
      tarefas.push({ texto: textoNarracao(it, it.reason === 'longa'), voz, nome, arquivo: join(dir, nome), id: Number(it.id) });
    }
    // Amostras: todas as vozes pt-BR e as en-US/en-GB (uma vez por voz)
    for (const v of vozes) {
      if (feitas.has(v.nome)) continue;
      const pt = v.idioma === 'pt-BR';
      tarefas.push({
        texto: pt ? 'Olá! Esta é a voz que vai ler as suas notícias. Ela está boa para você?'
                  : 'Hello! This is the voice that will read your news. Does it sound good to you?',
        voz: v.nome, nome: nomeAmostra(v.nome), arquivo: join(dir, nomeAmostra(v.nome).replace('/', '_')),
      });
    }
    if (!tarefas.length) return { gerados: 0 };

    const manifesto = join(dir, 'tarefas.json');
    writeFileSync(manifesto, JSON.stringify(tarefas));
    const out = python(['gerar', manifesto]);
    if (out === null) return { erro: 'edge-tts falhou' };
    const res: { arquivo: string; ok: boolean; erro?: string }[] = JSON.parse(out);
    const okArq = new Set(res.filter((r) => r.ok).map((r) => r.arquivo));

    let gerados = 0, amostras = 0;
    const falhas: string[] = [];
    for (const t of tarefas) {
      if (!okArq.has(t.arquivo)) { falhas.push(t.nome); continue; }
      try {
        await enviar(chave, t.nome, t.arquivo);
        if (t.id) {
          await pool.query('update articles set audio = $2, audio_voz = $3 where id = $1', [t.id, t.nome, t.voz]);
          gerados++;
        } else { feitas.add(t.voz); amostras++; }
      } catch (e) { falhas.push(`${t.nome}: ${(e as Error).message}`); }
    }
    if (amostras) {
      await pool.query(
        `insert into preferencias (chave, valor) values ('amostras_feitas', $1) on conflict (chave) do update set valor = excluded.valor`,
        [JSON.stringify([...feitas])],
      );
    }

    // Limpeza: mantém só os áudios das notícias das duas últimas edições
    const { rows: manter } = await pool.query(
      `select distinct a.audio from feed f join articles a on a.id = f.article_id
        where f.day >= (select max(day) from feed) - 1 and a.audio is not null`,
    );
    const nomes = manter.map((m) => m.audio as string);
    const r = await fetch(`${FUNCAO}/limpar`, {
      method: 'POST', headers: { 'x-chave': chave, 'Content-Type': 'application/json' }, body: JSON.stringify({ manter: nomes }),
    });
    if (r.ok) await pool.query('update articles set audio = null, audio_voz = null where audio is not null and not (audio = any($1))', [nomes]);

    return { gerados, amostras, falhas: falhas.slice(0, 10), voz_pt: vozPt, voz_en: vozEn };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runIfMain(import.meta.url, async () => console.log(await generateAudio()));
