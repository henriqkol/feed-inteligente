// Boletim em áudio da edição.
//   1. Com o token da assinatura (CLAUDE_CODE_OAUTH_TOKEN), pede ao Claude (`claude -p`) um roteiro
//      em português, estilo podcast de notícias, que resume e traduz as notícias da edição.
//   2. Sem token ou se o Claude falhar, monta um boletim simples (manchete + primeira frase, por tema).
//   3. A voz neural (Edge TTS) lê o roteiro e o MP3 vai para o bucket "audios".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from './db.js';
import { runIfMain } from './cli.js';
import { enviar, preferencia, python, VOZ_PT } from './audio.js';

export interface Bloco { tema: string; texto: string; ids: number[] }
export interface Roteiro { titulo: string; blocos: Bloco[] }
interface Item {
  id: number; title: string; source: string; lang: string; topic_label: string; reason: string;
  summary: string | null; content: string | null;
}

const MODELO = process.env.BOLETIM_MODELO ?? 'sonnet';
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function agoraBrasilia() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return { hora: d.getHours(), semana: DIAS[d.getDay()], dia: d.getDate(), mes: d.toLocaleString('pt-BR', { month: 'long' }) };
}

const primeiraFrase = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim();
  const m = s.match(/^.{40,280}?[.!?](\s|$)/);
  return (m ? m[0] : s.slice(0, 220)).trim();
};

/** Material enviado ao Claude: título, fonte, tema e o começo do texto de cada notícia. */
export function montarEntrada(itens: Item[]): string {
  return itens.map((it) => {
    const corpo = (it.content || it.summary || '').replace(/\s+/g, ' ').trim().slice(0, it.reason === 'longa' ? 2500 : 900);
    return [
      `[id ${it.id}] ${it.reason === 'longa' ? '(LEITURA LONGA DO DIA) ' : ''}${it.title}`,
      `Fonte: ${it.source} · Tema: ${it.topic_label} · Idioma: ${it.lang}`,
      corpo,
    ].join('\n');
  }).join('\n\n---\n\n');
}

export function promptBoletim(itens: Item[]): string {
  const { hora, semana, dia, mes } = agoraBrasilia();
  const periodo = hora < 12 ? 'manhã' : 'tarde';
  return `Você é o apresentador de um boletim de notícias em áudio, feito para uma única pessoa: Henrique,
profissional de TI no Brasil, interessado em tecnologia, negócios, finanças e investimentos, política,
geopolítica, ciência, natureza, projetos sociais, literatura, artes e música.

Escreva o roteiro do boletim da ${periodo} de ${semana}, ${dia} de ${mes}, a partir das ${itens.length} notícias abaixo.

Regras:
- Português do Brasil, tom de podcast de notícias: claro, próximo e inteligente, sem sensacionalismo.
- Traduza e resuma o que estiver em inglês. Não leia títulos em inglês.
- Agrupe por tema em blocos. Junte notícias relacionadas e explique, em uma frase, por que importam.
- Não precisa citar todas: priorize as mais relevantes e pule as menores, mas mencione cada tema da edição.
- Cite as fontes de forma natural ("segundo a Reuters", "conta a Folha").
- Use apenas as informações do material. Não invente fatos, números, nomes ou datas.
- O texto será lido por uma voz sintética: sem markdown, listas, emojis, links ou siglas obscuras;
  escreva números e símbolos como se falam quando ajudar (ex.: "15 por cento").
- Comece com uma saudação curta e o resumo do dia em uma frase. Termine recomendando a leitura longa
  do dia e com uma despedida curta.
- Duração: entre 6 e 9 minutos de fala (cerca de 900 a 1.300 palavras no total).

Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{"titulo": "título curto do boletim", "blocos": [{"tema": "nome do bloco", "texto": "texto falado do bloco", "ids": [ids das notícias citadas]}]}

Notícias da edição:

${montarEntrada(itens)}`;
}

