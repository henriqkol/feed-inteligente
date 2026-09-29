-- =====================================================================
-- Engajamento e aprendizado (tudo gratuito, sem IA):
--   capa das notícias, texto completo para ler no app, leitura longa do dia,
--   reflexão e revisão espaçada dos aprendizados, meta diária, notificações,
--   comparação de coberturas e novas fontes (inclusive em português).
-- =====================================================================

-- ------------------------------------------------------------------ artigos
alter table articles add column if not exists image_url text;
alter table articles add column if not exists content   text;  -- texto completo (com parágrafos), quando o feed traz

alter table feed drop constraint if exists feed_reason_check;
alter table feed add constraint feed_reason_check check (reason in ('relevance', 'exploration', 'quota', 'longa'));

-- ------------------------------------------------------------------ aprendizados
alter table salvos add column if not exists nota       text;          -- sua reflexão em uma frase
alter table salvos add column if not exists revisar_em date;          -- próxima revisão (espaçada: 7, 30, 90 dias)
alter table salvos add column if not exists revisoes   int not null default 0;

-- ------------------------------------------------------------------ preferências e notificações
create table if not exists preferencias (
  chave text primary key,
  valor jsonb not null
);
insert into preferencias (chave, valor) values ('meta_diaria', '3') on conflict do nothing;

create table if not exists push_inscricoes (
  endpoint     text primary key,
  p256dh       text not null,
  auth         text not null,
  criado_em    timestamptz not null default now(),
  ultimo_envio timestamptz
);

-- Segredos do servidor (ex.: chave privada das notificações). Nunca legíveis pelo app.
create table if not exists app_segredos (
  chave text primary key,
  valor text not null
);

alter table preferencias    enable row level security;
alter table push_inscricoes enable row level security;
alter table app_segredos    enable row level security;

drop policy if exists membros_tudo on preferencias;
create policy membros_tudo on preferencias for all to authenticated using (public.eh_membro()) with check (public.eh_membro());
drop policy if exists membros_tudo on push_inscricoes;
create policy membros_tudo on push_inscricoes for all to authenticated using (public.eh_membro()) with check (public.eh_membro());

drop policy if exists job_tudo on preferencias;
create policy job_tudo on preferencias for select to feed_job using (true);
drop policy if exists job_tudo on push_inscricoes;
create policy job_tudo on push_inscricoes for all to feed_job using (true) with check (true);
drop policy if exists job_tudo on app_segredos;
create policy job_tudo on app_segredos for select to feed_job using (true);
revoke all on app_segredos from anon, authenticated;

-- ------------------------------------------------------------------ visões para o app
drop view if exists v_feed;
create view v_feed with (security_invoker = true) as
select f.day, f.position, f.reason, f.score, f.also_covered_by,
       a.id, a.title, a.summary, a.url, a.published_at, a.word_count, a.topic, a.image_url,
       (a.content is not null) as tem_texto,
       coalesce(a.cluster_id, a.id) as cluster_id,
       t.label as topic_label, s.name as source, s.lang,
       exists (select 1 from salvos sv where sv.article_id = a.id)                                  as salvo,
       exists (select 1 from salvos sv where sv.article_id = a.id and sv.aprendi)                   as aprendi,
       exists (select 1 from events e where e.article_id = a.id and e.kind in ('open', 'read'))     as lido,
       exists (select 1 from events e where e.article_id = a.id and e.kind = 'less')                as menos
  from feed f
  join articles a on a.id = f.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic
 where f.day = (select max(day) from feed);

-- As outras versões da mesma notícia (para comparar coberturas)
create or replace view v_cobertura with (security_invoker = true) as
select coalesce(a.cluster_id, a.id) as cluster_id, a.id, a.title, a.summary, a.url, a.published_at,
       s.name as source, s.lang, s.reputation
  from articles a
  join sources s on s.id = a.source_id
 where coalesce(a.cluster_id, a.id) in (select coalesce(a2.cluster_id, a2.id)
                                          from feed f join articles a2 on a2.id = f.article_id
                                         where f.day = (select max(day) from feed));

drop view if exists v_salvos;
create view v_salvos with (security_invoker = true) as
select sv.criado_em as salvo_em, sv.aprendi, sv.nota, sv.revisar_em, sv.revisoes,
       a.id, a.title, a.summary, a.url, a.published_at, a.topic, a.image_url, (a.content is not null) as tem_texto,
       t.label as topic_label, s.name as source
  from salvos sv
  join articles a on a.id = sv.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic;

-- Histórico de uso (meta diária, sequência e retrospectiva do mês)
create or replace view v_atividade with (security_invoker = true) as
select e.created_at, (e.created_at at time zone 'America/Sao_Paulo')::date as dia, e.kind,
       a.id as article_id, a.topic, t.label as topic_label, s.name as source, a.title,
       exists (select 1 from feed f where f.article_id = a.id and f.reason = 'exploration') as descoberta
  from events e
  join articles a on a.id = e.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic
 where e.created_at > now() - interval '120 days';

