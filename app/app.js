// Feed Inteligente — app (PWA). Sem build: módulos ES direto no navegador.
// Lê o feed montado pelo job (GitHub Actions) e registra o que você faz; o job aprende com isso a cada hora.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY, VERSAO } from "./config.js";

const HASH_INICIAL = location.hash;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ------------------------------------------------------------------ utilidades
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const abas = $("#abas");
const folha = $("#folha");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function haQuanto(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}
function dataHora(iso) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function hojeLongo(d = new Date()) {
  return maiuscula(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
}
function minutosLeitura(palavras) {
  // O RSS muitas vezes traz só o resumo; só mostra o tempo quando há texto de verdade.
  return palavras >= 300 ? `${Math.max(1, Math.round(palavras / 230))} min de leitura` : "";
}

const CORES = {
  ti: "#2f6fdb", tecnologia: "#0e8fa6", negocios_tech: "#5b5bd6", financas: "#1a9466", politica: "#c2410c",
  geopolitica: "#a16207", ciencia: "#7c3aed", curiosidades: "#d97706", natureza: "#15803d", social: "#db2777",
  literatura: "#9f1239", artes: "#0284c7", musica: "#e11d48",
};
const chipTema = (slug, rotulo) => `<span class="chip"><span class="ponto" style="background:${CORES[slug] ?? "#888"}"></span>${esc(rotulo)}</span>`;

const ICONES = {
  salvar: `<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`,
  aprendi: `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>`,
  menos: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`,
  atualizar: `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>`,
  remover: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  chama: `<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.6 2.3 2.8C10.5 9 11 6 12 3z"/></svg>`,
  livro: `<svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>`,
  comparar: `<svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h16M4 18h7M17 3v6M20 15v6"/></svg>`,
  sino: `<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>`,
  ouvir: `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`,
  pausar: `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`,
  tocar: `<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>`,
  proxima: `<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7zM19 5v14"/></svg>`,
  fechar: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};

/** Data local (Brasília no celular) no formato AAAA-MM-DD. */
const diaISO = (d = new Date()) => d.toLocaleDateString("sv-SE");
const somaDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return diaISO(d); };

// Perguntas de reflexão (sem IA): uma por tema, para fixar o que foi aprendido.
const PERGUNTAS = {
  ti: "Como isso poderia mudar alguma decisão no seu trabalho?",
  tecnologia: "Quem ganha e quem perde com essa mudança?",
  negocios_tech: "Que empresa (talvez a sua) poderia aplicar isso amanhã?",
  financas: "Isso muda alguma decisão sua sobre dinheiro ou investimentos?",
  politica: "Qual é o melhor argumento do lado com que você não concorda?",
  geopolitica: "Como isso pode afetar o Brasil nos próximos anos?",
  ciencia: "Como você explicaria isso para uma criança de 10 anos?",
  curiosidades: "Para quem você contaria isso hoje, e como?",
  natureza: "O que isso muda na forma como você vê o lugar onde vive?",
  social: "Existe algo parecido que você poderia apoiar perto de você?",
  literatura: "Que livro isso te deu vontade de ler ou reler?",
  artes: "O que essa obra ou artista te fez pensar?",
  musica: "Que música ou disco você vai ouvir por causa disso?",
};

// ------------------------------------------------------------------ meta diária e sequência
/** Leituras (artigos distintos abertos) por dia. */
function leiturasPorDia(atividade) {
  const m = new Map();
  for (const a of atividade) {
    if (a.kind !== "open" && a.kind !== "read") continue;
    if (!m.has(a.dia)) m.set(a.dia, new Set());
    m.get(a.dia).add(a.article_id);
  }
  return new Map([...m].map(([d, ids]) => [d, ids.size]));
}
/** Sequência atual (hoje conta se a meta já foi batida) e recorde, em dias com a meta cumprida. */
function sequencias(porDia, meta) {
  const hoje = diaISO();
  let d = (porDia.get(hoje) ?? 0) >= meta ? hoje : somaDias(hoje, -1), atual = 0;
  while ((porDia.get(d) ?? 0) >= meta) { atual++; d = somaDias(d, -1); }
  const dias = [...porDia.keys()].sort();
  let recorde = 0, run = 0, anterior = null;
  for (const dia of dias) {
    if ((porDia.get(dia) ?? 0) < meta) { run = 0; anterior = dia; continue; }
    run = anterior && somaDias(anterior, 1) === dia && run > 0 ? run + 1 : 1;
    recorde = Math.max(recorde, run); anterior = dia;
  }
  return { atual, recorde: Math.max(recorde, atual) };
}
async function carregarAtividade() {
  const [ativ, prefs] = await Promise.all([
    q(sb.from("v_atividade").select("dia, kind, article_id, topic, topic_label, title, source, descoberta").gte("dia", somaDias(diaISO(), -120))).catch(() => []),
    q(sb.from("preferencias").select("chave, valor")).catch(() => []),
  ]);
  estado.atividade = ativ;
  estado.meta = Number(prefs.find((p) => p.chave === "meta_diaria")?.valor ?? 3) || 3;
}
function htmlMeta() {
  const porDia = leiturasPorDia(estado.atividade);
  const hoje = porDia.get(diaISO()) ?? 0;
  const { atual } = sequencias(porDia, estado.meta);
  const feito = hoje >= estado.meta;
  return `<div class="meta-dia ${feito ? "feito" : ""}">
    <div class="chama ${atual ? "acesa" : ""}" title="Dias seguidos batendo a meta">${ICONES.chama}<strong class="num">${atual}</strong></div>
    <div class="corpo"><div class="l1"><span>${feito ? "Meta de hoje cumprida" : "Meta de hoje"}</span><span class="num">${Math.min(hoje, estado.meta)} de ${estado.meta} leituras</span></div>
      <div class="trilho"><i style="width:${Math.min(100, (100 * hoje) / estado.meta)}%"></i></div>
      <div class="l3">${atual ? `${atual} ${atual > 1 ? "dias seguidos" : "dia"} batendo a meta` : "Leia hoje para começar uma sequência"}</div></div>
  </div>`;
}
/** Registra uma leitura localmente (sem esperar o banco) e comemora quando a meta é batida. */
function contarLeitura(id) {
  const antes = leiturasPorDia(estado.atividade).get(diaISO()) ?? 0;
  const f = estado.feed.find((x) => x.id === id);
  estado.atividade.push({ dia: diaISO(), kind: "open", article_id: id, topic: f?.topic, topic_label: f?.topic_label, title: f?.title, descoberta: f?.reason === "exploration" });
  const depois = leiturasPorDia(estado.atividade).get(diaISO()) ?? 0;
  const el = $("#metaDia");
  if (el) el.innerHTML = htmlMeta();
  if (antes < estado.meta && depois >= estado.meta) {
    const { atual } = sequencias(leiturasPorDia(estado.atividade), estado.meta);
    setTimeout(() => avisar(`Meta do dia cumprida! ${atual} ${atual > 1 ? "dias seguidos" : "dia"}.`), 400);
  }
}

let timerAviso;
/** Mensagem rápida no rodapé; opcionalmente com um botão (ex.: Desfazer). */
function avisar(msg, { erro = false, botao, acao } = {}) {
  const el = $("#aviso");
  el.innerHTML = `<span>${esc(msg)}</span>${botao ? `<button type="button">${esc(botao)}</button>` : ""}`;
  el.className = erro ? "erro" : "";
  el.hidden = false;
  if (botao) el.querySelector("button").onclick = () => { el.hidden = true; acao?.(); };
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.hidden = true), erro ? 6000 : botao ? 6000 : 3000);
}