/** Extrai o JSON da resposta do Claude (tolera cercas de código e texto ao redor). */
export function lerRoteiro(resposta: string, idsValidos: Set<number>): Roteiro | null {
  const ini = resposta.indexOf('{'), fim = resposta.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const j = JSON.parse(resposta.slice(ini, fim + 1));
    if (typeof j.titulo !== 'string' || !Array.isArray(j.blocos) || !j.blocos.length) return null;
    const blocos: Bloco[] = j.blocos
      .filter((b: any) => typeof b?.texto === 'string' && b.texto.trim().length > 20)
      .map((b: any) => ({
        tema: String(b.tema ?? '').slice(0, 80),
        texto: String(b.texto).replace(/[*#_`]/g, '').trim(),
        ids: Array.isArray(b.ids) ? b.ids.map(Number).filter((n: number) => idsValidos.has(n)) : [],
      }));
    const palavras = blocos.reduce((s, b) => s + b.texto.split(/\s+/).length, 0);
    if (palavras < 250) return null; // resposta curta demais: algo deu errado
    return { titulo: j.titulo.slice(0, 120), blocos };
  } catch { return null; }
}

function chamarClaude(prompt: string): { texto: string | null; erro?: string } {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) return { texto: null, erro: 'sem token' };
  const r = spawnSync('claude', ['-p', '--output-format', 'json', '--model', MODELO, '--max-turns', '1'], {
    input: prompt, encoding: 'utf8', timeout: 6 * 60_000, maxBuffer: 10 * 1024 * 1024,
    cwd: tmpdir(), // fora do repositório: o Claude não carrega arquivos do projeto
  });
  if (r.error) return { texto: null, erro: r.error.message };
  try {
    const j = JSON.parse(r.stdout);
    if (j.is_error) return { texto: null, erro: String(j.result ?? j.subtype).slice(0, 300) };
    return { texto: String(j.result ?? '') };
  } catch {
    return { texto: null, erro: (r.stderr || r.stdout || `saída ${r.status}`).slice(-300) };
  }
}

/** Boletim sem IA: por tema, manchete e primeira frase (em inglês fica só a manchete, lida em inglês pela voz pt). */
export function boletimSimples(itens: Item[]): Roteiro {
  const { hora, semana } = agoraBrasilia();
  const porTema = new Map<string, Item[]>();
  for (const it of itens) if (it.reason !== 'longa') porTema.set(it.topic_label, [...(porTema.get(it.topic_label) ?? []), it]);
  const blocos: Bloco[] = [{
    tema: 'Abertura',
    texto: `${hora < 12 ? 'Bom dia' : 'Boa tarde'}, Henrique. Estas são as principais notícias desta ${semana}.`,
    ids: [],
  }];
  for (const [tema, lista] of porTema) {
    const partes = lista.slice(0, 4).map((it) =>
      it.lang === 'pt' && it.summary ? `${it.title}. ${primeiraFrase(it.summary)}` : `${it.title}, segundo ${it.source}.`);
    blocos.push({ tema, texto: `Em ${tema.toLowerCase()}. ${partes.join(' ')}`, ids: lista.slice(0, 4).map((i) => i.id) });
  }
  const longa = itens.find((i) => i.reason === 'longa');
  blocos.push({
    tema: 'Encerramento',
    texto: `${longa ? `A leitura longa de hoje é: ${longa.title}, de ${longa.source}. ` : ''}Até a próxima edição.`,
    ids: longa ? [longa.id] : [],
  });
  return { titulo: `Boletim da ${hora < 12 ? 'manhã' : 'tarde'}`, blocos };
}

