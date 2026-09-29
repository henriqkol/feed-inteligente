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
};

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
  filtro: "tudo",       // Hoje: tudo | nao-lidos | <slug do tema>
  filtroSalvos: "todos", // todos | aprendi
  feed: [],
  eventos: {},          // "id:tipo" → id do evento (para desfazer antes do job processar)
  lendo: null,          // { id, inicio }
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
  if (!id) return;
  delete estado.eventos[`${articleId}:${kind}`];
  await sb.from("events").delete().eq("id", id);
}

// Abrir uma notícia: registra "open" e, ao voltar para o app, o tempo de leitura ("read").
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-ler]");
  if (!a) return;
  const id = Number(a.dataset.ler);
  estado.lendo = { id, inicio: Date.now() };
  registrar(id, "open").catch(() => {});
  marcarLida(id);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !estado.lendo) return;
  const { id, inicio } = estado.lendo;
  estado.lendo = null;
  const dwell = Date.now() - inicio;
  if (dwell > 1500) registrar(id, "read", Math.min(dwell, 60 * 60 * 1000)).catch(() => {});
});
function marcarLida(id) {
  const item = estado.feed.find((f) => f.id === id);
  if (item) item.lido = true;
  document.querySelectorAll(`[data-artigo="${id}"]`).forEach((el) => el.classList.add("lida"));
  atualizarProgresso();
}

// ------------------------------------------------------------------ HOJE
async function telaHoje() {
  app.innerHTML = `<div class="topo"><div><h1>Hoje</h1><div class="sub" id="subHoje">${hojeLongo()}</div></div>
    <button class="icone-bt" data-acao="recarregar" aria-label="Atualizar">${ICONES.atualizar}</button></div>
    <div id="conteudo">${carregando()}</div>`;
  const [feed, execs] = await Promise.all([
    q(sb.from("v_feed").select("*").order("position")),
    q(sb.from("execucoes").select("inicio, fim, ok, detalhes").order("inicio", { ascending: false }).limit(30)),
  ]);
  estado.feed = feed;
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
  const temas = new Map();
  for (const f of feed) temas.set(f.topic, { rotulo: f.topic_label, n: (temas.get(f.topic)?.n ?? 0) + 1 });
  if (estado.filtro !== "tudo" && estado.filtro !== "nao-lidos" && !temas.has(estado.filtro)) estado.filtro = "tudo";
  const naoLidos = feed.filter((f) => !f.lido).length;
  const visiveis = feed.filter((f) => estado.filtro === "tudo" || (estado.filtro === "nao-lidos" ? !f.lido : f.topic === estado.filtro));
  const filtro = (id, rotulo, n, ponto) =>
    `<button class="filtro ${estado.filtro === id ? "ativo" : ""}" data-acao="filtrar" data-f="${esc(id)}">${ponto ? `<span class="ponto" style="background:${ponto}"></span>` : ""}${esc(rotulo)} <small>${n}</small></button>`;

  $("#conteudo").innerHTML = `
    <div class="progresso" id="progresso"></div>
    <div class="filtros">${filtro("tudo", "Tudo", feed.length)}${filtro("nao-lidos", "Não lidos", naoLidos)}${[...temas]
      .sort((a, b) => b[1].n - a[1].n).map(([slug, t]) => filtro(slug, t.rotulo, t.n, CORES[slug])).join("")}</div>
    <div id="lista">${visiveis.map(cartaoNoticia).join("") || `<div class="vazio"><strong>Tudo lido por aqui</strong>Volte na próxima edição.</div>`}</div>`;
  atualizarProgresso();
}
acoes.filtrar = (el) => { estado.filtro = el.dataset.f; renderHoje(); };

function atualizarProgresso() {
  const el = $("#progresso");
  if (!el) return;
  const total = estado.feed.length, lidos = estado.feed.filter((f) => f.lido).length;
  el.innerHTML = `<span>${lidos} de ${total} lidos</span><div class="trilho"><i style="width:${total ? (100 * lidos) / total : 0}%"></i></div>`;
}