// ------------------------------------------------------------------ dados guardados no aparelho (offline)
// Toda leitura bem-sucedida fica no IndexedDB. Sem internet, o app mostra a última cópia.
const ehErroDeRede = (msg) => !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(String(msg ?? ""));
let bancoLocal = null;
function abrirBancoLocal() {
  if (!bancoLocal) {
    bancoLocal = new Promise((ok, falha) => {
      const r = indexedDB.open("feed-cache", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("consultas");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => falha(r.error);
    }).catch(() => null);
  }
  return bancoLocal;
}
async function guardarLocal(chave, dados) {
  try {
    const db = await abrirBancoLocal(); if (!db) return;
    db.transaction("consultas", "readwrite").objectStore("consultas").put({ em: Date.now(), dados }, chave);
  } catch { /* sem espaço ou modo privado */ }
}
async function lerLocal(chave) {
  try {
    const db = await abrirBancoLocal(); if (!db) return null;
    return await new Promise((ok) => {
      const r = db.transaction("consultas").objectStore("consultas").get(chave);
      r.onsuccess = () => ok(r.result ?? null);
      r.onerror = () => ok(null);
    });
  } catch { return null; }
}
async function apagarLocal() {
  try { const db = await abrirBancoLocal(); if (db) db.transaction("consultas", "readwrite").objectStore("consultas").clear(); } catch { /* ok */ }
}
function marcarOffline(em) {
  const el = $("#offline");
  const d = new Date(em);
  el.textContent = `Sem internet · mostrando o que foi salvo em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  el.hidden = false;
}
window.addEventListener("online", () => { if (!$("#offline").hidden) { $("#offline").hidden = true; recarregar(); } });

/** Executa uma consulta do Supabase. Leituras (GET) ficam guardadas para uso offline. */
async function q(consulta) {
  const leitura = consulta?.method === "GET" && consulta?.url;
  const chave = leitura ? "q:" + consulta.url.toString() : null;
  if (!navigator.onLine) {
    const c = chave ? await lerLocal(chave) : null;
    if (c) { marcarOffline(c.em); return c.dados; }
    throw new Error(chave ? "Sem internet e esta tela ainda não foi aberta neste aparelho" : "Sem internet: tente de novo quando a conexão voltar");
  }
  const { data, error } = await consulta;
  if (error) {
    if (ehErroDeRede(error.message)) {
      const c = chave ? await lerLocal(chave) : null;
      if (c) { marcarOffline(c.em); return c.dados; }
      throw new Error("Sem internet: tente de novo quando a conexão voltar");
    }
    throw new Error(error.message);
  }
  if (chave) guardarLocal(chave, data);
  return data;
}

// ------------------------------------------------------------------ estado e navegação
const estado = {
  aba: "hoje",
  filtro: "tudo",       // Hoje: tudo | concluidas | <slug do tema>
  filtroSalvos: "todos", // todos | aprendi | revisar
  feed: [],
  eventos: {},          // "id:tipo" → id do evento (para desfazer antes do job processar)
  lendo: null,          // { id, inicio }
  leitor: null,         // { id, inicio } quando o texto está aberto dentro do app
  salvos: [],
  atividade: [],        // v_atividade (últimos 120 dias)
  meta: 3,              // leituras por dia
  email: null,
};

const acoes = {};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-acao]");
  if (el && acoes[el.dataset.acao]) { e.preventDefault(); acoes[el.dataset.acao](el, e); }
});
abas.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-aba]");
  if (b) irPara(b.dataset.aba);
});

const TELAS = () => ({ hoje: telaHoje, salvos: telaSalvos, interesses: telaInteresses, mais: telaMais });

async function irPara(aba) {
  if (!TELAS()[aba]) aba = "hoje";
  estado.aba = aba;
  history.replaceState(null, "", `#${aba}`);
  abas.querySelectorAll("button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  window.scrollTo(0, 0);
  try { await TELAS()[aba](); } catch (e) {
    const alvo = $("#conteudo") ?? app;
    alvo.innerHTML = /^Sem internet/.test(e.message)
      ? `<div class="vazio"><strong>Sem internet</strong>${esc(e.message)}.</div>`
      : `<div class="vazio"><strong>Algo deu errado</strong>${esc(e.message)}</div>`;
  }
}
function recarregar() { return irPara(estado.aba); }
acoes.recarregar = () => recarregar();

// Folha inferior (detalhes). O botão "voltar" do Android fecha a folha.
let folhaAberta = false;
function abrirFolha(html) {
  folha.innerHTML = `<div class="painel" role="dialog"><div class="alca"></div><button class="fechar" data-acao="fecharFolha" aria-label="Fechar">×</button>${html}</div>`;
  folha.hidden = false;
  if (!folhaAberta) { history.pushState({ folha: 1 }, ""); folhaAberta = true; }
}
function fecharFolha(viaHistorico = false) {
  if (!folhaAberta) return;
  if (estado.leitor) {
    const { id, inicio } = estado.leitor;
    estado.leitor = null;
    const dwell = Date.now() - inicio;
    if (dwell > 1500) registrar(id, "read", Math.min(dwell, 60 * 60 * 1000)).catch(() => {});
  }
  folhaAberta = false;
  folha.hidden = true;
  folha.innerHTML = "";
  if (!viaHistorico) history.back();
}
window.addEventListener("popstate", () => { if (folhaAberta) fecharFolha(true); });
folha.addEventListener("click", (e) => { if (e.target === folha) fecharFolha(); });
acoes.fecharFolha = () => fecharFolha();

const carregando = () => `<div class="carregando-tela"><div class="spinner"></div></div>`;

// ------------------------------------------------------------------ eventos (o que o job usa para aprender)
async function registrar(articleId, kind, dwellMs = null) {
  const r = await q(sb.from("events").insert({ article_id: articleId, kind, dwell_ms: dwellMs }).select("id").single());
  estado.eventos[`${articleId}:${kind}`] = r.id;
  return r.id;
}
/** Apaga o evento se o job ainda não o processou (senão não há o que desfazer: fica registrado). */
async function desfazer(articleId, kind) {
  const id = estado.eventos[`${articleId}:${kind}`];
  delete estado.eventos[`${articleId}:${kind}`];
  // Sem o id (ex.: marcado em outra sessão), apaga os eventos desse tipo que o job ainda não processou
  if (id) await sb.from("events").delete().eq("id", id);
  else await sb.from("events").delete().eq("article_id", articleId).eq("kind", kind).is("processed_at", null);
}

// Abrir uma notícia: registra "open" e, ao voltar para o app, o tempo de leitura ("read").
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-ler]");
  if (!a) return;
  const id = Number(a.dataset.ler);
  if (a.dataset.leitor === "1") { e.preventDefault(); abrirLeitor(id); return; }
  estado.lendo = { id, inicio: Date.now() };
  registrar(id, "open").catch(() => {});
  marcarLida(id);
});
const artigoConhecido = (id) => estado.feed.find((x) => x.id === id) ?? estado.salvos.find((x) => x.id === id);

// ------------------------------------------------------------------ leitor dentro do app
async function abrirLeitor(id) {
  const f = artigoConhecido(id);
  if (!f) return;
  abrirFolha(`<div class="leitor">${carregando()}</div>`);
  estado.leitor = { id, inicio: Date.now() };
  registrar(id, "open").catch(() => {});
  marcarLida(id);
  try {
    const [art] = await q(sb.from("articles").select("content").eq("id", id));
    const paragrafos = String(art?.content ?? f.summary ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const alvo = $("#folha .leitor");
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="meta">${chipTema(f.topic, f.topic_label)}<span class="fonte">${esc(f.source)}</span><span class="quando">${haQuanto(f.published_at)}</span></div>
      <h1>${esc(f.title)}</h1>
      ${f.image_url ? `<img class="capa-leitor" src="${esc(f.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <div class="texto">${paragrafos.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>
      <div class="botoes">${suportaVoz ? `<button class="botao cheio" data-acao="ouvir" data-id="${f.id}">${ICONES.ouvir}Ouvir</button>` : ""}<a class="botao sec cheio" href="${esc(f.url)}" target="_blank" rel="noopener">Abrir no site de ${esc(f.source)}</a></div>
      ${estado.feed.includes(f) ? `<div class="acoes">${botoesAcao(f)}</div>` : ""}`;
  } catch (e) {
    const alvo = $("#folha .leitor");
    if (alvo) alvo.innerHTML = `<div class="vazio"><strong>Não deu para abrir o texto</strong>${esc(e.message)}<div class="botoes" style="justify-content:center"><a class="botao" href="${esc(f.url)}" target="_blank" rel="noopener">Abrir no site</a></div></div>`;
  }
}

// ------------------------------------------------------------------ narração (voz do próprio celular, gratuita)
// Usa a síntese de voz do navegador (no Android, as vozes do Google instaladas no aparelho).
// O texto é falado em trechos curtos: o Chrome corta falas longas e assim dá para pausar e mudar a velocidade.
const suportaVoz = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const narrador = { fila: [], atual: null, trechos: [], i: 0, pausado: false, vel: 1, inicio: 0, token: 0, modo: null };
const VELOCIDADES = [1, 1.25, 1.5, 0.85];
if (suportaVoz) speechSynthesis.getVoices(); // começa a carregar as vozes (reserva quando não há áudio neural)

const grupoIdioma = (idioma) => (idioma === "pt" ? "pt" : "en");
const vozesDoIdioma = (grupo) => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(grupo));
/**
 * Voz escolhida em Mais → Voz da narração. Sem escolha, devolve null: aí só o idioma é informado
 * e o celular usa a voz configurada no sistema (Leitura de texto / conversão de texto em voz).
 */
function vozPara(idioma) {
  let nome = null;
  try { nome = localStorage.getItem("voz_" + grupoIdioma(idioma)); } catch { /* sem armazenamento */ }
  return nome ? vozesDoIdioma(grupoIdioma(idioma)).find((v) => v.name === nome) ?? null : null;
}
/** Quebra o texto em frases de até ~220 caracteres. */
function dividirTexto(texto) {
  const frases = texto.replace(/\s+/g, " ").split(/(?<=[.!?…:;])\s+/);
  const out = [];
  for (let f of frases) {
    while (f.length > 260) {
      const corte = Math.max(f.lastIndexOf(", ", 220), f.lastIndexOf(" ", 220), 120);
      out.push(f.slice(0, corte + 1)); f = f.slice(corte + 1).trim();
    }
    if (!f) continue;
    if (out.length && (out[out.length - 1] + " " + f).length <= 220) out[out.length - 1] += " " + f;
    else out.push(f);
  }
  return out;
}
async function textoParaNarrar(f) {
  let corpo = f.summary ?? "";
  if (f.tem_texto) {
    try { const [a] = await q(sb.from("articles").select("content").eq("id", f.id)); if (a?.content) corpo = a.content; } catch { /* usa o resumo */ }
  }
  const de = f.lang === "pt" ? "De" : "From";
  return `${f.title}. ${de} ${f.source}. ${corpo}`;
}
// ---- áudio neural pré-gerado pelo robô (Edge TTS). Toca com a tela bloqueada e aparece na tela de bloqueio.
const audioEl = new Audio();
audioEl.preload = "auto";
const urlAudio = (caminho) => `${SUPABASE_URL}/storage/v1/object/public/audios/${caminho}`;
audioEl.addEventListener("ended", () => { if (narrador.modo !== "audio") return; concluirItem(); proximaDaFila(); });
audioEl.addEventListener("timeupdate", () => { if (narrador.modo === "audio") atualizarBarra(); });
audioEl.addEventListener("pause", () => { if (narrador.modo === "audio" && !audioEl.ended && narrador.atual) { narrador.pausado = true; atualizarPlayer(); } });
audioEl.addEventListener("play", () => { if (narrador.modo === "audio") { narrador.pausado = false; atualizarPlayer(); } });
audioEl.addEventListener("error", () => {
  // Arquivo indisponível (ex.: limpeza): cai para a voz do celular
  const f = narrador.atual;
  if (narrador.modo === "audio" && f && audioEl.getAttribute("src")) { f.audio = null; tocarItem(f); }
});
function sessaoDeMidia(f) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: f.title, artist: f.source, album: "Feed Inteligente",
    artwork: [{ src: f.image_url || new URL("icons/icon-512.png", location.href).href, sizes: "512x512" }],
  });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => acoes.continuarNarracao());
  ms.setActionHandler("pause", () => acoes.pausarNarracao());
  ms.setActionHandler("nexttrack", () => narrador.fila.length && acoes.proximaNarracao());
  ms.setActionHandler("stop", () => pararNarracao());
  try { ms.setActionHandler("seekbackward", () => { audioEl.currentTime = Math.max(0, audioEl.currentTime - 15); }); } catch { /* ok */ }
  try { ms.setActionHandler("seekforward", () => { audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 15); }); } catch { /* ok */ }
}

