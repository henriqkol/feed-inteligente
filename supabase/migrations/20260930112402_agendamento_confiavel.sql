-- =====================================================================
-- Agendamento confiável: o agendamento gratuito do GitHub atrasa e pula execuções
-- (em 29-30/09 rodou 3 vezes em 12 horas). Agora o relógio do Supabase (pg_cron)
-- dispara o robô de hora em hora pela API do GitHub (workflow_dispatch), que começa em segundos.
-- O token do GitHub é gravado pelo app (só escrita: ninguém consegue lê-lo de volta pela API).
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists disparos (
  id         bigserial primary key,
  request_id bigint,
  forcar     boolean not null default false,
  criado_em  timestamptz not null default now()
);
alter table disparos enable row level security;  -- sem políticas: só as funções abaixo usam

-- Dispara o workflow "Coletar e montar o feed". Devolve o id da requisição (pg_net) ou null sem token.
create or replace function disparar_coleta(forcar boolean default false) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  token text := (select valor from app_segredos where chave = 'github_token');
  req bigint;
begin
  if token is null then return null; end if;
  select net.http_post(
    url := 'https://api.github.com/repos/henriqkol/feed-inteligente/actions/workflows/job.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'feed-inteligente',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('forcar_edicao', case when forcar then 'true' else 'false' end)),
    timeout_milliseconds := 15000
  ) into req;
  insert into disparos (request_id, forcar) values (req, forcar);
  delete from disparos where criado_em < now() - interval '7 days';
  return req;
end $$;
revoke all on function disparar_coleta(boolean) from public, anon, authenticated;

-- O app grava o token (valida o formato e já faz um disparo de teste).
create or replace function salvar_token_github(token text) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_membro() then raise exception 'Sem acesso'; end if;
  token := trim(token);
  if token !~ '^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$' then
    raise exception 'Isso não parece um token do GitHub (começa com github_pat_)';
  end if;
  insert into app_segredos (chave, valor) values ('github_token', token)
  on conflict (chave) do update set valor = excluded.valor;
  return public.disparar_coleta(false);
end $$;
revoke all on function salvar_token_github(text) from public, anon;
grant execute on function salvar_token_github(text) to authenticated;

-- Situação do agendamento para a tela Mais (nunca devolve o token).
create or replace function status_agendamento() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  req bigint;
  quando timestamptz;
  codigo int;
  erro text;
begin
  if not public.eh_membro() then raise exception 'Sem acesso'; end if;
  select request_id, criado_em into req, quando from disparos order by id desc limit 1;
  if req is not null then
    select status_code, error_msg into codigo, erro from net._http_response where id = req;
  end if;
  return jsonb_build_object(
    'token_configurado', exists (select 1 from app_segredos where chave = 'github_token'),
    'ultimo_disparo', quando,
    'ultimo_status', codigo,
    'ultimo_erro', erro
  );
end $$;
revoke all on function status_agendamento() from public, anon;
grant execute on function status_agendamento() to authenticated;

-- De hora em hora (minuto 2). O próprio job decide se é hora de montar edição (06h e 17h, Brasília).
do $$
begin
  perform cron.unschedule('coleta-feed') where exists (select 1 from cron.job where jobname = 'coleta-feed');
  perform cron.schedule('coleta-feed', '2 * * * *', 'select public.disparar_coleta(false)');
end $$;