export async function generateBulletin(): Promise<Record<string, unknown> | null> {
  const { rows: tabela } = await pool.query(`select to_regclass('public.boletins') is not null as existe`);
  if (!tabela[0].existe) return null; // migração do boletim ainda não aplicada
  const { rows: itens } = await pool.query<Item>(
    `select a.id::int as id, a.title, s.name as source, s.lang, t.label as topic_label, f.reason, a.summary, a.content
       from feed f join articles a on a.id = f.article_id join sources s on s.id = a.source_id join topics t on t.slug = a.topic
      where f.day = (select max(day) from feed) order by f.position`,
  );
  if (itens.length < 5) return null;
  const { rows: dia } = await pool.query(`select max(day)::text as d from feed`);
  const assinatura = createHash('sha1').update(itens.map((i) => i.id).join(',')).digest('hex').slice(0, 16);
  const temToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);

  // Já existe para esta edição? Refaz só se foi o simples, há token e a última tentativa tem mais de 1 hora.
  const { rows: existente } = await pool.query(
    `select id, origem, audio, criado_em, (detalhes->>'tentativa_claude')::timestamptz as tentativa
       from boletins where assinatura = $1 order by id desc limit 1`, [assinatura],
  );
  const atual = existente[0];
  const tentarClaude = temToken && (!atual || (atual.origem === 'simples' &&
    (!atual.tentativa || Date.now() - new Date(atual.tentativa).getTime() > 3600_000)));
  if (atual && !tentarClaude && atual.audio) return null;

  let roteiro: Roteiro | null = null, origem: 'claude' | 'simples' = 'simples', erroClaude: string | undefined;
  if (tentarClaude) {
    const t0 = Date.now();
    const r = chamarClaude(promptBoletim(itens));
    roteiro = r.texto ? lerRoteiro(r.texto, new Set(itens.map((i) => i.id))) : null;
    if (roteiro) origem = 'claude';
    else erroClaude = r.erro ?? 'resposta fora do formato';
    console.log(roteiro ? `✓ Roteiro do Claude em ${Math.round((Date.now() - t0) / 1000)}s` : `✗ Claude: ${erroClaude}`);
  }
  if (!roteiro) {
    if (atual) {
      // Mantém o boletim simples que já existe; só registra a tentativa e gera o áudio se faltar
      if (tentarClaude) await pool.query(`update boletins set detalhes = detalhes || jsonb_build_object('tentativa_claude', now(), 'erro_claude', $2::text) where id = $1`, [atual.id, erroClaude ?? '']);
      if (atual.audio) return { origem: 'simples', erro_claude: erroClaude };
    } else roteiro = boletimSimples(itens);
  }

  let id: number;
  if (roteiro) {
    const texto = roteiro.blocos.map((b) => b.texto).join('\n\n');
    const { rows } = await pool.query(
      `insert into boletins (dia, assinatura, origem, titulo, blocos, texto, detalhes)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [dia[0].d, assinatura, origem, roteiro.titulo, JSON.stringify(roteiro.blocos), texto,
        JSON.stringify(tentarClaude ? { tentativa_claude: new Date().toISOString(), erro_claude: erroClaude ?? null } : {})],
    );
    id = Number(rows[0].id);
    if (atual && origem === 'claude') await pool.query('delete from boletins where assinatura = $1 and id <> $2', [assinatura, id]);
  } else id = Number(atual.id);

  // Áudio com a voz neural em português
  const { rows: b } = await pool.query(`select texto from boletins where id = $1`, [id]);
  const { rows: seg } = await pool.query(`select valor from app_segredos where chave = 'audio_chave'`);
  if (!seg[0]) return { origem, id, audio: 'sem chave' };
  const voz = await preferencia('voz_neural_pt', VOZ_PT);
  const nome = `boletim-${id}-${voz.toLowerCase()}.mp3`;
  const dir = mkdtempSync(join(tmpdir(), 'boletim-'));
  try {
    const arquivo = join(dir, nome);
    const manifesto = join(dir, 'tarefas.json');
    writeFileSync(manifesto, JSON.stringify([{ texto: b[0].texto, voz, arquivo }]));
    const out = python(['gerar', manifesto]);
    if (!out || !JSON.parse(out)[0]?.ok) return { origem, id, audio: 'falhou', erro_claude: erroClaude };
    await enviar(seg[0].valor, nome, arquivo);
    const duracao = Math.round(statSync(arquivo).size / 6000); // MP3 do Edge: 48 kbit/s
    await pool.query('update boletins set audio = $2, audio_voz = $3, duracao_seg = $4 where id = $1', [id, nome, voz, duracao]);
    return { origem, id, minutos: Math.round(duracao / 6) / 10, erro_claude: erroClaude };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runIfMain(import.meta.url, async () => console.log(await generateBulletin()));