async function tocarItem(f) {
  const token = ++narrador.token;
  narrador.atual = f; narrador.i = 0; narrador.pausado = false; narrador.trechos = [];
  narrador.inicio = Date.now();
  if (f.audio) {
    narrador.modo = "audio";
    if (suportaVoz) speechSynthesis.cancel();
    audioEl.src = urlAudio(f.audio);
    audioEl.playbackRate = narrador.vel;
    mostrarPlayer(true);
    atualizarBotoesOuvir();
    sessaoDeMidia(f);
    registrar(f.id, "open").catch(() => {});
    marcarLida(f.id);
    try { await audioEl.play(); } catch (e) { if (token === narrador.token && e.name !== "AbortError") { f.audio = null; tocarItem(f); } }
    return;
  }
  if (!suportaVoz) { avisar("Áudio desta notícia ainda não ficou pronto", { erro: true }); return pararNarracao(); }
  narrador.modo = "voz";
  audioEl.pause(); audioEl.removeAttribute("src");
  mostrarPlayer(true);
  atualizarBotoesOuvir();
  sessaoDeMidia(f);
  narrador.trechos = dividirTexto(await textoParaNarrar(f));
  if (token !== narrador.token) return;
  registrar(f.id, "open").catch(() => {});
  marcarLida(f.id);
  falarTrecho(token);
}
function falarTrecho(token) {
  if (token !== narrador.token || narrador.pausado || narrador.modo !== "voz") return;
  const f = narrador.atual;
  if (!f) return;
  if (narrador.i >= narrador.trechos.length) { concluirItem(); setTimeout(() => token === narrador.token && proximaDaFila(), 700); return; }
  const u = new SpeechSynthesisUtterance(narrador.trechos[narrador.i]);
  u.lang = f.lang === "pt" ? "pt-BR" : f.lang === "en" ? "en-US" : f.lang || "pt-BR";
  const voz = vozPara(f.lang || "pt");
  if (voz) u.voice = voz;
  u.rate = narrador.vel;
  u.onend = () => { if (token !== narrador.token || narrador.pausado) return; narrador.i++; atualizarPlayer(); falarTrecho(token); };
  u.onerror = (e) => { if (token !== narrador.token || e.error === "interrupted" || e.error === "canceled") return; narrador.i++; falarTrecho(token); };
  speechSynthesis.speak(u);
  atualizarPlayer();
}
/** Registra o tempo ouvido como leitura (o job aprende com isso). */
function concluirItem() {
  const f = narrador.atual;
  if (!f) return;
  const dwell = Date.now() - narrador.inicio;
  if (dwell > 5000) registrar(f.id, "read", Math.min(dwell, 60 * 60 * 1000)).catch(() => {});
  narrador.atual = null;
}
function proximaDaFila() {
  const prox = narrador.fila.shift();
  if (prox) tocarItem(prox);
  else pararNarracao();
}
function pararNarracao() {
  narrador.token++;
  if (suportaVoz) speechSynthesis.cancel();
  narrador.modo = null;
  audioEl.pause(); audioEl.removeAttribute("src");
  concluirItem();
  narrador.fila = []; narrador.pausado = false;
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  mostrarPlayer(false);
  atualizarBotoesOuvir();
}
function atualizarBotoesOuvir() {
  document.querySelectorAll('.acao.ouvir').forEach((b) => {
    const on = narrador.atual?.id === Number(b.dataset.id);
    b.classList.toggle("on", on);
    b.setAttribute("aria-label", on ? "Parar narração" : "Ouvir esta notícia");
  });
}
function mostrarPlayer(visivel) {
  const el = $("#player");
  el.hidden = !visivel;
  document.body.classList.toggle("com-player", visivel);
  if (visivel) atualizarPlayer();
}
function progressoNarracao() {
  if (narrador.modo === "audio") return audioEl.duration ? Math.round((100 * audioEl.currentTime) / audioEl.duration) : 0;
  return narrador.trechos.length ? Math.round((100 * narrador.i) / narrador.trechos.length) : 0;
}
function atualizarBarra() {
  const b = $("#player .barra i");
  if (b) b.style.width = progressoNarracao() + "%";
}
function atualizarPlayer() {
  const el = $("#player"), f = narrador.atual;
  if (!f || el.hidden) return;
  const pct = progressoNarracao();
  const pronto = narrador.modo === "audio" || narrador.trechos.length;
  const restantes = narrador.fila.length;
  el.innerHTML = `<div class="barra"><i style="width:${pct}%"></i></div>
    <div class="linha-player">
      <button class="pbt principal" data-acao="${narrador.pausado ? "continuarNarracao" : "pausarNarracao"}" aria-label="${narrador.pausado ? "Continuar" : "Pausar"}">${narrador.pausado ? ICONES.tocar : ICONES.pausar}</button>
      <div class="info"><div class="rotulo">${pronto ? (narrador.pausado ? "Pausado" : "Ouvindo") : "Preparando…"}${restantes ? ` · mais ${restantes} na fila` : ""}</div><div class="titulo-player">${esc(f.title)}</div></div>
      <button class="pbt vel" data-acao="velocidadeNarracao" aria-label="Velocidade">${String(narrador.vel).replace(".", ",")}×</button>
      ${restantes ? `<button class="pbt" data-acao="proximaNarracao" aria-label="Próxima notícia">${ICONES.proxima}</button>` : ""}
      <button class="pbt" data-acao="pararNarracao" aria-label="Parar">${ICONES.fechar}</button>
    </div>`;
}
acoes.ouvir = (el) => {
  const id = Number(el.dataset.id);
  if (narrador.atual?.id === id) return pararNarracao();
  const f = artigoConhecido(id);
  if (!f) return;
  pararNarracao();
  tocarItem(f);
};
acoes.ouvirEdicao = () => {
  const lista = estado.feed.filter((f) => !f.lido && !f.menos && (estado.filtro === "tudo" || estado.filtro === "concluidas" || f.topic === estado.filtro));
  if (!lista.length) return avisar("Nada novo para ouvir nesta edição");
  pararNarracao();
  narrador.fila = lista.slice(1);
  tocarItem(lista[0]);
  avisar(`Tocando ${lista.length} ${lista.length > 1 ? "notícias" : "notícia"} em sequência`);
};
acoes.pausarNarracao = () => {
  narrador.pausado = true;
  if (narrador.modo === "audio") audioEl.pause();
  else { narrador.token++; speechSynthesis.cancel(); }
  atualizarPlayer();
};
acoes.continuarNarracao = () => {
  narrador.pausado = false;
  if (narrador.modo === "audio") audioEl.play().catch(() => {});
  else falarTrecho(narrador.token);
  atualizarPlayer();
};
acoes.proximaNarracao = () => {
  narrador.token++;
  if (narrador.modo === "audio") audioEl.pause(); else if (suportaVoz) speechSynthesis.cancel();
  concluirItem(); proximaDaFila();
};
acoes.pararNarracao = () => pararNarracao();
acoes.velocidadeNarracao = () => {
  narrador.vel = VELOCIDADES[(VELOCIDADES.indexOf(narrador.vel) + 1) % VELOCIDADES.length];
  try { localStorage.setItem("velNarracao", String(narrador.vel)); } catch { /* sem armazenamento */ }
  if (narrador.modo === "audio") { audioEl.playbackRate = narrador.vel; atualizarPlayer(); }
  else if (!narrador.pausado && narrador.atual) { narrador.token++; speechSynthesis.cancel(); falarTrecho(narrador.token); }
  else atualizarPlayer();
};
try { const v = Number(localStorage.getItem("velNarracao")); if (VELOCIDADES.includes(v)) narrador.vel = v; } catch { /* ok */ }
// Se o Android interromper a fala ao sair do app, retoma de onde parou ao voltar.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && narrador.modo === "voz" && narrador.atual && !narrador.pausado && narrador.trechos.length && !speechSynthesis.speaking) {
    narrador.token++; falarTrecho(narrador.token);
  }
});

// ------------------------------------------------------------------ coberturas da mesma notícia
acoes.comparar = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  abrirFolha(`<h2 style="margin:4px 0 2px">Várias coberturas</h2><p class="nota-texto" style="margin-top:0">A mesma notícia contada por veículos diferentes. Compare o que cada um destaca.</p><div id="coberturas">${carregando()}</div>`);
  try {
    const versoes = await q(sb.from("v_cobertura").select("*").eq("cluster_id", f.cluster_id).order("reputation", { ascending: false }));
    $("#coberturas").innerHTML = versoes.map((v) => `<div class="cartao versao">
      <div class="meta"><span class="fonte">${esc(v.source)}</span>${v.lang && v.lang !== "pt" ? `<span class="chip idioma">${esc(v.lang.toUpperCase())}</span>` : ""}<span class="quando">${haQuanto(v.published_at)}</span></div>
      <a class="abrir" href="${esc(v.url)}" target="_blank" rel="noopener"${v.id === f.id ? ` data-ler="${f.id}"` : ""}><h2>${esc(v.title)}</h2></a>
      ${v.summary ? `<p class="resumo">${esc(v.summary)}</p>` : ""}</div>`).join("");
  } catch (e) { $("#coberturas").innerHTML = `<div class="vazio">${esc(e.message)}</div>`; }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !estado.lendo) return;
  const { id, inicio } = estado.lendo;
  estado.lendo = null;
  const dwell = Date.now() - inicio;
  if (dwell > 1500) registrar(id, "read", Math.min(dwell, 60 * 60 * 1000)).catch(() => {});
});
/**
 * Abrir, ler no app ou ouvir conta para a meta diária (e o job aprende com o tempo de leitura),
 * mas NÃO marca como lida: a notícia só sai da lista de não lidas com "Aprendi algo" ou "Menos disso".
 */
function marcarLida(id) {
  contarLeitura(id);
}
/** Estado "lida" = você concluiu a notícia com "Aprendi algo" ou "Menos disso". */
function definirConcluida(f) {
  f.lido = Boolean(f.aprendi || f.menos);
  atualizarProgresso();
}