function cartaoNoticia(f) {
  if (f.menos) return cartaoDispensado(f);
  const motivo = [
    f.reason === "exploration" ? `<span class="chip descoberta" title="Fora do seu padrão, para evitar a bolha">✦ Descoberta</span>` : "",
    f.reason === "quota" ? `<span class="chip acento" title="Tema que não aparecia há uma semana">Tema da semana</span>` : "",
  ].join("");
  const meta = [minutosLeitura(f.word_count), haQuanto(f.published_at)].filter(Boolean).join(" · ");
  return `<article class="cartao noticia ${f.lido ? "lida" : ""}" data-artigo="${f.id}">
    <div class="meta">${chipTema(f.topic, f.topic_label)}<span class="fonte">${esc(f.source)}</span>${f.lang && f.lang !== "pt" ? `<span class="chip idioma" title="Texto em ${f.lang === "en" ? "inglês" : esc(f.lang)}">${esc(f.lang.toUpperCase())}</span>` : ""}<span class="quando">${esc(meta)}</span></div>
    <a class="abrir" href="${esc(f.url)}" target="_blank" rel="noopener" data-ler="${f.id}">
      <h2>${esc(f.title)}</h2>
      ${f.summary ? `<p class="resumo">${esc(f.summary)}</p>` : ""}
    </a>
    ${motivo ? `<div class="motivo">${motivo}</div>` : ""}
    ${f.also_covered_by?.length ? `<div class="tambem">Também em ${esc(f.also_covered_by.join(", "))}</div>` : ""}
    <div class="acoes">
      <button class="acao ${f.salvo ? "on" : ""}" data-acao="salvar" data-id="${f.id}" aria-pressed="${f.salvo}">${ICONES.salvar}<span>${f.salvo ? "Salvo" : "Salvar"}</span></button>
      <button class="acao aprendi ${f.aprendi ? "on" : ""}" data-acao="aprendi" data-id="${f.id}" aria-pressed="${f.aprendi}">${ICONES.aprendi}<span>Aprendi algo</span></button>
      <button class="acao" data-acao="menos" data-id="${f.id}">${ICONES.menos}<span>Menos disso</span></button>
    </div>
  </article>`;
}
function cartaoDispensado(f) {
  return `<div class="cartao noticia dispensada" data-artigo="${f.id}"><span>Ok, menos notícias como “${esc(f.title.length > 60 ? f.title.slice(0, 60) + "…" : f.title)}”.</span>
    <button class="botao peq sec" data-acao="desfazerMenos" data-id="${f.id}">Desfazer</button></div>`;
}
function redesenharCartao(id) {
  const f = estado.feed.find((x) => x.id === id);
  const el = document.querySelector(`#lista [data-artigo="${id}"]`);
  if (f && el) el.outerHTML = cartaoNoticia(f);
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
      f.salvo = false; f.aprendi = false; redesenharCartao(f.id);
      await q(sb.from("salvos").delete().eq("article_id", f.id));
      await desfazer(f.id, "save"); await desfazer(f.id, "learned");
    }
  } catch (e) { Object.assign(f, antes); redesenharCartao(f.id); avisar(e.message, { erro: true }); }
};

acoes.aprendi = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  const antes = { salvo: f.salvo, aprendi: f.aprendi };
  try {
    if (!f.aprendi) {
      f.aprendi = true; f.salvo = true; redesenharCartao(f.id);
      await q(sb.from("salvos").upsert({ article_id: f.id, aprendi: true }));
      await registrar(f.id, "learned");
      avisar("Boa! Vou trazer mais coisas assim");
    } else {
      f.aprendi = false; redesenharCartao(f.id);
      await q(sb.from("salvos").update({ aprendi: false }).eq("article_id", f.id));
      await desfazer(f.id, "learned");
    }
  } catch (e) { Object.assign(f, antes); redesenharCartao(f.id); avisar(e.message, { erro: true }); }
};

acoes.menos = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  f.menos = true; redesenharCartao(f.id);
  try { await registrar(f.id, "less"); }
  catch (e) { f.menos = false; redesenharCartao(f.id); avisar(e.message, { erro: true }); }
};
acoes.desfazerMenos = async (el) => {
  const f = itemDoFeed(el); if (!f) return;
  try { await desfazer(f.id, "less"); f.menos = false; redesenharCartao(f.id); }
  catch (e) { avisar(e.message, { erro: true }); }
};

