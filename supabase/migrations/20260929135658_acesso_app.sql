-- =====================================================================
-- Acesso do app (PWA) e do job de coleta.
--   * App: login do Supabase + tabela membros (só e-mails cadastrados veem dados).
--   * Job (GitHub Actions): papel próprio "feed_job", com acesso só às tabelas do app.
--     A senha do papel é definida fora das migrações (nunca vai para o git).
-- =====================================================================

-- ------------------------------------------------------------------ membros
create table if not exists membros (
  email     text primary key,
  criado_em timestamptz not null default now()
);
comment on table membros is 'E-mails autorizados a usar o app. Quem não estiver aqui não vê nada.';

create or replace function eh_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke execute on function eh_membro() from public, anon;
grant execute on function eh_membro() to authenticated;

insert into membros (email) values ('rique.limberger@gmail.com') on conflict do nothing;

-- ------------------------------------------------------------------ novas tabelas
-- Artigos guardados para ler depois (ou marcados como "aprendi algo").
create table if not exists salvos (
  article_id bigint primary key references articles(id) on delete cascade,
  aprendi    boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- Histórico das execuções do job (o app mostra "atualizado há X").
create table if not exists execucoes (
  id       bigserial primary key,
  inicio   timestamptz not null default now(),
  fim      timestamptz,
  ok       boolean,
  detalhes jsonb not null default '{}'
);
create index if not exists execucoes_inicio_idx on execucoes (inicio desc);

-- O app só registra eventos; o job aplica o aprendizado e marca como processado.
alter table events add column if not exists processed_at timestamptz;
create index if not exists events_pendentes_idx on events (created_at) where processed_at is null;

-- ------------------------------------------------------------------ visões para o app (sem os vetores)
create or replace view v_feed with (security_invoker = true) as
select f.day, f.position, f.reason, f.score, f.also_covered_by,
       a.id, a.title, a.summary, a.url, a.published_at, a.word_count, a.topic,
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

create or replace view v_salvos with (security_invoker = true) as
select sv.criado_em as salvo_em, sv.aprendi,
       a.id, a.title, a.summary, a.url, a.published_at, a.topic, t.label as topic_label, s.name as source
  from salvos sv
  join articles a on a.id = sv.article_id
  join sources  s on s.id = a.source_id
  join topics   t on t.slug = a.topic;

create or replace view v_interesses with (security_invoker = true) as
select t.slug, t.label, t.max_share, t.tau_hours,
       i.weight, i.alpha, i.beta, i.last_reinforced_at,
       (select count(*) from articles a where a.topic = t.slug and a.published_at > now() - interval '7 days') as artigos_7d,
       (select count(*) from events e join articles a on a.id = e.article_id
         where a.topic = t.slug and e.kind in ('read', 'save', 'learned') and e.created_at > now() - interval '30 days') as leituras_30d
  from topics t
  left join interests i on i.topic = t.slug;

create or replace view v_fontes with (security_invoker = true) as
select s.id, s.name, s.default_topic, t.label as topic_label, s.reputation, s.longform, s.lang,
       s.active, s.fail_count, s.last_ok_at,
       (select count(*) from articles a where a.source_id = s.id and a.published_at > now() - interval '7 days') as artigos_7d
  from sources s
  join topics t on t.slug = s.default_topic;

-- ------------------------------------------------------------------ RLS para o app
alter table membros   enable row level security;
alter table salvos    enable row level security;
alter table execucoes enable row level security;

do $$
declare t text;
begin
  -- leitura para membros
  foreach t in array array['membros','topics','sources','articles','interests','events','feed','salvos','execucoes'] loop
    execute format('drop policy if exists membros_ler on %I', t);
    execute format('create policy membros_ler on %I for select to authenticated using (public.eh_membro())', t);
  end loop;
end $$;

-- escrita pelo app: eventos, salvos, ajuste manual de interesses e de fontes
drop policy if exists membros_evento on events;
create policy membros_evento on events for insert to authenticated with check (public.eh_membro() and processed_at is null);

drop policy if exists membros_salvar on salvos;
create policy membros_salvar on salvos for all to authenticated using (public.eh_membro()) with check (public.eh_membro());

drop policy if exists membros_ajustar on interests;
create policy membros_ajustar on interests for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

drop policy if exists membros_ajustar on sources;
create policy membros_ajustar on sources for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

-- ------------------------------------------------------------------ papel do job (GitHub Actions)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'feed_job') then
    create role feed_job login noinherit;
  end if;
end $$;
alter role feed_job set search_path = public, extensions;
alter role feed_job set timezone = 'America/Sao_Paulo';   -- current_date = dia em Brasília
alter role feed_job set statement_timeout = '120s';

grant usage on schema public, extensions to feed_job;
grant select, insert, update, delete on all tables in schema public to feed_job;
grant usage, select on all sequences in schema public to feed_job;
alter default privileges in schema public grant select, insert, update, delete on tables to feed_job;
alter default privileges in schema public grant usage, select on sequences to feed_job;

do $$
declare t text;
begin
  foreach t in array array['membros','topics','sources','articles','interests','events','feed','salvos','execucoes'] loop
    execute format('drop policy if exists job_tudo on %I', t);
    execute format('create policy job_tudo on %I for all to feed_job using (true) with check (true)', t);
  end loop;
end $$;
revoke all on membros from feed_job;   -- o job não precisa saber quem usa o app