// ------------------------------------------------------------------ HOJE
async function telaHoje() {
  app.innerHTML = `<div class="topo"><div><h1>Hoje</h1><div class="sub" id="subHoje">${hojeLongo()}</div></div>
    <button class="icone-bt" data-acao="recarregar" aria-label="Atualizar">${ICONES.atualizar}</button></div>
    <div id="conteudo">${carregando()}</div>`;
  const [feed, execs, revisar] = await Promise.all([
    q(sb.from("v_feed").select("*").order("position")),
    q(sb.from("execucoes").select("inicio, fim, ok, detalhes").order("inicio", { ascending: false }).limit(30)),
    q(sb.from("salvos").select("article_id").eq("aprendi", true).lte("revisar_em", diaISO())).catch(() => []),
    carregarAtividade(),
  ]);
  estado.feed = feed;
  estado.revisar = revisar.length;
  const ultima = execs.find((e) => e.ok);
  const edicao = execs.find((e) => e.ok && e.detalhes?.edicao);
  if (feed.length) {
    const dia = new Date(feed[0].day + "T12:00:00");
    const hora = edicao ? new Date(edicao.inicio).getHours() : 6;
    $("#subHoje").innerHTML = `Edição da ${hora < 12 ? "manhã" : "tarde"} · ${esc(hojeLongo(dia))}${ultima ? `<br>Atualizado ${haQuanto(ultima.fim ?? ultima.inicio)}` : ""}`;
  }
  if (!feed.length) {
    $("#conteudo").innerHTML = `<div class="cartao vazio"><strong>A primeira edição ainda não saiu</strong>
      O robô de coleta roda de hora em hora e monta uma edição às 6h e às 17h.
      ${execs[0] ? `Última tentativa: ${dataHora(execs[0].inicio)} (${execs[0].ok ? "ok" : "com erro"}).` : "Ele ainda não rodou nenhuma vez."}</div>`;
    return;
  }
  renderHoje();
}

function renderHoje() {
  const feed = estado.feed;
  // Concluídas ("Aprendi algo" / "Menos disso") saem do feed e ficam só no filtro "Concluídas"
  const pendentes = feed.filter((f) => !f.lido);
  const concluidas = feed.filter((f) => f.lido);
  const temas = new Map();
  for (const f of pendentes) temas.set(f.topic, { rotulo: f.topic_label, n: (temas.get(f.topic)?.n ?? 0) + 1 });
  if (estado.filtro === "concluidas" ? !concluidas.length : estado.filtro !== "tudo" && !temas.has(estado.filtro)) estado.filtro = "tudo";
  const visiveis = estado.filtro === "concluidas" ? concluidas
    : pendentes.filter((f) => estado.filtro === "tudo" || f.topic === estado.filtro);
  const filtro = (id, rotulo, n, ponto) =>
    `<button class="filtro ${estado.filtro === id ? "ativo" : ""}" data-acao="filtrar" data-f="${esc(id)}">${ponto ? `<span class="ponto" style="background:${ponto}"></span>` : ""}${esc(rotulo)} <small>${n}</small></button>`;

  const longa = estado.filtro === "tudo" ? pendentes.find((f) => f.reason === "longa") : null;
  const vazio = estado.filtro === "concluidas"
    ? `<div class="vazio"><strong>Nada concluído ainda</strong>Use “Aprendi algo” ou “Menos disso” nas notícias.</div>`
    : `<div class="vazio"><strong>Edição concluída!</strong>Você passou por todas as notícias${estado.filtro === "tudo" ? "" : " deste tema"}. A próxima edição sai às ${new Date().getHours() < 17 ? "17h" : "6h"}.</div>`;
  $("#conteudo").innerHTML = `
    <div id="metaDia">${htmlMeta()}</div>
    ${estado.revisar ? `<button class="cartao aviso-revisao" data-acao="irRevisar">${ICONES.aprendi}<span><strong>${estado.revisar} ${estado.revisar > 1 ? "aprendizados" : "aprendizado"} para revisar</strong><br>Relembrar é o que fixa o conhecimento. Leva um minuto.</span><span class="seta">›</span></button>` : ""}
    <div class="progresso" id="progresso"></div>
    <div class="filtros">${filtro("tudo", "Tudo", pendentes.length)}${[...temas]
      .sort((a, b) => b[1].n - a[1].n).map(([slug, t]) => filtro(slug, t.rotulo, t.n, CORES[slug])).join("")}${concluidas.length ? filtro("concluidas", "Concluídas", concluidas.length) : ""}</div>
    ${estado.filtro === "concluidas" ? `<p class="nota-texto" style="margin:0 0 10px">Para devolver uma notícia ao feed, desmarque “Aprendi algo” ou toque em “Desfazer”.</p>` : ""}
    ${longa ? `<div class="rotulo-secao">${ICONES.livro} Leitura longa do dia</div>${cartaoNoticia(longa)}<div class="rotulo-secao">Notícias</div>` : ""}
    <div id="lista">${escolherGrandes(visiveis.filter((f) => f !== longa)).map(cartaoNoticia).join("") || vazio}</div>`;
  atualizarProgresso();
}
/** Depois de concluir/desfazer: a notícia sai da lista atual com uma animação curta. */
function atualizarLista(f) {
  const noHoje = estado.aba === "hoje" && $("#lista");
  if (!noHoje) return redesenharCartao(f.id);
  const sai = estado.filtro === "concluidas" ? !f.lido : f.lido;
  const els = [...document.querySelectorAll(`#conteudo [data-artigo="${f.id}"]`)];
  if (!sai) {
    // Voltou para esta lista (ex.: "Desfazer"): se o cartão já tinha saído, redesenha a lista inteira
    if (els.length) redesenharCartao(f.id);
    else { const y = scrollY; renderHoje(); scrollTo(0, y); }
    return;
  }
  if (!els.length) return;
  const y = scrollY;
  els.forEach((el) => el.classList.add("saindo"));
  setTimeout(() => { renderHoje(); scrollTo(0, y); }, 280);
  const noLeitor = $("#folha .leitor .acoes");
  if (noLeitor && estado.leitor?.id === f.id) noLeitor.innerHTML = botoesAcao(f);
}
acoes.filtrar = (el) => { estado.filtro = el.dataset.f; renderHoje(); };
acoes.irRevisar = () => { estado.filtroSalvos = "revisar"; irPara("salvos"); };

function atualizarProgresso() {
  const el = $("#progresso");
  if (!el) return;
  const total = estado.feed.length, lidos = estado.feed.filter((f) => f.lido).length;
  const naoLidas = estado.feed.filter((f) => !f.lido && !f.menos).length;
  el.innerHTML = `<span>${lidos} de ${total} lidos</span><div class="trilho"><i style="width:${total ? (100 * lidos) / total : 0}%"></i></div>
    ${suportaVoz && naoLidas ? `<button class="botao peq sec ouvir-edicao" data-acao="ouvirEdicao">${ICONES.ouvir}Ouvir ${naoLidas}</button>` : ""}`;
}

function botoesAcao(f) {
  const tocando = narrador.atual?.id === f.id;
  return `${suportaVoz || f.audio ? `<button class="acao ouvir ${tocando ? "on" : ""}" data-acao="ouvir" data-id="${f.id}" aria-label="${tocando ? "Parar narração" : "Ouvir esta notícia"}" title="Ouvir">${ICONES.ouvir}</button>` : ""}
      <button class="acao ${f.salvo ? "on" : ""}" data-acao="salvar" data-id="${f.id}" aria-pressed="${f.salvo}">${ICONES.salvar}<span>${f.salvo ? "Salvo" : "Salvar"}</span></button>
      <button class="acao aprendi ${f.aprendi ? "on" : ""}" data-acao="aprendi" data-id="${f.id}" aria-pressed="${f.aprendi}">${ICONES.aprendi}<span>Aprendi algo</span></button>
      <button class="acao" data-acao="menos" data-id="${f.id}">${ICONES.menos}<span>Menos disso</span></button>`;
}
/**
 * Ritmo visual do feed: algumas notícias com imagem ganham a capa na largura do cartão.
 * A primeira com imagem entre as 3 primeiras e, depois, no máximo uma a cada 4 cartões.
 * A escolha fica guardada em estado.grandes para o cartão manter o formato ao ser redesenhado.
 */
function escolherGrandes(lista) {
  estado.grandes = new Set();
  let desde = 99;
  lista.forEach((f, i) => {
    desde++;
    const podeAbrir = i < 3 ? estado.grandes.size === 0 : desde >= 4;
    if (f.image_url && !f.lido && podeAbrir) { estado.grandes.add(f.id); desde = 0; }
  });
  return lista;
}
function cartaoNoticia(f) {
  if (f.menos) return cartaoDispensado(f);
  const destaque = f.reason === "longa";
  const grande = destaque || estado.grandes?.has(f.id);
  const imagem = f.image_url ? `<img class="${grande ? "capa" : "miniatura"}" src="${esc(f.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  const motivo = [
    f.reason === "exploration" ? `<span class="chip descoberta" title="Fora do seu padrão, para evitar a bolha">✦ Descoberta</span>` : "",
    f.reason === "quota" ? `<span class="chip acento" title="Tema que não aparecia há uma semana">Tema da semana</span>` : "",
  ].join("");
  const meta = [minutosLeitura(f.word_count), haQuanto(f.published_at)].filter(Boolean).join(" · ");
  return `<article class="cartao noticia ${f.lido ? "lida" : ""} ${destaque ? "destaque" : ""} ${grande && f.image_url ? "grande" : ""}" data-artigo="${f.id}">
    ${grande ? imagem : ""}
    <div class="meta">${chipTema(f.topic, f.topic_label)}<span class="fonte">${esc(f.source)}</span>${f.lang && f.lang !== "pt" ? `<span class="chip idioma" title="Texto em ${f.lang === "en" ? "inglês" : esc(f.lang)}">${esc(f.lang.toUpperCase())}</span>` : ""}<span class="quando">${esc(meta)}</span></div>
    <a class="abrir" href="${esc(f.url)}" target="_blank" rel="noopener" data-ler="${f.id}" data-leitor="${f.tem_texto ? 1 : 0}">
      <div class="cabeca"><h2>${esc(f.title)}</h2>${grande ? "" : imagem}</div>
      ${f.summary ? `<p class="resumo">${esc(f.summary)}</p>` : ""}
    </a>
    ${motivo || f.tem_texto ? `<div class="motivo">${f.tem_texto ? `<span class="chip">${ICONES.livro} Ler no app</span>` : ""}${motivo}</div>` : ""}
    ${f.also_covered_by?.length ? `<button class="tambem" data-acao="comparar" data-id="${f.id}">${ICONES.comparar}<span>Também em ${esc(f.also_covered_by.join(", "))} · <u>comparar</u></span></button>` : ""}
    <div class="acoes">${botoesAcao(f)}</div>
  </article>`;
}
function cartaoDispensado(f) {
  return `<div class="cartao noticia dispensada" data-artigo="${f.id}"><span>Ok, menos notícias como “${esc(f.title.length > 60 ? f.title.slice(0, 60) + "…" : f.title)}”.</span>
    <button class="botao peq sec" data-acao="desfazerMenos" data-id="${f.id}">Desfazer</button></div>`;
}
function redesenharCartao(id) {
  const f = estado.feed.find((x) => x.id === id);
  document.querySelectorAll(`#conteudo [data-artigo="${id}"]`).forEach((el) => { if (f) el.outerHTML = cartaoNoticia(f); });
  const noLeitor = $("#folha .leitor .acoes");
  if (f && noLeitor && estado.leitor?.id === id) noLeitor.innerHTML = botoesAcao(f);
}
const itemDoFeed = (el) => estado.feed.find((x) => x.id === Number(el.dataset.id));