// ------------------------------------------------------------------ SALVOS
async function telaSalvos() {
  app.innerHTML = `<div class="topo"><div><h1>Salvos</h1><div class="sub">Para ler com calma e revisar o que aprendeu</div></div></div><div id="conteudo">${carregando()}</div>`;
  const salvos = await q(sb.from("v_salvos").select("*").order("salvo_em", { ascending: false }));
  const nAprendi = salvos.filter((s) => s.aprendi).length;
  const lista = estado.filtroSalvos === "aprendi" ? salvos.filter((s) => s.aprendi) : salvos;
  $("#conteudo").innerHTML = !salvos.length
    ? `<div class="cartao vazio"><strong>Nada salvo ainda</strong>Toque em “Salvar” ou “Aprendi algo” nas notícias de hoje.</div>`
    : `<div class="filtros">
        <button class="filtro ${estado.filtroSalvos === "todos" ? "ativo" : ""}" data-acao="filtrarSalvos" data-f="todos">Todos <small>${salvos.length}</small></button>
        <button class="filtro ${estado.filtroSalvos === "aprendi" ? "ativo" : ""}" data-acao="filtrarSalvos" data-f="aprendi">Aprendi algo <small>${nAprendi}</small></button>
      </div>
      <div class="cartao"><ul class="lista">${lista.map((s) => `<li class="linha" data-artigo="${s.id}">
        <div class="corpo">
          <a class="titulo" href="${esc(s.url)}" target="_blank" rel="noopener" data-ler="${s.id}" style="color:inherit;text-decoration:none;display:block">${esc(s.title)}</a>
          <div class="meta">${chipTema(s.topic, s.topic_label)}<span>${esc(s.source)}</span><span>salvo ${haQuanto(s.salvo_em)}</span>${s.aprendi ? `<span class="chip ok">Aprendi algo</span>` : ""}</div>
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

// ------------------------------------------------------------------ INTERESSES
let interesses = [];
async function telaInteresses() {
  app.innerHTML = `<div class="topo"><div><h1>Interesses</h1><div class="sub">O que o app aprendeu sobre você</div></div></div><div id="conteudo">${carregando()}</div>`;
  interesses = await q(sb.from("v_interesses").select("*"));
  interesses.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  $("#conteudo").innerHTML = `
    <div class="cartao"><p class="nota-texto" style="margin:0">A barra é a sua afinidade com cada tema. Ela sobe quando você lê até o fim, salva ou marca “Aprendi algo”,
      e desce com “Menos disso” ou quando você abre e fecha em poucos segundos. Temas esquecidos perdem força devagar,
      e cerca de 12% do feed traz <strong>descobertas</strong> fora do seu padrão. Toque num tema para ajustar.</p></div>
    <div class="cartao">${interesses.map((i) => `<div class="interesse" data-acao="ajustarInteresse" data-slug="${esc(i.slug)}">
      <div class="l1"><strong><span class="ponto" style="background:${CORES[i.slug] ?? "#888"}"></span>${esc(i.label)}</strong><span class="num nota-texto">${Math.round((i.weight ?? 0) * 100)}%</span></div>
      <div class="trilho"><i style="width:${Math.round((i.weight ?? 0) * 100)}%;background:${CORES[i.slug] ?? "var(--acento)"}"></i></div>
      <div class="l3">${i.artigos_7d} notícias na semana · ${i.leituras_30d} leituras suas no mês</div>
    </div>`).join("")}</div>`;
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
  const ativas = fontes.filter((f) => f.active).length;
  const agora = new Date().getHours();
  const proxima = agora < 6 ? "hoje às 6h" : agora < 17 ? "hoje às 17h" : "amanhã às 6h";
  const ult = execs[0];

  $("#conteudo").innerHTML = `
    ${!instalado() ? `<div class="cartao"><h2 style="margin-bottom:6px">Instalar no celular</h2>
      <p class="nota-texto" style="margin:0 0 4px">Com o app instalado ele abre em tela cheia, com ícone próprio.</p>
      ${pedidoInstalar ? `<button class="botao cheio" data-acao="instalar" style="margin-top:8px">Instalar app</button>`
        : `<p class="nota-texto" style="margin:0">No Chrome do Android: menu <strong>⋮</strong> → <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).</p>`}</div>` : ""}

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
      <p style="margin-bottom:0">Às 6h e às 17h sai uma edição de 30 itens, com limite por tema, variedade garantida e um espaço para descobertas.</p>
    </div></details>

    <div class="cartao"><dl class="kv"><dt>Conta</dt><dd>${esc(estado.email)}</dd><dt>Versão</dt><dd>${VERSAO}</dd></dl>
      <div class="botoes"><button class="botao perigo cheio" data-acao="sair">Sair</button></div></div>`;
}
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
acoes.sair = async () => { await apagarLocal(); await sb.auth.signOut().catch(() => {}); location.hash = ""; location.reload(); };
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
