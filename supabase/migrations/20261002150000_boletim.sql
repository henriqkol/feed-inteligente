-- =====================================================================
-- Boletim em áudio da edição: o robô pede ao Claude (pela assinatura do usuário,
-- token CLAUDE_CODE_OAUTH_TOKEN no GitHub) um roteiro em português que resume as
-- notícias da edição; a voz neural lê. Sem token ou se falhar, monta um boletim simples.
-- =====================================================================
create table if not exists boletins (
  id          bigserial primary key,
  dia         date not null,
  assinatura  text not null,                 -- identifica a edição (ids das notícias)
  origem      text not null check (origem in ('claude', 'simples')),
  titulo      text not null,
  blocos      jsonb not null,                -- [{tema, texto, ids:[...]}]
  texto       text not null,                 -- roteiro completo (o que a voz lê)
  audio       text,                          -- arquivo no bucket "audios"
  audio_voz   text,
  duracao_seg int,
  detalhes    jsonb not null default '{}',
  criado_em   timestamptz not null default now()
);
create index if not exists boletins_criado_idx on boletins (criado_em desc);

alter table boletins enable row level security;
drop policy if exists membros_ler on boletins;
create policy membros_ler on boletins for select to authenticated using (public.eh_membro());
drop policy if exists job_tudo on boletins;
create policy job_tudo on boletins for all to feed_job using (true) with check (true);
grant select, insert, update, delete on boletins to feed_job;
grant usage, select on sequence boletins_id_seq to feed_job;