acoes.salvar = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  const antes = { salvo: f.salvo, aprendi: f.aprendi };
  try {
    if (!f.salvo) {
      f.salvo = true; redesenharCartao(f.id);
      await q(sb.from("salvos").upsert({ article_id: f.id }));
      await registrar(f.id, "save");
      avisar("Salvo para ler depois");
    } else {
      f.salvo = false; f.aprendi = false; definirConcluida(f); atualizarLista(f);
      await q(sb.from("salvos").delete().eq("article_id", f.id));
      await desfazer(f.id, "save"); await desfazer(f.id, "learned");
    }
  } catch (e) { Object.assign(f, antes); definirConcluida(f); atualizarLista(f); avisar(e.message, { erro: true }); }
};

acoes.aprendi = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  const antes = { salvo: f.salvo, aprendi: f.aprendi };
  try {
    if (!f.aprendi) {
      f.aprendi = true; f.salvo = true; definirConcluida(f); atualizarLista(f);
      await q(sb.from("salvos").upsert({ article_id: f.id, aprendi: true, revisar_em: somaDias(diaISO(), 7), revisoes: 0 }));
      await registrar(f.id, "learned");
      abrirReflexao(f);
    } else {
      f.aprendi = false; definirConcluida(f); atualizarLista(f);
      await q(sb.from("salvos").update({ aprendi: false }).eq("article_id", f.id));
      await desfazer(f.id, "learned");
    }
  } catch (e) { Object.assign(f, antes); definirConcluida(f); atualizarLista(f); avisar(e.message, { erro: true }); }
};

// ------------------------------------------------------------------ reflexão (fixa o aprendizado)
function abrirReflexao(f) {
  const pergunta = PERGUNTAS[f.topic] ?? "Qual foi a ideia principal, em uma frase?";
  const html = `<div class="reflexao">
    <h2 style="margin:4px 0 4px">Boa! O que ficou?</h2>
    <p class="nota-texto" style="margin-top:0">${esc(f.title)}</p>
    <label class="campo"><span>Em uma frase: o que você aprendeu?</span><textarea id="notaAprendi" rows="3" placeholder="Escreva com as suas palavras"></textarea></label>
    <p class="pergunta">${ICONES.aprendi}<span>${esc(pergunta)}</span></p>
    <div class="botoes"><button class="botao cheio" data-acao="guardarNota" data-id="${f.id}">Guardar</button>
      <button class="botao sec cheio" data-acao="fecharFolha">Agora não</button></div>
    <p class="nota-texto">Daqui a 7 dias ele aparece para você revisar.</p></div>`;
  if (folhaAberta) { fecharFolha(); setTimeout(() => abrirFolha(html), 250); } else abrirFolha(html);
}
acoes.guardarNota = async (el) => {
  const nota = $("#notaAprendi").value.trim();
  el.disabled = true;
  try {
    if (nota) await q(sb.from("salvos").update({ nota }).eq("article_id", Number(el.dataset.id)));
    fecharFolha();
    avisar(nota ? "Guardado nos seus aprendizados" : "Ok! Vou trazer mais coisas assim");
  } catch (e) { avisar(e.message, { erro: true }); el.disabled = false; }
};

acoes.menos = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  f.menos = true; definirConcluida(f); atualizarLista(f);
  try {
    await registrar(f.id, "less");
    avisar("Ok, menos notícias assim", { botao: "Desfazer", acao: () => acoes.desfazerMenos({ dataset: { id: String(f.id) } }) });
  }
  catch (e) { f.menos = false; definirConcluida(f); atualizarLista(f); avisar(e.message, { erro: true }); }
};
acoes.desfazerMenos = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  try { await desfazer(f.id, "less"); f.menos = false; definirConcluida(f); atualizarLista(f); avisar("Voltou para o feed"); }
  catch (e) { avisar(e.message, { erro: true }); }
};

// ------------------------------------------------------------------ SALVOS e revisão
async function telaSalvos() {
  app.innerHTML = `<div class="topo"><div><h1>Salvos</h1><div class="sub">Para ler com calma e revisar o que aprendeu</div></div></div><div id="conteudo">${carregando()}</div>`;
  const salvos = await q(sb.from("v_salvos").select("*").order("salvo_em", { ascending: false }));
  estado.salvos = salvos;
  const hoje = diaISO();
  const aRevisar = salvos.filter((s) => s.aprendi && s.revisar_em && s.revisar_em <= hoje);
  const nAprendi = salvos.filter((s) => s.aprendi).length;
  if (estado.filtroSalvos === "revisar" && !aRevisar.length) estado.filtroSalvos = "todos";
  const f = estado.filtroSalvos;
  const filtro = (id, rotulo, n) => `<button class="filtro ${f === id ? "ativo" : ""}" data-acao="filtrarSalvos" data-f="${id}">${rotulo} <small>${n}</small></button>`;
  if (!salvos.length) {
    $("#conteudo").innerHTML = `<div class="cartao vazio"><strong>Nada salvo ainda</strong>Toque em “Salvar” ou “Aprendi algo” nas notícias de hoje.</div>`;
    return;
  }
  const topoFiltros = `<div class="filtros">${aRevisar.length ? filtro("revisar", "Revisar", aRevisar.length) : ""}${filtro("todos", "Todos", salvos.length)}${filtro("aprendi", "Aprendi algo", nAprendi)}</div>`;
  if (f === "revisar") {
    $("#conteudo").innerHTML = topoFiltros + `<p class="nota-texto" style="margin:0 0 10px">Tente lembrar a ideia principal antes de olhar a sua anotação.</p>` +
      aRevisar.map((s) => `<div class="cartao revisao" data-artigo="${s.id}">
        <div class="meta">${chipTema(s.topic, s.topic_label)}<span class="fonte">${esc(s.source)}</span><span class="quando">aprendido ${haQuanto(s.salvo_em)}</span></div>
        <h2>${esc(s.title)}</h2>
        ${s.nota ? `<details class="sua-nota"><summary>Ver o que você anotou</summary><p>“${esc(s.nota)}”</p></details>` : `<p class="nota-texto">Você não deixou anotação. Lembra o que aprendeu?</p>`}
        <div class="botoes"><button class="botao peq cheio" data-acao="lembro" data-id="${s.id}">Lembro bem</button>
          <a class="botao peq sec cheio" href="${esc(s.url)}" target="_blank" rel="noopener" data-ler="${s.id}" data-leitor="${s.tem_texto ? 1 : 0}" data-reler="${s.id}">Quero reler</a></div>
      </div>`).join("");
    return;
  }
  const lista = f === "aprendi" ? salvos.filter((s) => s.aprendi) : salvos;
  $("#conteudo").innerHTML = topoFiltros + `<div class="cartao"><ul class="lista">${lista.map((s) => `<li class="linha" data-artigo="${s.id}">
      <div class="corpo">
        <a class="titulo" href="${esc(s.url)}" target="_blank" rel="noopener" data-ler="${s.id}" data-leitor="${s.tem_texto ? 1 : 0}" style="color:inherit;text-decoration:none;display:block">${esc(s.title)}</a>
        <div class="meta">${chipTema(s.topic, s.topic_label)}<span>${esc(s.source)}</span><span>salvo ${haQuanto(s.salvo_em)}</span>${s.aprendi ? `<span class="chip ok">Aprendi algo</span>` : ""}</div>
        ${s.nota ? `<p class="nota-salva">“${esc(s.nota)}”</p>` : ""}
      </div>
      <button class="icone-bt" data-acao="removerSalvo" data-id="${s.id}" aria-label="Remover dos salvos">${ICONES.remover}</button>
    </li>`).join("") || `<li class="vazio">Nenhum item aqui.</li>`}</ul></div>`;
}
acoes.filtrarSalvos = (el) => { estado.filtroSalvos = el.dataset.f; telaSalvos(); };
acoes.removerSalvo = async (el) => {
  const id = Number(el.dataset.id);
  try {
    const [linha] = await q(sb.from("salvos").select("*").eq("article_id", id));
    await q(sb.from("salvos").delete().eq("article_id", id));
    await telaSalvos();
    avisar("Removido dos salvos", { botao: "Desfazer", acao: async () => { await q(sb.from("salvos").insert(linha)); telaSalvos(); } });
  } catch (e) { avisar(e.message, { erro: true }); }
};
// Revisão espaçada: 7 dias → 30 → 90 → concluído
const INTERVALOS = [30, 90];
acoes.lembro = async (el) => {
  const s = estado.salvos.find((x) => x.id === Number(el.dataset.id)); if (!s) return;
  const prox = INTERVALOS[s.revisoes] ?? null;
  el.disabled = true;
  try {
    await q(sb.from("salvos").update({ revisoes: s.revisoes + 1, revisar_em: prox ? somaDias(diaISO(), prox) : null }).eq("article_id", s.id));
    avisar(prox ? `Ótimo! Volta daqui a ${prox} dias.` : "Aprendizado consolidado!");
    await telaSalvos();
  } catch (e) { avisar(e.message, { erro: true }); el.disabled = false; }
};
// "Quero reler": reabre o artigo e agenda nova revisão em 7 dias
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-reler]");
  if (!a) return;
  q(sb.from("salvos").update({ revisar_em: somaDias(diaISO(), 7) }).eq("article_id", Number(a.dataset.reler)))
    .then(() => setTimeout(() => estado.aba === "salvos" && !folhaAberta && telaSalvos(), 800)).catch(() => {});
});