-- ------------------------------------------------------------------ fontes
-- Fontes adicionadas direto no banco em 29/09 (registradas aqui para ficarem versionadas)
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('IEEE Spectrum', 'https://spectrum.ieee.org/feeds/feed.rss', 'ti', 0.9, true, 'en'),
('Martin Fowler', 'https://martinfowler.com/feed.atom', 'ti', 0.9, true, 'en'),
('Tecnoblog', 'https://tecnoblog.net/feed/', 'tecnologia', 0.7, false, 'pt'),
('Rest of World', 'https://restofworld.org/feed/latest/', 'tecnologia', 0.85, true, 'en'),
('Agência Brasil — Economia', 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', 'financas', 0.8, false, 'pt'),
('Exame', 'https://exame.com/feed/', 'financas', 0.7, false, 'pt'),
('NeoFeed', 'https://neofeed.com.br/feed/', 'financas', 0.75, false, 'pt'),
('Poder360', 'https://www.poder360.com.br/feed/', 'politica', 0.75, false, 'pt'),
('Agência Senado', 'https://www12.senado.leg.br/noticias/feed/todasnoticias/RSS', 'politica', 0.75, false, 'pt'),
('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'geopolitica', 0.8, false, 'en'),
('NPR World', 'https://feeds.npr.org/1004/rss.xml', 'geopolitica', 0.85, false, 'en'),
('DW World', 'https://rss.dw.com/rdf/rss-en-world', 'geopolitica', 0.85, false, 'en'),
('ScienceDaily', 'https://www.sciencedaily.com/rss/all.xml', 'ciencia', 0.8, false, 'en'),
('NPR Science', 'https://feeds.npr.org/1007/rss.xml', 'ciencia', 0.85, false, 'en'),
('NASA — Notícias', 'https://www.nasa.gov/news-release/feed/', 'ciencia', 0.9, false, 'en'),
('Space.com', 'https://www.space.com/feeds/all', 'ciencia', 0.75, false, 'en'),
('Mongabay', 'https://news.mongabay.com/feed/', 'natureza', 0.85, true, 'en'),
('Yale Environment 360', 'https://e360.yale.edu/feed.xml', 'natureza', 0.9, true, 'en'),
('Inside Climate News', 'https://insideclimatenews.org/feed/', 'natureza', 0.85, true, 'en'),
('Reasons to be Cheerful', 'https://reasonstobecheerful.world/feed/', 'social', 0.8, true, 'en'),
('Positive News', 'https://www.positive.news/feed/', 'social', 0.75, false, 'en'),
('Stanford Social Innovation Review', 'https://ssir.org/site/rss_2.0', 'social', 0.85, true, 'en'),
('Agência Brasil — Direitos Humanos', 'https://agenciabrasil.ebc.com.br/rss/direitos-humanos/feed.xml', 'social', 0.8, false, 'pt'),
('Literary Hub', 'https://lithub.com/feed/', 'literatura', 0.85, true, 'en'),
('NPR Books', 'https://feeds.npr.org/1032/rss.xml', 'literatura', 0.85, false, 'en'),
('The Paris Review', 'https://www.theparisreview.org/blog/feed/', 'literatura', 0.9, true, 'en'),
('Hyperallergic', 'https://hyperallergic.com/feed/', 'artes', 0.85, false, 'en'),
('Colossal', 'https://www.thisiscolossal.com/feed/', 'artes', 0.8, false, 'en'),
('Artnet News', 'https://news.artnet.com/feed', 'artes', 0.8, false, 'en'),
('Pitchfork', 'https://pitchfork.com/feed/feed-news/rss', 'musica', 0.8, false, 'en'),
('Stereogum', 'https://www.stereogum.com/feed/', 'musica', 0.75, false, 'en')
on conflict (feed_url) do nothing;

-- Novas fontes: internacionais e em português
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('Euronews', 'https://www.euronews.com/rss', 'geopolitica', 0.8, false, 'en'),
('Africanews', 'https://www.africanews.com/feed/rss', 'geopolitica', 0.75, false, 'en'),
-- A Reuters não publica mais RSS desde 2020: usa a busca do Google Notícias restrita ao site
('Reuters (via Google Notícias)', 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en', 'geopolitica', 0.9, false, 'en'),
('BBC News Brasil', 'https://feeds.bbci.co.uk/portuguese/rss.xml', 'geopolitica', 0.9, false, 'pt'),
('DW Brasil', 'https://rss.dw.com/rdf/rss-br-all', 'geopolitica', 0.85, false, 'pt'),
('Nexo Jornal', 'https://www.nexojornal.com.br/rss.xml', 'politica', 0.85, true, 'pt'),
('JOTA', 'https://www.jota.info/feed', 'politica', 0.8, false, 'pt'),
('Agência FAPESP', 'https://agencia.fapesp.br/rss/', 'ciencia', 0.85, false, 'pt'),
('The Conversation Brasil', 'https://theconversation.com/br/articles.atom', 'ciencia', 0.85, true, 'pt')
on conflict (feed_url) do nothing;