// ------------------------------------------------------------------ INTERESSES
let interesses = [];
async function telaInteresses() {
  app.innerHTML = `<div class="topo"><div><h1>Você</h1><div class="sub">Seu mês de leituras e o que o app aprendeu</div></div></div><div id="conteudo">${carregando()}</div>`;
  const [ints, , aprendidos] = await Promise.all([
    q(sb.from("v_interesses").select("*")),
    carregarAtividade(),
    q(sb.from("salvos").select("article_id, criado_em").eq("aprendi", true).gte("criado_em", somaDias(diaISO(), -30))).catch(() => []),
  ]);
  interesses = ints;
  interesses.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  $("#conteudo").innerHTML = htmlRetrospectiva(aprendidos.length) + `
    <h3 style="margin:18px 2px 8px">Seus interesses</h3>
    <div class="cartao"><p class="nota-texto" style="margin:0">A barra é a sua afinidade com cada tema. Ela sobe quando você lê até o fim, salva ou marca “Aprendi algo”,
      e desce com “Menos disso” ou quando você abre e fecha em poucos segundos. Temas esquecidos perdem força devagar,
      e cerca de 12% do feed traz <strong>descobertas</strong> fora do seu padrão. Toque num tema para ajustar.</p></div>
    <div class="cartao">${interesses.map((i) => `<div class="interesse" data-acao="ajustarInteresse" data-slug="${esc(i.slug)}">
      <div class="l1"><strong><span class="ponto" style="background:${CORES[i.slug] ?? "#888"}"></span>${esc(i.label)}</strong><span class="num nota-texto">${Math.round((i.weight ?? 0) * 100)}%</span></div>
      <div class="trilho"><i style="width:${Math.round((i.weight ?? 0) * 100)}%;background:${CORES[i.slug] ?? "var(--acento)"}"></i></div>
      <div class="l3">${i.artigos_7d} notícias na semana · ${i.leituras_30d} leituras suas no mês</div>
    </div>`).join("")}</div>`;
}
function htmlRetrospectiva(nAprendidos) {
  const desde = somaDias(diaISO(), -29);
  const mes = estado.atividade.filter((a) => a.dia >= desde && (a.kind === "open" || a.kind === "read"));
  const porDia = leiturasPorDia(estado.atividade);
  const { atual, recorde } = sequencias(porDia, estado.meta);
  const lidos = new Map();
  for (const a of mes) lidos.set(a.article_id, a);
  const porTema = new Map();
  for (const a of lidos.values()) porTema.set(a.topic, { label: a.topic_label, n: (porTema.get(a.topic)?.n ?? 0) + 1 });
  const temas = [...porTema].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  const maxTema = temas[0]?.[1].n || 1;
  const descobertas = [...lidos.values()].filter((a) => a.descoberta);
  // calendário das últimas 5 semanas (segunda a domingo)
  const hoje = new Date(diaISO() + "T12:00:00");
  const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7) - 28);
  const celulas = [];
  for (let d = new Date(inicio); d <= hoje; d.setDate(d.getDate() + 1)) {
    const iso = diaISO(d), n = porDia.get(iso) ?? 0;
    const nivel = n === 0 ? 0 : n < estado.meta ? 1 : n < estado.meta * 2 ? 2 : 3;
    celulas.push(`<i class="n${nivel}" title="${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}: ${n} ${n === 1 ? "leitura" : "leituras"}"></i>`);
  }
  return `
    <div class="numeros">
      <div class="cartao numero"><strong class="num">${lidos.size}</strong><span>leituras em 30 dias</span></div>
      <div class="cartao numero"><strong class="num">${nAprendidos}</strong><span>aprendizados</span></div>
      <div class="cartao numero"><strong class="num">${atual}</strong><span>dias seguidos</span></div>
      <div class="cartao numero"><strong class="num">${recorde}</strong><span>recorde de sequência</span></div>
    </div>
    <div class="cartao"><h3>Últimas semanas</h3>
      <div class="calendario" aria-label="Leituras por dia nas últimas semanas">${["S", "T", "Q", "Q", "S", "S", "D"].map((d) => `<b>${d}</b>`).join("")}${celulas.join("")}</div>
      <div class="legenda-cal"><span>Menos</span><i class="n0"></i><i class="n1"></i><i class="n2"></i><i class="n3"></i><span>Mais</span><span class="meta-leg">meta: ${estado.meta}/dia</span></div>
    </div>
    ${temas.length ? `<div class="cartao"><h3>O que você mais leu no mês</h3>${temas.map(([slug, t]) => `<div class="barra-tema">
      <div class="l1"><span><span class="ponto" style="background:${CORES[slug] ?? "#888"}"></span>${esc(t.label)}</span><span class="num">${t.n}</span></div>
      <div class="trilho"><i style="width:${(100 * t.n) / maxTema}%;background:${CORES[slug] ?? "var(--acento)"}"></i></div></div>`).join("")}</div>` : ""}
    ${descobertas.length ? `<div class="cartao"><h3>Descobertas que você leu</h3><p class="nota-texto" style="margin:0 0 6px">Coisas fora do seu padrão que chamaram a sua atenção:</p>
      <ul class="lista">${descobertas.slice(0, 4).map((a) => `<li class="linha"><div class="corpo"><div class="titulo">${esc(a.title)}</div><div class="meta">${chipTema(a.topic, a.topic_label)}<span>${esc(a.source ?? "")}</span></div></div></li>`).join("")}</ul></div>` : ""}`;
}

acoes.ajustarInteresse = (el) => {
  const i = interesses.find((x) => x.slug === el.dataset.slug);
  if (!i) return;
  const v = Math.round((i.weight ?? 0.5) * 100);
  abrirFolha(`<h2 style="margin:4px 0 4px">${esc(i.label)}</h2>
    <p class="nota-texto">Quanto você quer ver deste tema. O app continua aprendendo a partir daqui.</p>
    <div class="cartao"><div class="l1" style="display:flex;justify-content:space-between"><span>Afinidade</span><strong class="num" id="valorPeso">${v}%</strong></div>
      <input type="range" id="peso" min="10" max="100" step="5" value="${v}" aria-label="Afinidade com ${esc(i.label)}">
      <div class="escala"><span>Pouco</span><span>Muito</span></div></div>
    <button class="botao cheio" data-acao="salvarPeso" data-slug="${esc(i.slug)}">Salvar</button>`);
  $("#peso").addEventListener("input", (e) => ($("#valorPeso").textContent = `${e.target.value}%`));
};
acoes.salvarPeso = async (el) => {
  el.disabled = true;
  try {
    await q(sb.from("interests").update({ weight: Number($("#peso").value) / 100 }).eq("topic", el.dataset.slug));
    fecharFolha();
    await telaInteresses();
    avisar("Ajustado. Vale a partir da próxima edição.");
  } catch (e) { avisar(e.message, { erro: true }); el.disabled = false; }
};

// ------------------------------------------------------------------ MAIS
let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalar = e; });
const instalado = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;

async function telaMais() {
  app.innerHTML = `<div class="topo"><div><h1>Mais</h1></div></div><div id="conteudo">${carregando()}</div>`;
  const [execs, fontes] = await Promise.all([
    q(sb.from("execucoes").select("inicio, fim, ok, detalhes").order("inicio", { ascending: false }).limit(12)),
    q(sb.from("v_fontes").select("*").order("default_topic").order("name")),
  ]);
  await carregarAtividade();
  const ativas = fontes.filter((f) => f.active).length;
  const agora = new Date().getHours();
  const proxima = agora < 6 ? "hoje às 6h" : agora < 17 ? "hoje às 17h" : "amanhã às 6h";
  const ult = execs[0];

  $("#conteudo").innerHTML = `
    ${!instalado() ? `<div class="cartao"><h2 style="margin-bottom:6px">Instalar no celular</h2>
      <p class="nota-texto" style="margin:0 0 4px">Com o app instalado ele abre em tela cheia, com ícone próprio.</p>
      ${pedidoInstalar ? `<button class="botao cheio" data-acao="instalar" style="margin-top:8px">Instalar app</button>`
        : `<p class="nota-texto" style="margin:0">No Chrome do Android: menu <strong>⋮</strong> → <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).</p>`}</div>` : ""}

    <div class="cartao" id="cartaoAgendamento"><h2 style="margin-bottom:4px">Atualização automática</h2>
      <p class="nota-texto" style="margin:0" id="estadoAgendamento">Verificando…</p></div>

    <div class="cartao"><h2 style="margin-bottom:4px">Meta diária</h2>
      <p class="nota-texto" style="margin:0 0 10px">Quantas notícias você quer ler por dia. A sequência conta os dias em que a meta foi cumprida.</p>
      <div class="seg">${[1, 3, 5, 10].map((n) => `<button class="${estado.meta === n ? "ativo" : ""}" data-acao="definirMeta" data-n="${n}">${n}</button>`).join("")}</div></div>

    <div class="cartao" id="cartaoVoz"><h2 style="margin-bottom:4px">Voz da narração</h2>
      <p class="nota-texto" style="margin:0 0 6px">As notícias são narradas por vozes neurais (Microsoft Edge), geradas pelo robô a cada edição. Toque em ▶ para ouvir uma amostra.</p>
      <div id="seletoresNeural"><p class="nota-texto">Carregando vozes…</p></div>
      ${suportaVoz ? `<details class="token-github"><summary>Voz do celular (reserva)</summary>
        <p class="nota-texto">Usada só quando o áudio de uma notícia ainda não ficou pronto.</p>
        <div id="seletoresVoz"></div></details>` : ""}</div>

    <div class="cartao" id="cartaoAvisos"><h2 style="margin-bottom:4px">Avisos das edições</h2>
      <p class="nota-texto" style="margin:0" id="estadoAvisos">Verificando…</p></div>

    <div class="cartao"><dl class="kv">
      <dt>Última atualização</dt><dd>${ult ? `${haQuanto(ult.fim ?? ult.inicio)}${ult.ok === false ? ` <span class="chip alerta">erro</span>` : ""}` : "ainda não rodou"}</dd>
      <dt>Próxima edição</dt><dd>${proxima}</dd>
      <dt>Fontes ativas</dt><dd>${ativas} de ${fontes.length}</dd>
    </dl></div>

    <details class="secao"><summary>Atualizações recentes <small>${execs.length}</small></summary><div class="conteudo"><ul class="lista">
      ${execs.map((e) => {
        const d = e.detalhes ?? {};
        const partes = [
          d.coleta ? `${d.coleta.novos} notícias novas` : "",
          d.edicao ? `edição com ${d.edicao.itens}` : "",
          d.eventos ? `${d.eventos} interações aprendidas` : "",
          d.coleta?.falhas?.length ? `${d.coleta.falhas.length} ${d.coleta.falhas.length > 1 ? "fontes" : "fonte"} com falha` : "",
          d.erro ? `erro: ${d.erro}` : "",
        ].filter(Boolean).join(" · ");
        return `<li class="linha"><div class="corpo"><div class="titulo">${dataHora(e.inicio)}</div><div class="meta">${esc(partes || (e.ok == null ? "em andamento" : "sem novidades"))}</div></div>
          <span class="chip ${e.ok ? "ok" : e.ok === false ? "alerta" : ""}">${e.ok ? "ok" : e.ok === false ? "erro" : "…"}</span></li>`;
      }).join("") || `<li class="vazio">Nenhuma execução ainda.</li>`}
    </ul></div></details>

    <details class="secao"><summary>Fontes <small>${ativas} ativas</small></summary><div class="conteudo">
      <p class="nota-texto" style="margin-top:0">Fontes com 5 falhas seguidas são desligadas sozinhas. Ligue de novo se o site voltar.</p>
      <ul class="lista">${fontes.map((f) => `<li class="linha"><div class="corpo">
          <div class="titulo">${esc(f.name)}</div>
          <div class="meta">${chipTema(f.default_topic, f.topic_label)}<span>${f.artigos_7d} na semana</span>${f.fail_count ? `<span class="chip alerta">${f.fail_count} falha${f.fail_count > 1 ? "s" : ""}</span>` : ""}</div>
        </div>
        <button class="interruptor" role="switch" aria-checked="${f.active}" aria-label="${f.active ? "Desligar" : "Ligar"} ${esc(f.name)}" data-acao="alternarFonte" data-id="${f.id}" data-ativa="${f.active}"></button>
      </li>`).join("")}</ul>
    </div></details>

    <details class="secao"><summary>Como o feed é montado</summary><div class="conteudo nota-texto">
      <p style="margin-top:0">De hora em hora um robô lê ${fontes.length} fontes de boa reputação, descarta clickbait e conteúdo patrocinado e junta a mesma notícia vinda de vários veículos.</p>
      <p>Cada notícia ganha uma nota: <strong>45%</strong> o quanto combina com seus interesses, <strong>20%</strong> a reputação da fonte, <strong>20%</strong> o frescor (política envelhece em horas; ciência e literatura, em semanas) e <strong>15%</strong> a profundidade.</p>
      <p style="margin-bottom:0">Às 6h e às 17h sai uma edição de 30 notícias mais uma <strong>leitura longa do dia</strong>, com limite por tema, variedade garantida e um espaço para descobertas. Quando o feed traz o texto completo, você lê dentro do app.</p>
    </div></details>

    <div class="cartao"><dl class="kv"><dt>Conta</dt><dd>${esc(estado.email)}</dd><dt>Versão</dt><dd>${VERSAO}</dd></dl>
      <div class="botoes"><button class="botao perigo cheio" data-acao="sair">Sair</button></div></div>`;
  mostrarEstadoAvisos().catch(() => {});
  mostrarAgendamento().catch(() => {});
  montarVozesNeurais().catch(() => {});
  if (suportaVoz && $("#seletoresVoz")) { montarSeletoresVoz(); speechSynthesis.onvoiceschanged = () => estado.aba === "mais" && montarSeletoresVoz(); }
}
// ---- vozes neurais (a lista e as amostras são geradas pelo robô)
const NOMES_VOZ = { pt: "Português", en: "Inglês" };
function rotuloVoz(v) {
  const curto = v.nome.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, "").replace(/Multilingual$/, " (multilíngue)");
  const genero = v.genero === "Female" ? "feminina" : v.genero === "Male" ? "masculina" : "";
  return `${curto}${genero ? ` · ${genero}` : ""}${v.idioma === "en-GB" ? " · britânico" : ""}`;
}
async function montarVozesNeurais() {
  const alvo = $("#seletoresNeural");
  if (!alvo) return;
  const prefs = await q(sb.from("preferencias").select("chave, valor").in("chave", ["vozes_neurais", "voz_neural_pt", "voz_neural_en", "amostras_feitas"]));
  const p = Object.fromEntries(prefs.map((x) => [x.chave, x.valor]));
  const vozes = p.vozes_neurais ?? [];
  const amostras = new Set(p.amostras_feitas ?? []);
  if (!vozes.length) { alvo.innerHTML = `<p class="nota-texto">A lista de vozes aparece depois da próxima atualização automática (até 1 hora).</p>`; return; }
  const linha = (grupo) => {
    const atual = p["voz_neural_" + grupo];
    const opcoes = vozes.filter((v) => (grupo === "pt" ? v.idioma === "pt-BR" : v.idioma.startsWith("en-")));
    return `<label class="campo"><span>Notícias em ${NOMES_VOZ[grupo].toLowerCase()}</span><div class="linha-voz">
      <select data-voz-neural="${grupo}">${opcoes.map((v) => `<option value="${esc(v.nome)}" ${v.nome === atual ? "selected" : ""}>${esc(rotuloVoz(v))}</option>`).join("")}</select>
      <button class="botao peq sec" data-acao="amostraVoz" data-grupo="${grupo}" aria-label="Ouvir amostra">${ICONES.tocar}</button></div></label>`;
  };
  alvo.innerHTML = linha("pt") + linha("en") +
    (amostras.size ? "" : `<p class="nota-texto">As amostras ficam prontas na próxima atualização automática.</p>`) +
    `<p class="nota-texto" style="margin-bottom:0">Trocar a voz vale para as notícias da edição atual em até 1 hora.</p>`;
  estado.amostras = amostras;
}
acoes.amostraVoz = (el) => {
  const voz = $(`[data-voz-neural="${el.dataset.grupo}"]`)?.value;
  if (!voz) return;
  if (estado.amostras && !estado.amostras.has(voz)) return avisar("A amostra desta voz fica pronta na próxima atualização");
  pararNarracao();
  const a = new Audio(urlAudio(`amostras/${voz.toLowerCase()}.mp3`));
  a.play().catch(() => avisar("Não deu para tocar a amostra", { erro: true }));
};
document.addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-voz-neural]");
  if (!sel) return;
  try {
    await q(sb.from("preferencias").upsert({ chave: "voz_neural_" + sel.dataset.vozNeural, valor: sel.value }));
    avisar("Voz escolhida. As notícias de hoje passam a usar essa voz em até 1 hora.");
  } catch (err) { avisar(err.message, { erro: true }); }
});

function montarSeletoresVoz() {
  const alvo = $("#seletoresVoz");
  if (!alvo) return;
  const linha = (grupo, rotulo) => {
    let atual = "";
    try { atual = localStorage.getItem("voz_" + grupo) ?? ""; } catch { /* ok */ }
    const vozes = vozesDoIdioma(grupo);
    return `<label class="campo"><span>${rotulo}</span><div class="linha-voz">
      <select data-muda-voz="${grupo}"><option value="">Padrão do celular</option>${vozes.map((v) => `<option value="${esc(v.name)}" ${v.name === atual ? "selected" : ""}>${esc(v.name)}${v.localService ? "" : " (online)"}</option>`).join("")}</select>
      <button class="botao peq sec" data-acao="testarVoz" data-grupo="${grupo}">${ICONES.ouvir}Testar</button></div></label>`;
  };
  alvo.innerHTML = linha("pt", "Notícias em português") + linha("en", "Notícias em inglês") +
    (speechSynthesis.getVoices().length ? "" : `<p class="nota-texto">Carregando as vozes do aparelho…</p>`);
}
document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-muda-voz]");
  if (!sel) return;
  try { sel.value ? localStorage.setItem("voz_" + sel.dataset.mudaVoz, sel.value) : localStorage.removeItem("voz_" + sel.dataset.mudaVoz); } catch { /* ok */ }
  avisar(sel.value ? "Voz escolhida" : "Usando a voz do celular");
});
acoes.testarVoz = (el) => {
  const grupo = el.dataset.grupo;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(grupo === "pt" ? "Olá! Esta é a voz que vai ler as notícias em português." : "Hello! This is the voice that will read the news in English.");
  u.lang = grupo === "pt" ? "pt-BR" : "en-US";
  const v = vozPara(grupo);
  if (v) u.voice = v;
  u.rate = narrador.vel;
  speechSynthesis.speak(u);
};
// ------------------------------------------------------------------ agendamento confiável (Supabase → GitHub)
async function mostrarAgendamento() {
  const cartao = $("#cartaoAgendamento");
  if (!cartao) return;
  const st = await q(sb.rpc("status_agendamento"));
  const cod = st.ultimo_status;
  const ok = st.token_configurado && (cod === 204 || (cod == null && st.ultimo_disparo));
  const problema = st.token_configurado && cod && cod !== 204
    ? cod === 401 ? "O token expirou ou é inválido. Gere um novo e cole abaixo."
      : cod === 403 || cod === 404 ? "O token não tem permissão. Confira se escolheu o repositório feed-inteligente e a permissão Actions: Read and write."
      : `O GitHub respondeu com erro ${cod}.`
    : st.ultimo_erro ? `Falha ao chamar o GitHub: ${st.ultimo_erro}` : "";
  const estado = !st.token_configurado
    ? "Hoje o robô depende do agendamento do GitHub, que atrasa e pula horários (a edição das 6h pode não sair). Com um token, o próprio banco chama o robô de hora em hora, no horário certo."
    : problema || `Funcionando: o banco chama o robô de hora em hora${st.ultimo_disparo ? ` (último chamado ${haQuanto(st.ultimo_disparo)})` : ""}.`;
  cartao.innerHTML = `<h2 style="margin-bottom:4px">Atualização automática ${ok && !problema ? `<span class="chip ok">ativa</span>` : st.token_configurado ? `<span class="chip alerta">atenção</span>` : ""}</h2>
    <p class="nota-texto" style="margin:0">${esc(estado)}</p>
    <details class="token-github" ${!st.token_configurado || problema ? "open" : ""}>
      <summary>${st.token_configurado ? "Trocar o token" : "Configurar (2 minutos)"}</summary>
      <ol class="passos">
        <li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → novo token</a> (logado na sua conta).</li>
        <li>Nome: <strong>Feed – agendamento</strong>. Validade: <strong>1 ano</strong>.</li>
        <li>Em <em>Repository access</em>, escolha <strong>Only select repositories</strong> → <strong>feed-inteligente</strong>.</li>
        <li>Em <em>Permissions → Repository permissions</em>, ache <strong>Actions</strong> e escolha <strong>Read and write</strong>.</li>
        <li>Toque em <strong>Generate token</strong>, copie e cole aqui:</li>
      </ol>
      <div class="linha-voz"><input type="password" id="tokenGithub" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="botao peq" data-acao="salvarTokenGithub">Salvar</button></div>
      <p class="nota-texto">O token fica guardado só no servidor e não pode ser lido de volta. Ele só permite iniciar o robô deste app.</p>
    </details>`;
}
acoes.salvarTokenGithub = async (el) => {
  const token = $("#tokenGithub").value.trim();
  if (!token) return avisar("Cole o token primeiro", { erro: true });
  el.disabled = true;
  try {
    await q(sb.rpc("salvar_token_github", { token }));
    $("#tokenGithub").value = "";
    avisar("Token salvo. Testando com o GitHub…");
    setTimeout(() => mostrarAgendamento().catch(() => {}), 4000);
  } catch (e) { avisar(e.message, { erro: true }); el.disabled = false; }
};

acoes.definirMeta = async (el) => {
  const n = Number(el.dataset.n);
  try {
    await q(sb.from("preferencias").upsert({ chave: "meta_diaria", valor: n }));
    estado.meta = n;
    el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b === el));
    avisar(`Meta: ${n} ${n > 1 ? "leituras" : "leitura"} por dia`);
  } catch (e) { avisar(e.message, { erro: true }); }
};

// ------------------------------------------------------------------ notificações (Web Push)
const suportaPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function chaveBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function mostrarEstadoAvisos() {
  const el = $("#estadoAvisos");
  if (!el) return;
  if (!suportaPush()) { el.textContent = "Este navegador não recebe notificações. No Android, instale o app pelo Chrome."; return; }
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(() => ok(null), 5000))]);
  if (!reg) { el.textContent = "Não deu para verificar agora. Abra o app instalado e tente de novo."; return; }
  const inscrito = await reg.pushManager.getSubscription();
  if (Notification.permission === "denied") {
    el.innerHTML = "As notificações estão bloqueadas para este app. Libere em Configurações do Android → Apps → Feed → Notificações.";
    return;
  }
  el.parentElement.querySelector(".botoes")?.remove();
  el.innerHTML = inscrito ? "Ligados neste aparelho. Você recebe a manchete às 6h e às 17h." : "Receba a manchete de cada edição às 6h e às 17h.";
  el.insertAdjacentHTML("afterend", `<div class="botoes"><button class="botao ${inscrito ? "sec" : ""} cheio" data-acao="${inscrito ? "desligarAvisos" : "ligarAvisos"}">${ICONES.sino}${inscrito ? "Desligar avisos" : "Ligar avisos"}</button></div>`);
}
acoes.ligarAvisos = async (el) => {
  el.disabled = true;
  try {
    // Chave pública criada pelo robô de coleta (a privada nunca sai do servidor)
    const [pref] = await q(sb.from("preferencias").select("valor").eq("chave", "vapid_publica"));
    if (!pref?.valor) throw new Error("Os avisos ficam disponíveis depois da próxima atualização automática. Tente mais tarde.");
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Permissão de notificação negada");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(String(pref.valor)) });
    const j = sub.toJSON();
    await q(sb.from("push_inscricoes").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }));
    avisar("Avisos ligados");
  } catch (e) { avisar(e.message, { erro: true }); }
  mostrarEstadoAvisos();
};
acoes.desligarAvisos = async (el) => {
  el.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await q(sb.from("push_inscricoes").delete().eq("endpoint", sub.endpoint)); await sub.unsubscribe(); }
    avisar("Avisos desligados");
  } catch (e) { avisar(e.message, { erro: true }); }
  mostrarEstadoAvisos();
};

acoes.instalar = async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice.catch(() => {});
  pedidoInstalar = null;
  telaMais();
};
acoes.alternarFonte = async (el) => {
  const ativa = el.dataset.ativa !== "true";
  el.setAttribute("aria-checked", String(ativa));
  el.dataset.ativa = String(ativa);
  try {
    await q(sb.from("sources").update(ativa ? { active: true, fail_count: 0 } : { active: false }).eq("id", Number(el.dataset.id)));
  } catch (e) {
    el.setAttribute("aria-checked", String(!ativa)); el.dataset.ativa = String(!ativa);
    avisar(e.message, { erro: true });
  }
};
acoes.sair = async () => {
  if (suportaVoz) pararNarracao(); await apagarLocal(); await sb.auth.signOut().catch(() => {}); location.hash = ""; location.reload(); };
acoes.tentarDeNovo = () => location.reload();

// ------------------------------------------------------------------ LOGIN
function telaLogin(modo = "entrar", msg = "") {
  abas.hidden = true;
  const titulos = { entrar: "Entrar", criar: "Criar conta", recuperar: "Recuperar senha", nova: "Nova senha" };
  app.innerHTML = `<div class="login">
    <div class="marca"><img src="icons/icon-192.png" alt=""><div><h1>Feed Inteligente</h1><div class="nota-texto">Notícias boas para aprender algo todo dia</div></div></div>
    <div class="cartao">
      <h2 style="margin-bottom:6px">${titulos[modo]}</h2>
      ${msg ? `<p class="nota-texto">${msg}</p>` : ""}
      <form id="formLogin">
        ${modo !== "nova" ? `<label class="campo"><span>E-mail</span><input type="email" id="email" autocomplete="email" required></label>` : ""}
        ${modo !== "recuperar" ? `<label class="campo"><span>Senha${modo !== "entrar" ? " (mínimo 8 caracteres)" : ""}</span><input type="password" id="senha" autocomplete="${modo === "entrar" ? "current-password" : "new-password"}" minlength="${modo === "entrar" ? 1 : 8}" required></label>` : ""}
        <button class="botao cheio" type="submit">${titulos[modo]}</button>
      </form>
      <div class="botoes" style="justify-content:space-between">
        ${modo === "entrar" ? `<button class="botao peq sec" data-acao="modoLogin" data-m="criar">Criar conta</button><button class="botao peq sec" data-acao="modoLogin" data-m="recuperar">Esqueci a senha</button>`
          : modo !== "nova" ? `<button class="botao peq sec" data-acao="modoLogin" data-m="entrar">Voltar</button>` : ""}
      </div>
    </div></div>`;
  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bt = e.submitter; bt.disabled = true;
    const email = $("#email")?.value.trim(), senha = $("#senha")?.value;
    const volta = location.origin + location.pathname;
    try {
      if (modo === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message === "Email not confirmed" ? "Confirme seu e-mail pelo link que enviamos" : error.message);
        location.reload();
      } else if (modo === "criar") {
        const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: volta } });
        if (error) throw error;
        if (data.session) location.reload();
        else telaLogin("entrar", "Enviamos um e-mail de confirmação. Abra o link e depois entre aqui com a sua senha.");
      } else if (modo === "recuperar") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: volta });
        if (error) throw error;
        telaLogin("entrar", "Se o e-mail existir, você vai receber um link para criar uma nova senha.");
      } else if (modo === "nova") {
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw error;
        location.hash = ""; location.reload();
      }
    } catch (err) { avisar(err.message, { erro: true }); bt.disabled = false; }
  });
}
acoes.modoLogin = (el) => telaLogin(el.dataset.m);

// ------------------------------------------------------------------ início do app
async function iniciar() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let recuperando = false;
  sb.auth.onAuthStateChange((evento) => {
    if (evento === "PASSWORD_RECOVERY") { recuperando = true; telaLogin("nova", "Escolha a nova senha."); }
  });
  let session = null;
  if (navigator.onLine) {
    const semResposta = new Promise((ok) => setTimeout(() => ok({ data: { session: null } }), 8000));
    ({ data: { session } } = await Promise.race([sb.auth.getSession().catch(() => ({ data: { session: null } })), semResposta]));
  } else {
    // Sem internet o login não pode ser renovado: usa a sessão guardada só para abrir os dados salvos
    try {
      const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
      session = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) ?? "null");
    } catch { /* sem sessão guardada */ }
  }
  if (recuperando) return;
  if (session && HASH_INICIAL.includes("type=recovery")) return telaLogin("nova", "Escolha a nova senha.");
  if (!session?.user) return telaLogin();
  estado.email = session.user.email?.toLowerCase();

  let membros = [];
  try { membros = await q(sb.from("membros").select("email")); }
  catch {
    app.innerHTML = `<div class="login"><div class="cartao"><h2>Sem internet</h2>
      <p>O app precisa de conexão na primeira vez. Assim que a internet voltar, ele carrega sozinho.</p>
      <button class="botao" data-acao="tentarDeNovo">Tentar de novo</button></div></div>`;
    window.addEventListener("online", () => location.reload(), { once: true });
    return;
  }
  if (!membros.length) {
    app.innerHTML = `<div class="login"><div class="cartao"><h2>Acesso pendente</h2>
      <p>Você entrou como <strong>${esc(estado.email)}</strong>, mas este e-mail ainda não tem acesso.</p>
      <p class="nota-texto">O acesso é liberado incluindo o e-mail na tabela <code>membros</code> do banco.</p>
      <button class="botao sec" data-acao="sair">Sair</button></div></div>`;
    return;
  }
  abas.hidden = false;
  await irPara(location.hash.replace("#", "") || "hoje");
}
iniciar();
